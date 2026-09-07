import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderMaintenanceHtml, formatEta } from './maintenance-page';

/**
 * Assertions for the maintenance page.
 *
 * Two things are worth locking down here, and neither is the visual design.
 *
 *  1. **Self-containment.** The page's whole reason for existing is that it
 *     renders when the app does not. A `<script>`, a `<link>`, or an `<img src>`
 *     added later would be a dependency on the deployment that is currently
 *     broken — and it would look completely fine in every local test, because
 *     locally nothing is broken. That is the failure this asserts against.
 *  2. **Escaping.** The reason string is operator-supplied and lands in an HTML
 *     text node.
 *
 * Run with `npm test`.
 */

const NOW = 1_800_000_000_000;

// ─── Self-containment — the load-bearing property ────────────────────────────

test('the page fetches nothing', () => {
  const html = renderMaintenanceHtml({ reason: 'Deploying.', until: NOW + 3600_000 }, NOW);

  assert.equal(/<script/i.test(html), false, 'no script tags');
  assert.equal(/<link/i.test(html), false, 'no stylesheet or font links');
  assert.equal(/<img/i.test(html), false, 'no image elements');
  assert.equal(/https?:\/\/[^"']*\.(css|js|woff2?|png|jpe?g|svg)/i.test(html), false, 'no remote assets');
  assert.equal(/@import/i.test(html), false, 'no CSS imports');
  assert.equal(/url\(/i.test(html), false, 'no url() references');
  assert.equal(html.includes('/_next/'), false, 'no dependency on the app bundle');
});

test('the only outbound links are the partner site and a mailto', () => {
  const html = renderMaintenanceHtml({ reason: '', until: null }, NOW);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs.sort(), ['https://eastsideaudubon.org', 'mailto:ianshultz24@gmail.com'].sort());
});

test('it is a complete document and marked noindex', () => {
  const html = renderMaintenanceHtml({ reason: '', until: null }, NOW);
  assert.equal(html.startsWith('<!doctype html>'), true);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<\/html>$/);
});

// ─── Reduced motion ──────────────────────────────────────────────────────────

test('the wingbeat has a reduced-motion branch', () => {
  const html = renderMaintenanceHtml({ reason: '', until: null }, NOW);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  // The static SVG must already be the resting pose, so `animation: none` is a
  // composition rather than a frozen frame.
  assert.match(html, /\.wing-up, \.wing-down \{ animation: none; transform: none; \}/);
});

test('both colour schemes are defined', () => {
  const html = renderMaintenanceHtml({ reason: '', until: null }, NOW);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
});

// ─── Escaping ────────────────────────────────────────────────────────────────

test('a reason cannot inject markup', () => {
  const html = renderMaintenanceHtml(
    { reason: '<script>alert(1)</script> & "quoted"', until: null },
    NOW
  );
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot;/);
});

test('a reason cannot break out of the document', () => {
  const html = renderMaintenanceHtml({ reason: '</main></body></html><h1>pwned', until: null }, NOW);
  assert.equal(html.includes('<h1>pwned'), false);
  // Exactly one closing html tag, at the end.
  assert.equal(html.split('</html>').length, 2);
});

// ─── Copy ────────────────────────────────────────────────────────────────────

test('an empty reason still says something useful', () => {
  const html = renderMaintenanceHtml({ reason: '   ', until: null }, NOW);
  assert.match(html, /will be back shortly/);
});

test('the ETA block is absent without an until', () => {
  assert.equal(renderMaintenanceHtml({ reason: 'x', until: null }, NOW).includes('Expected back in'), false);
});

test('the ETA block appears with an until', () => {
  const html = renderMaintenanceHtml({ reason: 'x', until: NOW + 2 * 3600_000 }, NOW);
  assert.match(html, /Expected back in about 2 hours/);
});

test('an already-passed until renders no ETA rather than a negative one', () => {
  const html = renderMaintenanceHtml({ reason: 'x', until: NOW - 1000 }, NOW);
  assert.equal(html.includes('Expected back in'), false);
});

// ─── Relative ETA — deliberately coarse, deliberately timezone-free ──────────

test('formatEta rounds into human bands', () => {
  assert.equal(formatEta(NOW + 30_000, NOW), 'a minute or so');
  assert.equal(formatEta(NOW + 25 * 60_000, NOW), 'about 25 minutes');
  assert.equal(formatEta(NOW + 60 * 60_000, NOW), 'about an hour');
  assert.equal(formatEta(NOW + 6 * 3600_000, NOW), 'about 6 hours');
  assert.equal(formatEta(NOW + 3 * 86_400_000, NOW), 'about 3 days');
  assert.equal(formatEta(NOW, NOW), null);
  assert.equal(formatEta(NOW - 1, NOW), null);
});

test('a custom brand is used and escaped', () => {
  const html = renderMaintenanceHtml({ reason: '', until: null, brand: 'Bird<Radar>' }, NOW);
  assert.match(html, /Bird&lt;Radar&gt;/);
  assert.equal(html.includes('Bird<Radar>'), false);
});

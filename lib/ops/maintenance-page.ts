import { BRAND, PARTNER_NAME, PARTNER_URL, SUPPORT_EMAIL } from '../brand';

/**
 * The maintenance page, as a complete HTML document.
 *
 * ─── The hard requirement ────────────────────────────────────────────────────
 *
 * **Fully self-contained.** Inline CSS, inline SVG, no external font, no script,
 * no network request of any kind. This page renders when the rest of the app is
 * broken — that is the entire point of it — so anything it needs to *fetch* is
 * something that can fail at exactly the moment it must not.
 *
 * That rules out, permanently:
 *   - `next/font` and any webfont (a `<link>` to fonts.googleapis.com is a
 *     third-party dependency on your own outage page)
 *   - the app's own CSS bundle (`app/globals.css` is emitted under
 *     `/_next/static`, which is served by the same deployment that may be the
 *     thing that is down)
 *   - `<img src>` of any kind, including `/icon-192.png`
 *   - any JavaScript, which also means no client-side date formatting
 *
 * ─── CSP ─────────────────────────────────────────────────────────────────────
 *
 * `next.config.ts:15` ships `style-src 'self' 'unsafe-inline'`, so the inline
 * `<style>` block is already permitted, and inline SVG is markup rather than a
 * fetched resource so `img-src` never applies. **No CSP change is required and
 * none should be made.** `phaseB_fixes.md` §5 records CSP as the easy thing to
 * miss here; this note is the answer, not an invitation to loosen anything.
 *
 * ─── Colours ─────────────────────────────────────────────────────────────────
 *
 * Lifted from `lib/theme.ts` and written as literals on purpose. This module
 * cannot import a React-facing theme object and still be the thing that works
 * when the app does not. If the palette in `lib/theme.ts` is ever intentionally
 * changed, these are re-derived from it in the same commit — the same contract
 * `PhaseE3_bugfix_typography.md` §7.1 sets for the typography roles.
 */

export interface MaintenanceCopy {
  reason: string;
  /** Epoch ms the outage is expected to lift, or null. */
  until: number | null;
  brand?: string;
}

/**
 * Escape for an HTML text node and for a quoted attribute.
 *
 * The reason string is operator-supplied through `/dev`, which makes it trusted
 * input from a trusted source — and it is still escaped, because "the only
 * person who can set this is me" is exactly the assumption that ages badly once
 * an `/admin` dashboard exists and a second person has a login.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * "about 2 hours" / "about 25 minutes" / "a few minutes".
 *
 * Deliberately coarse and deliberately relative. An absolute time would need a
 * timezone, and the only two ways to get one are the server's (wrong for almost
 * every visitor) or JavaScript (which this page does not have). A rounded
 * duration is true in every timezone.
 */
export function formatEta(until: number, now: number): string | null {
  const ms = until - now;
  if (ms <= 0) return null;

  const minutes = Math.round(ms / 60_000);
  if (minutes <= 1) return 'a minute or so';
  if (minutes < 45) return `about ${minutes} minutes`;

  const hours = Math.round(ms / 3_600_000);
  if (hours <= 1) return 'about an hour';
  if (hours < 24) return `about ${hours} hours`;

  const days = Math.round(ms / 86_400_000);
  return days <= 1 ? 'about a day' : `about ${days} days`;
}

/**
 * The bird.
 *
 * Two wings rotating about their shoulder joints, 3.6 s per cycle, ±13°. Slow
 * and unhurried — a silhouette gliding, not a loading spinner. The static SVG
 * is authored at the *resting* pose (wings level), and the keyframes move away
 * from it and back, so `animation: none` under reduced motion leaves a
 * deliberate composition rather than whatever frame the animation happened to
 * start on.
 *
 * `transform-box: fill-box` + a percentage `transform-origin` is what makes the
 * origin the shoulder rather than the SVG's own top-left corner; without it
 * both wings pivot about the canvas origin and the bird comes apart.
 */
function birdSvg(): string {
  return `<svg class="bird" viewBox="0 0 120 76" width="136" height="86" role="img" aria-label="A bird in slow flight" xmlns="http://www.w3.org/2000/svg">
  <g fill="currentColor">
    <!-- Tail, then body, then head and beak: back to front, so the silhouette
         reads as one shape rather than a stack of parts. -->
    <path d="M46 40.5c-6.5.2-12.6 1.4-18.4 3.6 5.6.3 11 0 16.4-1z"/>
    <path d="M42 36.4c6.6-2.9 14.6-4.6 24-5 5.6-.2 9.6 1 12 3.6 1.5 1.6 1.2 3.2-.9 4.6-4.2 2.9-11.4 4.7-21.6 5.4-6.6.4-11.4-.5-14.4-2.8-2-1.5-1.7-3.4.9-5.8z"/>
    <path d="M76.6 33.2c4.4-1.4 8.4-1.3 12 .4-2.6.9-4.6 2-6 3.4-2.2-1.6-4.2-2.9-6-3.8z"/>
    <circle cx="72.8" cy="35.6" r="1.15" fill="var(--bg)"/>
    <!-- Wings. Each tapers to a point and pivots at the shoulder end; the
         transform-origin values in the stylesheet name that corner. -->
    <path class="wing wing-up" d="M58.5 35.2C51 26.4 42 20.2 31.4 16.6c4.6 7.6 8.2 14.2 10.8 19.8z"/>
    <path class="wing wing-down" d="M61 43.2c-6.2 8.8-14 15.4-23.4 19.8 3.9-7.9 6.7-14.6 8.4-20.2z"/>
  </g>
</svg>`;
}

export function renderMaintenanceHtml(copy: MaintenanceCopy, now: number = Date.now()): string {
  const brand = escapeHtml(copy.brand ?? BRAND);
  const reason = copy.reason.trim();
  const eta = copy.until !== null ? formatEta(copy.until, now) : null;

  const reasonHtml = reason
    ? `<p class="reason">${escapeHtml(reason)}</p>`
    : `<p class="reason">We're making some changes and will be back shortly.</p>`;

  const etaHtml = eta
    ? `<p class="eta"><span class="dot" aria-hidden="true"></span>Expected back in ${escapeHtml(eta)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${brand} — back shortly</title>
<style>
:root {
  --bg: #F8F9FA;
  --card: #FFFFFF;
  --fg0: #111827;
  --fg1: #374151;
  --fg2: #6B7280;
  --fg3: #9CA3AF;
  --line: #E5E7EB;
  --accent: #1B4332;
  --shadow: 0 4px 12px rgba(0,0,0,0.10);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #09090B;
    --card: #111113;
    --fg0: #FAFAFA;
    --fg1: #D4D4D8;
    --fg2: #A1A1AA;
    --fg3: #71717A;
    --line: #27272A;
    --accent: #74C69D;
    --shadow: 0 4px 16px rgba(0,0,0,0.50);
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg);
  color: var(--fg1);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
main {
  width: 100%;
  max-width: 440px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow);
  padding: 40px 32px 28px;
  text-align: center;
}
.brand {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg3);
  margin: 0 0 22px;
}
.bird { color: var(--accent); display: block; margin: 0 auto 22px; }
h1 {
  margin: 0 0 10px;
  font-size: 21px;
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--fg0);
}
.reason { margin: 0; color: var(--fg2); font-size: 14.5px; }
.eta {
  margin: 18px 0 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 13px;
  color: var(--fg2);
}
.dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent); flex: 0 0 auto;
}
footer {
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
  font-size: 13px;
  color: var(--fg3);
}
footer p { margin: 0 0 6px; }
footer p:last-child { margin-bottom: 0; }
a { color: var(--accent); text-decoration: none; }
a:hover, a:focus-visible { text-decoration: underline; }

/* Slow, unhurried wingbeat. The static pose above is the resting frame, so the
   reduced-motion branch below is a composition, not a stopped animation. */
.wing { transform-box: fill-box; }
.wing-up { transform-origin: 100% 100%; animation: beat-up 3.6s ease-in-out infinite; }
.wing-down { transform-origin: 0% 0%; animation: beat-down 3.6s ease-in-out infinite; }
@keyframes beat-up {
  0%, 100% { transform: rotate(0deg); }
  50%      { transform: rotate(-13deg); }
}
@keyframes beat-down {
  0%, 100% { transform: rotate(0deg); }
  50%      { transform: rotate(13deg); }
}
@media (prefers-reduced-motion: reduce) {
  .wing-up, .wing-down { animation: none; transform: none; }
}
</style>
</head>
<body>
<main>
  <p class="brand">${brand}</p>
  ${birdSvg()}
  <h1>Back shortly</h1>
  ${reasonHtml}
  ${etaHtml}
  <footer>
    <p>${brand} is free and supports <a href="${PARTNER_URL}" rel="noopener noreferrer">${escapeHtml(PARTNER_NAME)}</a>.</p>
    <p>Something urgent? <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a></p>
  </footer>
</main>
</body>
</html>`;
}

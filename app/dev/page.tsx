import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { BRAND } from '@/lib/brand';
import { getTheme, text } from '@/lib/theme';
import { readDevSession, readDevFlags, isDevModeConfigured } from '@/lib/dev/auth';
import { DEFAULT_DEV_FLAGS } from '@/lib/dev/flags';
import {
  readOpsMode,
  readOpsLog,
  isOpsStoreConfigured,
  isForceDownActive,
} from '@/lib/ops/state';
import DevUnlockForm from '@/components/dev/DevUnlockForm';
import DevPanelControls from '@/components/dev/DevPanelControls';

/**
 * The Developer Mode panel.
 *
 * A **server component**, so the gate runs before anything renders: an
 * unauthenticated visitor is never sent the ops state, the audit log, or the
 * markup of the controls. Gating in a client component would ship all of it and
 * hide it with CSS.
 *
 * ─── Indexing ───────────────────────────────────────────────────────────────
 *
 * `noindex, nofollow` in the metadata below, `Disallow: /dev` in
 * `app/robots.ts`, and absent from `app/sitemap.ts`. All three, because they
 * fail in different directions: `Disallow` stops a well-behaved crawler
 * fetching, `noindex` stops one that fetched anyway, and the sitemap is what
 * would otherwise have *advertised* the path.
 *
 * ─── Light mode, unconditionally ─────────────────────────────────────────────
 *
 * The app's theme lives in `localStorage` and is only readable on the client;
 * `DEFAULT_SETTINGS.lightMode` is `true` (`lib/ebird.ts:102`). Rather than flash
 * one theme and swap to the other after hydration, this page commits to the
 * default. It is an operator tool, not a product surface — matching the map's
 * theme is not worth a hydration mismatch, and this repo already carries one
 * benign hydration warning it does not want a second neighbour for
 * (`PhaseE1_rationale.md` §2.1).
 */

export const metadata: Metadata = {
  title: `Developer Mode — ${BRAND}`,
  robots: { index: false, follow: false },
};

/**
 * There is deliberately no `export const dynamic = 'force-dynamic'` here.
 *
 * Calling `cookies()` already opts a route into dynamic rendering, so it would
 * be redundant — and `dynamic` is not in Next 16's route-segment-config table
 * at all (only `dynamicParams`, `runtime`, `preferredRegion`, `maxDuration`
 * are). `PhaseE1_bugfix_ebird404.md` §3 and §5 already identified the one
 * surviving instance of it in this repo, at
 * `app/api/geo-estimate/route.ts`, as dead config to be removed in its own
 * cleanup. Adding a second is the wrong direction.
 */

const LIGHT_MODE = true;

export default async function DevPage() {
  const jar = await cookies();
  const t = getTheme(LIGHT_MODE);

  /**
   * ─── This page owns its own scroll container, and has to ────────────────────
   *
   * The root layout pins the document: `html, body { height: 100%; overflow:
   * hidden }` at `app/globals.css:9-18`, restated as `h-full overflow-hidden`
   * on `<body>` at `app/layout.tsx:59`. Two sources, same rule.
   *
   * That is load-bearing for the product surface and must not be relaxed here.
   * `app/page.tsx` is a fixed `100vh` flex shell whose sidebar and panels scroll
   * internally, `MapControls` / `MapLegend` / the banners are positioned against
   * the viewport, and the mobile drawer and bottom sheets sit at `bottom: 56`
   * against it. A scrollable body would give the map a scrollbar and detach all
   * of that.
   *
   * So a `minHeight: 100vh` block here does not scroll — it just gets clipped by
   * the body, which is exactly the bug this replaced. The fix is scoped
   * entirely to this route: an outer element with a definite height and
   * `overflowY: auto` becomes its own scroll container, and touches nothing the
   * app depends on.
   *
   * **Any future full-page route added under `app/` inherits the same
   * constraint** and needs the same treatment.
   */
  const shell = (children: React.ReactNode, centre = false) => (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: t.bg0,
        color: t.fg1,
        fontFamily: t.sans,
      }}
    >
      <div
        style={{
          // `minHeight`, not `height`: short content (the unlock form) still
          // fills the viewport so it can be centred, while long content (the
          // panel) grows past the fold and scrolls rather than being clipped.
          minHeight: '100%',
          // Without this, the padding is added *outside* the 100% and the page
          // scrolls by exactly the padding even when the content fits.
          boxSizing: 'border-box',
          padding: centre ? 24 : '32px 24px 64px',
          display: centre ? 'flex' : 'block',
          alignItems: centre ? 'center' : undefined,
          justifyContent: centre ? 'center' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );

  if (!readDevSession(jar)) {
    return shell(
      <div style={{ width: '100%', maxWidth: 340 }}>
        <DevUnlockForm lightMode={LIGHT_MODE} />
        {!isDevModeConfigured() && (
          <p
            style={{
              ...text.rowMeta(t),
              marginTop: 14,
              textAlign: 'center',
              color: '#B45309',
            }}
          >
            DEV_MODE_SECRET is not set on this deployment. No password will work
            until it is.
          </p>
        )}
      </div>,
      true
    );
  }

  // Everything below this line is only reachable with a verified session.
  const [mode, log] = await Promise.all([readOpsMode(), readOpsLog(20)]);
  const flags = readDevFlags(jar) ?? DEFAULT_DEV_FLAGS;

  return shell(
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <header style={{ marginBottom: 22 }}>
        <p style={{ ...text.microCaps(t), margin: '0 0 4px' }}>{BRAND.toUpperCase()}</p>
        <h1 style={{ ...text.panelTitle(t), fontSize: 22, margin: 0 }}>Developer Mode</h1>
        <p style={{ ...text.rowMeta(t), margin: '6px 0 0' }}>
          Currently <strong style={{ color: t.fg0 }}>{mode.state}</strong>
          {mode.until !== null && (
            <> · auto-lifts {new Date(mode.until).toLocaleString()}</>
          )}
        </p>
      </header>

      <DevPanelControls
        initialMode={mode}
        initialLog={log}
        initialFlags={flags}
        storeConfigured={isOpsStoreConfigured()}
        forceDownActive={isForceDownActive()}
        lightMode={LIGHT_MODE}
      />
    </div>
  );
}

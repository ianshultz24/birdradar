import { NextResponse, type NextRequest } from 'next/server';
import { readDevSession } from '@/lib/dev/auth';
import { readOpsMode, retryAfterSeconds } from '@/lib/ops/state';
import { renderMaintenanceHtml } from '@/lib/ops/maintenance-page';

/**
 * The maintenance gate.
 *
 * `proxy.ts` is Next 16's replacement for `middleware.ts` (renamed in v16.0.0;
 * `middleware` still works and is deprecated). This repo had neither file before
 * this change, so there was nothing to migrate — confirmed independently by
 * `PhaseE1_bugfix_ebird404.md` §3, which recorded
 * `middleware-manifest.json` as `{"middleware":{},"functions":{}}`.
 *
 * ─── Node.js runtime ─────────────────────────────────────────────────────────
 *
 * Proxy defaults to the Node.js runtime in v16, and the `runtime` segment config
 * is *not available* here — setting it throws. That is what makes `node:crypto`
 * usable in `lib/dev/auth.ts`, so there is no Web Crypto workaround anywhere in
 * this feature.
 *
 * ─── Why the responses are built rather than rewritten ───────────────────────
 *
 * `NextResponse.rewrite(url, { status })` does not reliably carry the status
 * code, and a maintenance page that returns 200 is worse than no maintenance
 * page at all: crawlers de-index, uptime monitors report green, and clients
 * cache it. Every branch below returns a real response object with a real
 * status.
 *
 * ─── Cost ────────────────────────────────────────────────────────────────────
 *
 * This runs on every non-excluded request, which is a change in shape for this
 * app, not just in behaviour. `readOpsMode()` is behind a 15 s module-scope
 * cache, so a warm instance pays one Redis round trip per 15 s rather than one
 * per request — see the note in `lib/ops/state.ts` about why that cache is
 * never the source of truth.
 */

export const config = {
  /**
   * Everything except static assets, the metadata files, the service worker, and
   * the four API paths that must keep answering during an outage.
   *
   * The exclusions that are easy to get wrong:
   *
   *   - **`/api/health`** — the endpoint that reports the outage. Gating it
   *     behind the outage would make the ops state unobservable from outside
   *     exactly when it matters.
   *   - **`/api/dev/*`** — otherwise `down` locks you out of the panel that
   *     turns `down` off, and the only way back is a redeploy.
   *   - **`/api/alerts/run` and `/api/forecast/build`** — the real cron paths.
   *     The spec said `/api/cron/*`; this repo has never had that prefix. The
   *     schedulers are `.github/workflows/alert-watcher.yml` (every 5 min) and
   *     `forecast-build.yml` (daily). 503-ing them would make GitHub Actions log
   *     failures every five minutes for the length of the outage. They read the
   *     ops state themselves instead — see spec §6 and their route files.
   *   - **`/sw.js`** — an installed service worker still serves push during an
   *     outage. It has no `fetch` handler (see below), so it cannot interfere.
   *
   * Note that Next invokes proxy for `/_next/data/*` even when excluded — that
   * is documented, intentional, and harmless here.
   *
   * ─── Service worker audit (spec §7) ──────────────────────────────────────
   *
   * `public/sw.js` registers `install`, `activate`, `push` and
   * `notificationclick` and **has no `fetch` listener at all**. There is no
   * precached shell and no navigation handler, so navigations always reach the
   * network, always reach this file, and a 503 can never be served from cache.
   * The spec's "navigations must be network-first" requirement is satisfied
   * vacuously and **no caching strategy was rewritten.** If a `fetch` handler is
   * ever added, this gate stops working for returning visitors — that is now
   * recorded in `public/sw.js` itself.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|sw\\.js|icon-[^/]*\\.png|apple-touch-icon\\.png|api/health|api/dev/|api/alerts/run|api/forecast/build).*)',
  ],
};

export async function proxy(request: NextRequest) {
  const mode = await readOpsMode();

  // `degraded` is a banner, not a gate. `live` is the overwhelmingly common
  // path and must stay a straight pass-through.
  if (mode.state !== 'down') return NextResponse.next();

  // 1. A verified developer passes through, and the app is told so.
  if (readDevSession(request.cookies)) {
    const headers = new Headers(request.headers);
    headers.set('x-dev-bypass', '1');
    return NextResponse.next({ request: { headers } });
  }

  const now = Date.now();
  const retryAfter = retryAfterSeconds(mode, now);

  // Derived from `until`, not a flat 900. A two-hour window that tells clients
  // and crawlers to return in fifteen minutes is telling them something untrue
  // six times over — and the only reason to serve a real 503 rather than a
  // rewritten 200 is that these headers are believed.
  const common: Record<string, string> = {
    'Retry-After': String(retryAfter),
    'Cache-Control': 'no-store',
  };

  // 2. API paths and explicit JSON clients get JSON.
  //
  // Known gap, deliberately not guessed at: a client-side <Link> navigation
  // sends `RSC: 1` with `Accept: text/x-component`, which matches neither
  // condition and therefore falls to the HTML branch below. Next *should*
  // respond to a non-flight payload by falling back to a hard navigation, which
  // lands on the 503 properly — but "should" is not evidence, and the app
  // currently has only one route, so exposure is near zero either way. Verified
  // rather than assumed; see the rationale doc.
  const path = request.nextUrl.pathname;
  const accept = request.headers.get('accept') ?? '';
  if (path.startsWith('/api/') || accept.includes('application/json')) {
    return NextResponse.json(
      { error: 'maintenance', reason: mode.reason, retryAfter },
      { status: 503, headers: common }
    );
  }

  // 3. Everything else gets the self-contained page.
  return new Response(
    renderMaintenanceHtml({ reason: mode.reason, until: mode.until }, now),
    {
      status: 503,
      headers: { ...common, 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

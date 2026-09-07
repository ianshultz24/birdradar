import { type NextRequest } from 'next/server';
import { readDevSession } from '@/lib/dev/auth';
import { renderMaintenanceHtml } from '@/lib/ops/maintenance-page';
import { readOpsMode, normalizeReason } from '@/lib/ops/state';

export const runtime = 'nodejs';

/**
 * Preview the maintenance page at **200**, without taking the site down.
 *
 * ─── Why this is gated, and gated to 404 specifically ────────────────────────
 *
 * The point of the route is design iteration: `lib/ops/maintenance-page.ts` is
 * otherwise only reachable by declaring a real outage, which is a poor edit
 * loop. But an *ungated* copy would be a public page that says the site is down
 * while the site is up — indexable, linkable, and screenshot-able out of
 * context.
 *
 * It answers **404**, not 401 or 403, for a visitor without a dev session. A 403
 * confirms the path exists and is worth attacking; a 404 is indistinguishable
 * from the route not being there at all. Nothing about this endpoint benefits
 * from being discoverable.
 *
 * ─── Query overrides ─────────────────────────────────────────────────────────
 *
 * `?reason=…&until=…` (and `?eta=<minutes>`) let the copy and the ETA band be
 * driven directly, which is the only practical way to check the wrapping of a
 * long reason or the four `formatEta` bands. They are safe here precisely
 * because the route is already behind the session check, and the renderer
 * escapes the reason regardless.
 *
 * With no query params it renders the *live* ops state, so this doubles as
 * "show me exactly what a visitor is seeing right now".
 */
export async function GET(request: NextRequest): Promise<Response> {
  if (!readDevSession(request.cookies)) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }

  const params = request.nextUrl.searchParams;
  const now = Date.now();
  const mode = await readOpsMode(now);

  const reason = params.has('reason') ? normalizeReason(params.get('reason')) : mode.reason;

  // `eta` is minutes-from-now, which is what you actually want when checking
  // the wording bands; `until` is an absolute epoch ms for reproducing a real
  // stored state exactly.
  let until: number | null = mode.until;
  if (params.has('eta')) {
    const minutes = Number(params.get('eta'));
    until = Number.isFinite(minutes) ? now + minutes * 60_000 : null;
  } else if (params.has('until')) {
    const raw = Number(params.get('until'));
    until = Number.isFinite(raw) ? raw : null;
  }

  return new Response(renderMaintenanceHtml({ reason, until }, now), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

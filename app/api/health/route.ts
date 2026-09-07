import { readOpsMode } from '@/lib/ops/state';

export const runtime = 'nodejs';

/**
 * Public liveness + ops state.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 *
 * `app/page.tsx` is a client component and `/` builds as a static page. Making
 * it dynamic to read the ops state server-side would put a Redis round trip on
 * every render and *still* only update the degraded banner on reload. So the
 * client asks, instead.
 *
 * Three jobs, one endpoint:
 *   1. drives the degraded banner;
 *   2. tells an already-loaded tab that `down` was declared after it loaded —
 *      the case a fresh navigation never sees, because a fresh navigation gets
 *      the 503 from `proxy.ts`;
 *   3. an external liveness probe that keeps answering during an outage, which
 *      is what makes its `proxy.ts` matcher exclusion load-bearing rather than
 *      a dead entry copied out of the spec.
 *
 * ─── What it does not do ─────────────────────────────────────────────────────
 *
 * It is **not** the signal for "you are bypassing maintenance". Seeing the app
 * while `state === 'down'` does not imply a dev session — a non-dev tab that was
 * already open sees exactly the same thing. That banner is gated on
 * `/api/dev/session` instead. Inferring it from visibility would tell ordinary
 * users the site is down for everyone but them, which is both false and
 * confusing at the worst possible moment.
 *
 * It reads through the module-cached `readOpsMode()`, never Redis directly, so a
 * poll costs a function invocation and usually no round trip. `no-store` is
 * required, not a preference: a cached copy would report a stale state to every
 * subsequent client, which is the one failure mode that makes the whole endpoint
 * worse than useless.
 *
 * `reason` is public here, and that is not a leak — it is printed verbatim on
 * the maintenance page that every visitor receives.
 */
export async function GET(): Promise<Response> {
  const mode = await readOpsMode();

  return Response.json(
    {
      ok: true,
      state: mode.state,
      reason: mode.reason,
      until: mode.until,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    }
  );
}

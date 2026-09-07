import { type NextRequest } from 'next/server';
import { devJson } from '@/lib/dev/http';
import { readDevSession } from '@/lib/dev/auth';
import { peekUpstreamBudget } from '@/lib/ebird-proxy';
import { redis } from '@/lib/redis';
import { readOpsMode, isOpsStoreConfigured, isForceDownActive } from '@/lib/ops/state';

export const runtime = 'nodejs';

/**
 * The half of the debug overlay that cannot ride on a response header.
 *
 * Cache tier, cache age, upstream budget and per-IP rate limit are genuinely
 * *per request*, so they come back on the eBird responses themselves (see
 * `devDebugHeaders` in `lib/ebird-proxy.ts`) — a poll would only ever show a
 * number from some adjacent moment.
 *
 * The ORS circuit breaker is different. It has no per-request existence: it is a
 * deployment-wide latch that only changes when a drive-time call happens, which
 * may be minutes ago or never. Polling is the correct shape for it, so this
 * route exists for exactly that plus a couple of environment facts the panel
 * needs.
 *
 * ─── The sensitive-species constraint (spec §9) ──────────────────────────────
 *
 * Nothing here touches observation data. There are no coordinates in this
 * response, no location names, no `locId`s — only counters, booleans and the
 * operator's own reason string. `lib/location-privacy.ts` is neither imported
 * nor bypassed, and no dev session state reaches it. Developer Mode must not
 * open a path around the fail-closed chokepoint, and the simplest way to
 * guarantee that for this endpoint is that it has no access to the data at all.
 */
export async function GET(request: NextRequest): Promise<Response> {
  if (!readDevSession(request.cookies)) {
    return devJson({ error: 'Unauthorized' }, 401);
  }

  const now = Date.now();
  const [mode, budget] = await Promise.all([readOpsMode(now), peekUpstreamBudget()]);

  // ORS breaker + rolling daily budget. Both are read-only peeks at the keys
  // app/api/drive-time/route.ts writes; nothing here consumes quota or trips
  // anything. `pttl` gives how much of the lockout is left, which is the number
  // that actually answers "why are there no drive-time badges right now".
  let orsBlocked: boolean | null = null;
  let orsBlockedForMs: number | null = null;
  let orsDailyUsed: number | null = null;

  if (redis) {
    try {
      const [blocked, ttl, used] = await Promise.all([
        redis.get('br:ors:blocked'),
        redis.pttl('br:ors:blocked'),
        redis.get<number>('br:ors:budget'),
      ]);
      orsBlocked = blocked !== null && blocked !== undefined;
      orsBlockedForMs = typeof ttl === 'number' && ttl > 0 ? ttl : null;
      orsDailyUsed = used === null || used === undefined ? 0 : Number(used);
    } catch {
      // Leave the three as null. The overlay renders a dash — an unknown must
      // not borrow the look of a known value.
    }
  }

  return devJson({
    now,
    ops: {
      state: mode.state,
      reason: mode.reason,
      until: mode.until,
      forceDownActive: isForceDownActive(),
      storeConfigured: isOpsStoreConfigured(),
    },
    ebird: {
      budgetUsed: budget.used,
      budgetMax: budget.max,
      budgetRemaining: budget.used === null ? null : Math.max(0, budget.max - budget.used),
      bucket: budget.bucket,
    },
    ors: {
      configured: Boolean(process.env.ORS_API_KEY),
      blocked: orsBlocked,
      blockedForMs: orsBlockedForMs,
      dailyUsed: orsDailyUsed,
      dailyBudget: Number(process.env.ORS_DAILY_BUDGET) || 450,
    },
    redisConfigured: redis !== null,
  });
}

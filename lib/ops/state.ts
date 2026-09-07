import { redis } from '../redis';

/**
 * Operational state — is the public site live, degraded, or down?
 *
 * Read on every non-excluded request from `proxy.ts`, so the cost model matters
 * as much as the logic:
 *
 *   1. `OPS_FORCE_DOWN=1`  → down, with no network call at all. Break-glass for
 *      the case where Redis is the thing that is broken. Needs a redeploy on
 *      Vercel, so it is the slow path, not the fast one — the panel is the fast
 *      one.
 *   2. Redis `br:ops:mode`, behind a 15 s module-scope cache.
 *   3. **Any error at all → `live`.** Fail open. This is the safety property of
 *      the entire feature: a Redis outage must never be able to take the public
 *      site down. Every Redis call in this repo already works this way
 *      (lib/ebird-proxy.ts, app/api/drive-time/route.ts); this one has the
 *      highest stakes.
 *
 * ─── On the module-scope cache ───────────────────────────────────────────────
 *
 * Next's proxy docs warn: *"Proxy is meant to be invoked separately of your
 * render code and in optimized cases deployed to your CDN … you should not
 * attempt relying on shared modules or globals."* That is exactly why this is a
 * cache and never the source of truth. A cold instance reads Redis; correctness
 * never depends on the cached value surviving. The only thing the cache buys is
 * not paying a round trip per request on a warm instance.
 *
 * The cost is propagation lag: a toggle reaches other warm instances within the
 * TTL. `writeOpsMode()` busts the *local* cache immediately so the panel is
 * never wrong about its own write, and the panel copy states the lag rather than
 * letting an operator conclude the button did nothing and press it twice.
 */

export type OpsState = 'live' | 'degraded' | 'down';

export interface OpsMode {
  state: OpsState;
  reason: string;
  /** Epoch ms. When passed, the state auto-lifts back to `live`. */
  until: number | null;
  /** Epoch ms the state was set. Doubles as the compare-and-delete token. */
  setAt: number;
}

export interface OpsLogEntry {
  state: OpsState;
  reason: string;
  until: number | null;
  at: number;
  /** Present on auto-lift entries; carries the `setAt` of the state that expired. */
  liftedSetAt?: number;
}

export const OPS_MODE_KEY = 'br:ops:mode';
export const OPS_LOG_KEY = 'br:ops:log';
/** LTRIM 0 99 — a hundred entries. */
export const OPS_LOG_MAX = 100;
export const OPS_CACHE_TTL_MS = 15_000;
/** Long enough for a real explanation, short enough not to bloat a 503 body. */
export const MAX_REASON_LENGTH = 300;

export const AUTO_LIFT_REASON = 'auto-lift';

export const LIVE: OpsMode = { state: 'live', reason: '', until: null, setAt: 0 };

const FORCED_DOWN: OpsMode = {
  state: 'down',
  reason: 'Scheduled maintenance.',
  until: null,
  setAt: 0,
};

export function isOpsState(v: unknown): v is OpsState {
  return v === 'live' || v === 'degraded' || v === 'down';
}

/** Trim and cap a reason on the way in. Escaping happens at render time. */
export function normalizeReason(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_REASON_LENGTH);
}

/**
 * Coerce whatever came back from Redis into an `OpsMode`, or `null`.
 *
 * `@upstash/redis` deserializes JSON on `get`, so this normally receives an
 * object — but it receives a string if the value was written by something else,
 * and `null` on a miss. All three are handled here rather than at the call site.
 */
export function parseOpsMode(raw: unknown): OpsMode | null {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;

  const o = v as Record<string, unknown>;
  if (!isOpsState(o.state)) return null;

  const until =
    typeof o.until === 'number' && Number.isFinite(o.until) ? o.until : null;
  const setAt =
    typeof o.setAt === 'number' && Number.isFinite(o.setAt) ? o.setAt : 0;

  return { state: o.state, reason: normalizeReason(o.reason), until, setAt };
}

/**
 * The whole resolution rule, as a pure function.
 *
 * Returns the effective mode, plus the stored mode that needs lifting when an
 * `until` has passed. Splitting the decision from the I/O is what lets
 * `lib/ops/state.test.ts` assert on the fail-open and expiry behaviour without
 * a Redis stub — and fail-open is the one regression here that takes the site
 * down rather than leaving it up.
 */
export function resolveOpsMode(
  raw: unknown,
  now: number,
  forceDown: boolean
): { mode: OpsMode; expired: OpsMode | null } {
  // Precedence is absolute: the break-glass exists for when the stored state
  // cannot be trusted or cannot be reached, so nothing stored may override it,
  // and nothing may "auto-lift" a forced outage.
  if (forceDown) return { mode: FORCED_DOWN, expired: null };

  const stored = parseOpsMode(raw);
  if (!stored) return { mode: LIVE, expired: null };
  if (stored.state === 'live') return { mode: stored, expired: null };

  if (stored.until !== null && stored.until <= now) {
    return { mode: LIVE, expired: stored };
  }

  return { mode: stored, expired: null };
}

// ─── Redis seam ──────────────────────────────────────────────────────────────
// Narrow structural type rather than the full Upstash surface, so a test can
// supply a fake and so this module states exactly which commands it depends on.

export interface OpsRedis {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
  del(key: string): Promise<number>;
  lpush(key: string, ...elements: unknown[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>;
  eval<TArgs extends unknown[], TData>(
    script: string,
    keys: string[],
    args: TArgs
  ): Promise<TData>;
}

/**
 * Compare-and-delete: remove `br:ops:mode` only if its `setAt` still matches the
 * value we just read.
 *
 * Two problems, one solution. Several warm instances can resolve the same expiry
 * in the same second, and an unconditional `DEL` also clobbers a manual write
 * that landed microseconds earlier. Keying the delete on `setAt` means exactly
 * one instance's delete succeeds, and a concurrent manual write (which changes
 * `setAt`) is never destroyed.
 *
 * `obj.setAt ~= tonumber(ARGV[1])` compares numerically on purpose. Lua 5.1's
 * `tostring` renders 1757203200000 as "1.7572032e+12", so a string comparison
 * would never match. Doubles are exact for integers below 2^53.
 */
const LIFT_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
local ok, obj = pcall(cjson.decode, cur)
if not ok then return 0 end
if obj['setAt'] ~= tonumber(ARGV[1]) then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

function logEntry(mode: OpsMode, at: number, liftedSetAt?: number): OpsLogEntry {
  const entry: OpsLogEntry = {
    state: mode.state,
    reason: mode.reason,
    until: mode.until,
    at,
  };
  if (liftedSetAt !== undefined) entry.liftedSetAt = liftedSetAt;
  return entry;
}

async function appendLog(client: OpsRedis, entry: OpsLogEntry): Promise<void> {
  await client.lpush(OPS_LOG_KEY, entry);
  await client.ltrim(OPS_LOG_KEY, 0, OPS_LOG_MAX - 1);
}

/**
 * Lift an expired state and record it.
 *
 * An expiry **is** a state change, and "log every toggle with reason and
 * timestamp" has to cover the transitions nobody typed — otherwise the audit
 * trail shows a site going down and never coming back up. Returns whether this
 * caller was the one that wrote the entry, which is what the race test asserts.
 */
export async function liftExpired(
  client: OpsRedis,
  expired: OpsMode,
  now: number
): Promise<boolean> {
  let won = false;

  try {
    const deleted = await client.eval<[string], number>(
      LIFT_SCRIPT,
      [OPS_MODE_KEY],
      [String(expired.setAt)]
    );
    won = Number(deleted) === 1;
  } catch {
    // EVAL unavailable or rejected. Fall back to an unconditional delete plus a
    // head-of-log dedupe, as planned. `del` still returns 1 for exactly one
    // caller, so the log stays single-writer; what is lost is the protection
    // against clobbering a manual write that landed in the same instant.
    try {
      const deleted = await client.del(OPS_MODE_KEY);
      won = Number(deleted) === 1;
      if (!won) return false;

      const head = await client.lrange<unknown>(OPS_LOG_KEY, 0, 0);
      const prev = head && head.length ? parseLogEntry(head[0]) : null;
      if (prev && prev.reason === AUTO_LIFT_REASON && prev.liftedSetAt === expired.setAt) {
        return false; // already recorded by another instance
      }
    } catch {
      return false;
    }
  }

  if (!won) return false;

  invalidateOpsCache();
  try {
    await appendLog(
      client,
      logEntry({ ...LIVE, reason: AUTO_LIFT_REASON, setAt: now }, now, expired.setAt)
    );
  } catch {
    // The state is lifted, which is what matters. A missing audit line is not
    // worth failing a request over.
    return false;
  }
  return true;
}

export function parseLogEntry(raw: unknown): OpsLogEntry | null {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isOpsState(o.state)) return null;
  return {
    state: o.state,
    reason: typeof o.reason === 'string' ? o.reason : '',
    until: typeof o.until === 'number' ? o.until : null,
    at: typeof o.at === 'number' ? o.at : 0,
    ...(typeof o.liftedSetAt === 'number' ? { liftedSetAt: o.liftedSetAt } : {}),
  };
}

// ─── Module-scope cache ──────────────────────────────────────────────────────

let cached: { mode: OpsMode; at: number } | null = null;

/** Called by `writeOpsMode` and by a successful auto-lift. Exported for tests. */
export function invalidateOpsCache(): void {
  cached = null;
}

function forceDownEnabled(): boolean {
  return process.env.OPS_FORCE_DOWN === '1';
}

/**
 * The uncached read, against an explicit client.
 *
 * Split out from `readOpsMode` so `lib/ops/state.test.ts` can drive the
 * fail-open path with a client that throws. That path is the single most
 * important line in this file — it is the one whose regression takes the public
 * site *down* rather than leaving it up — and it is not something a curl probe
 * can reach without breaking the real Upstash credentials.
 */
export async function readOpsModeWith(
  client: OpsRedis | null,
  now: number
): Promise<OpsMode> {
  // No Upstash configured (local checkouts, preview builds without creds).
  // There is nowhere for a state to live, so the site is live. The dev panel
  // says so rather than accepting writes that go nowhere.
  if (!client) return LIVE;

  let raw: unknown;
  try {
    raw = await client.get(OPS_MODE_KEY);
  } catch {
    return LIVE; // fail open
  }

  const { mode, expired } = resolveOpsMode(raw, now, false);

  if (expired) {
    // Fire and forget: the effective answer is already `live`, and the request
    // must not wait on the bookkeeping.
    void liftExpired(client, expired, now).catch(() => {});
  }

  return mode;
}

/**
 * The read every request goes through.
 *
 * Note the ordering: the break-glass is checked *before* the cache, so it is
 * both free and immune to a stale cached `live`.
 */
export async function readOpsMode(now: number = Date.now()): Promise<OpsMode> {
  if (forceDownEnabled()) return FORCED_DOWN;

  if (cached && now - cached.at < OPS_CACHE_TTL_MS) return cached.mode;

  const mode = await readOpsModeWith(redis as unknown as OpsRedis | null, now);
  cached = { mode, at: now };
  return mode;
}

/** Write a new state and append to the audit log. Returns the stored mode. */
export async function writeOpsMode(
  next: { state: OpsState; reason?: string; until?: number | null },
  now: number = Date.now()
): Promise<{ ok: boolean; mode: OpsMode }> {
  const mode: OpsMode = {
    state: next.state,
    reason: normalizeReason(next.reason),
    until:
      typeof next.until === 'number' && Number.isFinite(next.until) ? next.until : null,
    setAt: now,
  };

  // Bust the local cache first, so the panel reflects its own write on the next
  // read even if the log append below fails.
  invalidateOpsCache();

  if (!redis) return { ok: false, mode };

  const client = redis as unknown as OpsRedis;
  try {
    await client.set(OPS_MODE_KEY, mode);
  } catch {
    return { ok: false, mode };
  }

  try {
    await appendLog(client, logEntry(mode, now));
  } catch {
    // State is set; the audit line is not worth failing the toggle over.
  }

  return { ok: true, mode };
}

/** Most recent entries, newest first. Empty when Redis is absent or errors. */
export async function readOpsLog(limit = 20): Promise<OpsLogEntry[]> {
  if (!redis) return [];
  try {
    const rows = await (redis as unknown as OpsRedis).lrange<unknown>(
      OPS_LOG_KEY,
      0,
      Math.max(0, limit - 1)
    );
    return (rows ?? [])
      .map(parseLogEntry)
      .filter((e): e is OpsLogEntry => e !== null);
  } catch {
    return [];
  }
}

/** True when a state can actually be stored. Surfaced in the panel. */
export function isOpsStoreConfigured(): boolean {
  return redis !== null;
}

/** True when the break-glass env var is set. Surfaced in the panel, because a
 *  forced outage cannot be cleared from the panel and saying so avoids a very
 *  confusing five minutes. */
export function isForceDownActive(): boolean {
  return forceDownEnabled();
}

/**
 * `Retry-After`, in seconds, derived from `until`.
 *
 * A flat 900 on a two-hour window tells clients and crawlers to come back six
 * times too early. The whole reason for serving a real 503 rather than a
 * rewritten 200 is that these headers are believed, so the header has to be
 * true. Clamped so a 10-second window does not produce a thundering retry and a
 * three-day window does not tell a crawler to disappear for three days.
 */
export function retryAfterSeconds(mode: OpsMode, now: number = Date.now()): number {
  if (mode.until === null) return 900;
  const remaining = Math.ceil((mode.until - now) / 1000);
  return Math.min(3600, Math.max(60, remaining));
}

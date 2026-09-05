import { type NextRequest } from 'next/server';
import { rateLimit } from '@/lib/ratelimit';
import { redis } from '@/lib/redis';

/**
 * Drive time from one origin to many sightings, via the OpenRouteService
 * Matrix API.
 *
 * ─── Why this is a server route at all ───────────────────────────────────────
 *
 * Two independent reasons, either of which alone is sufficient:
 *
 *   1. `ORS_API_KEY` is server-only. It is never `NEXT_PUBLIC_`, so it cannot be
 *      read from the browser.
 *   2. `next.config.ts` sets `connect-src 'self'`. A browser-side call to
 *      api.openrouteservice.org is blocked by CSP before it leaves the page.
 *
 * The proxy is structural, not stylistic. Do not "simplify" it into a client
 * fetch.
 *
 * ─── The contract this route keeps ───────────────────────────────────────────
 *
 * It never throws to the client and never returns a non-2xx for an upstream
 * problem. A duration it cannot obtain comes back as `null`, and the UI renders
 * a null as *no badge*. Every failure path below — no API key, ORS down, quota
 * spent, unroutable point, handler out of time — funnels into the same `null`.
 * That is the specified failure mode: the badge is simply absent.
 *
 * The one exception is a malformed request (400) and per-IP flooding (429),
 * which are the caller's problem, not the upstream's.
 */

export const runtime = 'nodejs';

/**
 * Platform execution ceiling. `HANDLER_DEADLINE_MS` below must stay comfortably
 * under it; the two live in the same file so they cannot drift apart. Sequential
 * chunks at an 8 s upstream timeout each have no collective ceiling of their own,
 * and a platform-level timeout would surface as a 500 — breaking the contract
 * above.
 */
export const maxDuration = 15;

const ORS_MATRIX_URL = 'https://api.openrouteservice.org/v2/matrix/driving-car';

/** Matches lib/ebird-proxy.ts's UPSTREAM_TIMEOUT_MS. Per ORS request. */
const UPSTREAM_TIMEOUT_MS = 8_000;
/** Total wall clock for the handler, checked before each chunk. See maxDuration. */
const HANDLER_DEADLINE_MS = 9_000;

/**
 * Destinations per ORS request. ORS's documented hard restriction is 3,500
 * origin×destination pairs, so with a single source this is a conservative
 * choice rather than a forced one — its per-minute limiter is the real
 * constraint, which is also why chunks are issued sequentially.
 */
const CHUNK_SIZE = 50;
/** Ceiling on one client request. Larger sets are the caller's bug, not ours. */
const MAX_DESTINATIONS = 200;

const CACHE_TTL_MS = 15 * 60 * 1000;
/**
 * Failures are cached too, for much less time. Without negative caching a
 * permanently failing point is re-billed on every scroll burst; with a 15-minute
 * negative TTL a transient ORS blip would hide a badge for a quarter of an hour.
 */
const NEGATIVE_TTL_MS = 2 * 60 * 1000;

/**
 * Rolling-24 h call budget — a circuit breaker on the ORS key, modelled on
 * `EBIRD_UPSTREAM_BUDGET_PER_MIN` in lib/ebird-proxy.ts.
 *
 * Deliberately sized under the *lowest* quota ORS publishes. Its own pages give
 * 500, 2,000 and 2,500 for different endpoints and plans; the widely quoted
 * 2,000/day is the **directions** endpoint. A breaker set above the real matrix
 * ceiling never fires — ORS just starts returning 403 — so it is worth nothing.
 * Raise this only once the ORS dashboard shows what this key actually gets.
 */
const DAILY_BUDGET = Number(process.env.ORS_DAILY_BUDGET) || 450;

const MEMORY_CACHE_MAX_ENTRIES = 2_000;

/** Fallback lockout when ORS reports a daily-limit 403 with no Retry-After. */
const BREAKER_FALLBACK_MS = 60 * 60 * 1000;
/**
 * Much shorter lockout for an auth-shaped rejection. A bad key is an operator
 * error that gets corrected in minutes, and an hour-long module-level lockout
 * would outlive the fix and look like the feature is simply broken.
 */
const AUTH_LOCKOUT_S = 60;

type LatLng = [number, number];

// ─── Validation ───────────────────────────────────────────────────────────────

function isLatLng(v: unknown): v is LatLng {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    v[0] >= -90 &&
    v[0] <= 90 &&
    v[1] >= -180 &&
    v[1] <= 180
  );
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Coordinates are rounded before they are keyed *and* before they are sent, so a
 * cache entry can never describe a request that was not made.
 *
 * Origin at 3 dp (~110 m) keeps GPS jitter from thrashing the cache; destinations
 * at 4 dp (~11 m) is finer than any road the router will snap to.
 *
 * There is deliberately no privacy branch here. PhaseC_rationale.md §7.4 settles
 * it: a duration is a number with no address and no route, so it leaks strictly
 * less than the pin the user is already looking at, and excluding private
 * locations would strip the badge from the majority of sightings while protecting
 * nothing. Navigation is what `navigableTargets()` gates — not this.
 */
const roundOrigin = (c: LatLng): LatLng => [round(c[0], 3), round(c[1], 3)];
const roundDest = (c: LatLng): LatLng => [round(c[0], 4), round(c[1], 4)];

// ─── Cache (L1 in-memory + shared Redis) ─────────────────────────────────────
// Keyed per *destination*, not per destination set.
//
// The brief specified "origin + the sorted destination set" as the key. Keying
// per destination strictly dominates that: same TTL, same origin rounding, but it
// survives set churn. As the user scrolls the sidebar, the second batch overlaps
// the first by ~90%; a set-level key treats that as a total miss and re-bills
// every point in it. This bills only the genuinely new ones.

interface CacheEntry {
  expires: number;
  /** `null` is a real, cacheable value — "ORS could not give us a duration". */
  value: number | null;
}

const memoryCache = new Map<string, CacheEntry>();

function cacheKey(origin: LatLng, dest: LatLng): string {
  return `${origin[0]},${origin[1]}|${dest[0]},${dest[1]}`;
}

function memoryGet(key: string): CacheEntry | undefined {
  const hit = memoryCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    memoryCache.delete(key);
    return undefined;
  }
  return hit;
}

function memorySet(key: string, value: number | null, ttlMs: number): void {
  if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES && !memoryCache.has(key)) {
    // Evict oldest-inserted (Map preserves insertion order), as ebird-proxy does.
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) memoryCache.delete(oldest);
  }
  memoryCache.set(key, { expires: Date.now() + ttlMs, value });
}

/**
 * Redis stores `{ v: <duration|null> }` rather than the bare value. A bare `null`
 * is indistinguishable from a miss through `redis.get`, which would silently turn
 * every cached failure into a re-billed lookup.
 */
async function cacheGetMany(keys: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();

  const missing: string[] = [];
  for (const key of keys) {
    const hit = memoryGet(key);
    if (hit) out.set(key, hit.value);
    else missing.push(key);
  }

  if (missing.length === 0 || !redis) return out;

  try {
    const rows = await redis.mget<({ v: number | null } | null)[]>(
      ...missing.map((k) => `br:dt:${k}`)
    );
    rows.forEach((row, i) => {
      if (row && typeof row === 'object' && 'v' in row) {
        // Promote into L1 so the next batch in this instance skips Redis too.
        // TTL is unknown here; the shorter one is the safe assumption.
        memorySet(missing[i], row.v, NEGATIVE_TTL_MS);
        out.set(missing[i], row.v);
      }
    });
  } catch {
    // Upstash unreachable — the L1 answers we already have still stand.
  }

  return out;
}

async function cacheSet(key: string, value: number | null, ttlMs: number): Promise<void> {
  memorySet(key, value, ttlMs);
  if (!redis) return;
  try {
    await redis.set(`br:dt:${key}`, { v: value }, { px: ttlMs });
  } catch {
    // Upstash unreachable — the memory copy still serves this instance.
  }
}

// ─── Budget + circuit breaker ────────────────────────────────────────────────

let memBudgetCount = 0;
let memBudgetResetAt = 0;
let breakerUntil = 0;

/**
 * Quota remaining as *ORS itself* last reported it. Preferred over the local
 * counter whenever present: the local counter is only ever an estimate, and it
 * counts calls from this deployment alone.
 *
 * Opportunistic. ORS's *error* responses were checked and carry no
 * `x-ratelimit-*` headers at all; whether its success responses do has not been
 * verified against a live key. The local budget is therefore the real guard and
 * this is a refinement on top of it — never the other way round.
 */
let reportedRemaining: number | null = null;

/**
 * ORS's daily limit resets 24 h after the key's *first* request, so the window
 * slides from day to day. A UTC-date bucket drifts out of phase with it, and the
 * two errors are not symmetric: counting ahead of ORS wastes quota you actually
 * have, while counting behind it means hammering a key ORS has already cut off.
 * `INCR` plus `EXPIRE 86400` on the first write reproduces ORS's own semantics.
 */
async function takeBudget(): Promise<boolean> {
  if (redis) {
    try {
      const key = 'br:ors:budget';
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 86_400);
      return count <= DAILY_BUDGET;
    } catch {
      // Upstash unreachable — fall through to the per-instance counter.
    }
  }

  const now = Date.now();
  if (now >= memBudgetResetAt) {
    memBudgetResetAt = now + 86_400_000;
    memBudgetCount = 0;
  }
  memBudgetCount++;
  return memBudgetCount <= DAILY_BUDGET;
}

/**
 * ORS answers a spent daily limit with 403 and a spent per-minute limit with 429.
 * Only the first trips this: it means the key is done for the rest of its window,
 * and retrying every two minutes behind a negative cache is exactly the hammering
 * a breaker exists to prevent — and how a free key gets flagged.
 */
async function tripBreaker(retryAfterSec: number | null): Promise<void> {
  const ms =
    retryAfterSec !== null && Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? retryAfterSec * 1000
      : BREAKER_FALLBACK_MS;
  breakerUntil = Math.max(breakerUntil, Date.now() + ms);
  if (!redis) return;
  try {
    await redis.set('br:ors:blocked', 1, { px: ms });
  } catch {
    // Upstash unreachable — the in-memory lockout still holds for this instance.
  }
}

async function breakerOpen(): Promise<boolean> {
  if (Date.now() < breakerUntil) return true;
  if (reportedRemaining !== null && reportedRemaining <= 0) return true;
  if (!redis) return false;
  try {
    return (await redis.get('br:ors:blocked')) !== null;
  } catch {
    return false;
  }
}

// ─── ORS ─────────────────────────────────────────────────────────────────────

type ChunkResult =
  | { ok: true; durations: (number | null)[] }
  | {
      ok: false;
      /** False for 429 and breaker trips — those must retry cleanly, not be poisoned. */
      cacheable: boolean;
      /** Stop the whole handler: quota is spent, further chunks would only add load. */
      fatal: boolean;
      /**
       * Index into `chunk` of the point ORS refused to route to (error 2010),
       * **already corrected** for the origin sitting at `locations[0]`. `null`
       * when the failure was something else.
       */
      unroutableIndex: number | null;
    };

function readRemaining(res: Response): void {
  const raw = res.headers.get('x-ratelimit-remaining');
  if (raw === null) return;
  const n = Number(raw);
  if (Number.isFinite(n)) reportedRemaining = n;
}

function retryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * ORS error 2010 ("Could not find routable point within a radius of N meters of
 * specified coordinate K: lon lat") names the offending coordinate. Pull K out so
 * one unroutable point costs one badge instead of fifty.
 *
 * K indexes `locations`, where the origin sits at 0 — the same off-by-one trap as
 * the `destinations` array below. Callers must subtract 1 to reach `chunk`.
 */
function unroutableLocationIndex(body: string): number | null {
  const match = /specified coordinate (\d+)/i.exec(body);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function callOrs(
  apiKey: string,
  origin: LatLng,
  chunk: LatLng[]
): Promise<ChunkResult> {
  // ─── The one coordinate-order swap site in the codebase ───────────────────
  // ORS takes [longitude, latitude]. Everything else in BirdRadar — eBird,
  // Leaflet, every prop and every cache key — is [latitude, longitude]. This is
  // the single place the two meet. Swapping anywhere else, or here twice, yields
  // plausible-looking durations attached to the wrong birds.
  const locations = [origin, ...chunk].map(([lat, lng]) => [lng, lat]);

  const body = {
    locations,
    sources: [0],
    // Explicit, and load-bearing. `sources` and `destinations` are index arrays
    // into `locations` and BOTH DEFAULT TO `all`. Leaving this out makes the
    // origin a destination too: the row comes back with length N+1, a leading 0
    // for origin→origin, and every real duration shifted one place. Reading
    // durations[0][i] would then attach each badge to the previous location —
    // a wrong answer that looks entirely reasonable, which is worse than a crash.
    destinations: chunk.map((_, i) => i + 1),
    metrics: ['duration'],
  };

  let res: Response;
  try {
    res = await fetch(ORS_MATRIX_URL, {
      method: 'POST',
      headers: {
        // The RAW key, with no "Bearer " prefix — the format ORS's own examples,
        // its forum and its Python client all use. The original brief specified a
        // Bearer token; that is not how this API is documented.
        //
        // Measured against the live API rather than assumed, because the failure
        // is otherwise easy to misdiagnose:
        //   • no Authorization header at all → 401 {"error":"Authorization field missing"}
        //   • present but invalid key        → 403 {"error":"Access to this API has been disallowed"}
        // Both prefixed and bare forms of an *invalid* key return the same 403,
        // so a probe with a bad key cannot tell you which format is correct.
        // Follow the documented one.
        Authorization: apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Timeout or network failure.
    return { ok: false, cacheable: true, fatal: false, unroutableIndex: null };
  }

  readRemaining(res);

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      // Both mean "stop calling", but for different reasons and different
      // durations. Measured against the live API:
      //
      //   401 "Authorization field missing"          — malformed/absent header
      //   403 "Access to this API has been disallowed" — key rejected
      //   403 (quota wording)                         — daily limit spent
      //
      // ORS overloads 403 across a spent quota AND a bad key, so the status alone
      // cannot be trusted to mean "quota". Locking a *misconfigured* key out for
      // an hour is the wrong call: the operator fixes the key and still sees no
      // badges, with nothing to tell them why. A short lockout stops a request
      // storm either way and lets a corrected key recover on its own.
      const body = await res.text().catch(() => '');
      const looksLikeAuth = /disallowed|authorization|api.?key/i.test(body);
      await tripBreaker(looksLikeAuth ? AUTH_LOCKOUT_S : retryAfterSeconds(res));
      return { ok: false, cacheable: false, fatal: true, unroutableIndex: null };
    }
    if (res.status === 429) {
      // Per-minute limit. Back off, but do not poison these destinations for two
      // minutes — the next batch should retry them cleanly.
      return { ok: false, cacheable: false, fatal: true, unroutableIndex: null };
    }

    // 400-class: most often error 2010, an unroutable point. The index is read
    // from *this* response rather than re-probed with another request — the body
    // is already in hand, and a probe would cost a second call from the same
    // quota this whole module exists to protect.
    const locIndex = unroutableLocationIndex(await res.text().catch(() => ''));
    // locations[0] is the origin, so locations[k] is chunk[k - 1].
    const chunkIndex = locIndex === null ? null : locIndex - 1;
    return {
      ok: false,
      cacheable: true,
      fatal: false,
      unroutableIndex:
        chunkIndex !== null && chunkIndex >= 0 && chunkIndex < chunk.length ? chunkIndex : null,
    };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, cacheable: true, fatal: false, unroutableIndex: null };
  }

  const row = (json as { durations?: unknown[][] })?.durations?.[0];
  if (!Array.isArray(row) || row.length !== chunk.length) {
    // A length mismatch means the request was not shaped the way this code
    // believes — most likely `destinations` went missing, which would put
    // origin→origin at index 0 and shift every real duration one place. Refuse to
    // guess at the alignment; a shifted badge is worse than an absent one.
    return { ok: false, cacheable: true, fatal: false, unroutableIndex: null };
  }

  return {
    ok: true,
    durations: row.map((d) => (typeof d === 'number' && Number.isFinite(d) ? d : null)),
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: NextRequest) {
  if (await rateLimit(request, 'drive-time', 20, 60)) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': '60' } }
    );
  }

  let payload: { origin?: unknown; destinations?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
  }

  if (!isLatLng(payload.origin)) {
    return Response.json({ error: 'Invalid origin' }, { status: 400, headers: NO_STORE });
  }
  if (
    !Array.isArray(payload.destinations) ||
    payload.destinations.length === 0 ||
    payload.destinations.length > MAX_DESTINATIONS ||
    !payload.destinations.every(isLatLng)
  ) {
    return Response.json(
      { error: `destinations must be 1–${MAX_DESTINATIONS} [lat, lng] pairs` },
      { status: 400, headers: NO_STORE }
    );
  }

  const origin = roundOrigin(payload.origin);
  const destinations = payload.destinations.map(roundDest);

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    // Not a 500. The specified failure mode is an absent badge, and `configured`
    // lets a developer see the misconfiguration without a red console.
    return Response.json(
      { durations: destinations.map(() => null), configured: false },
      { headers: NO_STORE }
    );
  }

  const results: (number | null)[] = new Array(destinations.length).fill(null);

  // ─── Cache pass ───────────────────────────────────────────────────────────
  const keys = destinations.map((d) => cacheKey(origin, d));
  const cached = await cacheGetMany(keys);

  /** Indices still needing an upstream answer, deduped by cache key — the same
   *  location can legitimately appear twice in one batch. */
  const pendingByKey = new Map<string, number[]>();
  for (let i = 0; i < destinations.length; i++) {
    const key = keys[i];
    if (cached.has(key)) {
      results[i] = cached.get(key)!;
      continue;
    }
    const bucket = pendingByKey.get(key);
    if (bucket) bucket.push(i);
    else pendingByKey.set(key, [i]);
  }

  const pending = Array.from(pendingByKey.entries()).map(([key, indices]) => ({
    key,
    indices,
    dest: destinations[indices[0]],
  }));

  if (pending.length === 0) {
    return Response.json({ durations: results }, { headers: NO_STORE });
  }

  if (await breakerOpen()) {
    // Quota spent. Cache hits stand; everything else is an absent badge.
    return Response.json({ durations: results }, { headers: NO_STORE });
  }

  // ─── Upstream pass ────────────────────────────────────────────────────────
  const deadline = Date.now() + HANDLER_DEADLINE_MS;

  for (let start = 0; start < pending.length; start += CHUNK_SIZE) {
    // Checked before each chunk rather than raced against: once the budget of
    // wall clock is gone, the remaining destinations stay `null` and the client's
    // next scroll re-requests only what is still missing. The work resumes rather
    // than being lost, and the handler never hits the platform ceiling.
    if (Date.now() >= deadline) break;
    if (!(await takeBudget())) break;

    let slice = pending.slice(start, start + CHUNK_SIZE);
    let result = await callOrs(apiKey, origin, slice.map((p) => p.dest));

    // One retry, and only for an unroutable point (ORS error 2010). Phase C
    // established that most sightings sit at personal locations — pullouts and
    // trail junctions that may not snap to the road graph — so a single bad point
    // taking out 49 good badges is a live case, not a theoretical one.
    //
    // Capped at one retry per chunk: two unroutable points in the same 50 fall
    // back to the negative-cache path rather than looping through the quota.
    if (!result.ok && result.unroutableIndex !== null && slice.length > 1) {
      const dropped = slice[result.unroutableIndex];
      await cacheSet(dropped.key, null, NEGATIVE_TTL_MS);
      slice = slice.filter((p) => p !== dropped);
      if (Date.now() < deadline && (await takeBudget())) {
        result = await callOrs(apiKey, origin, slice.map((p) => p.dest));
      }
    }

    if (result.ok) {
      for (let i = 0; i < slice.length; i++) {
        const value = result.durations[i];
        for (const idx of slice[i].indices) results[idx] = value;
        await cacheSet(slice[i].key, value, value === null ? NEGATIVE_TTL_MS : CACHE_TTL_MS);
      }
      continue;
    }

    if (result.cacheable) {
      for (const p of slice) await cacheSet(p.key, null, NEGATIVE_TTL_MS);
    }
    // 403 and 429 leave the keys uncached so the next batch retries cleanly, and
    // a 403 has already opened the breaker.
    if (result.fatal) break;
  }

  return Response.json({ durations: results }, { headers: NO_STORE });
}

import { type NextRequest } from 'next/server';
import { redis } from './redis';
import { rateLimit, peekRateLimit } from './ratelimit';
import { readDevSession } from './dev/auth';

/**
 * Shared eBird plumbing for all /api/ebird/* routes and the server-side push
 * watcher: input validation, per-IP rate limiting, a global upstream-call
 * budget, fresh/stale response caching, and CDN Cache-Control headers.
 *
 * When Upstash Redis is configured, rate limits, the upstream budget, and the
 * response cache are shared across all serverless instances. Without it,
 * everything degrades to per-instance in-memory behavior so local dev needs no
 * credentials. Every Redis call is wrapped so an Upstash outage degrades to
 * in-memory behavior instead of taking the API down.
 */

const EBIRD_BASE = 'https://api.ebird.org/v2';
const UPSTREAM_TIMEOUT_MS = 8_000;
/** Max upstream eBird calls per minute across the whole deployment — protects
 *  the single API key from cache-busting lat/lng permutation attacks.
 *  Tunable via env so ops can react to eBird quota changes without a deploy. */
const UPSTREAM_BUDGET_PER_MIN =
  Number(process.env.EBIRD_UPSTREAM_BUDGET_PER_MIN) || 100;
/** How long a stale copy of a response stays servable after freshness expires */
const STALE_TTL_MS = 24 * 60 * 60 * 1000;

// ─── Validation ───────────────────────────────────────────────────────────────

export interface GeoParams {
  lat: number;
  lng: number;
  dist: number;
}

/**
 * Parse and validate lat/lng/dist query params.
 * Coordinates are rounded to 2 decimals (~1.1 km) so nearby users share the
 * same upstream request and cache entry.
 */
export function parseGeoParams(searchParams: URLSearchParams): GeoParams | { error: string } {
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const dist = searchParams.get('dist') ?? '25';

  if (!lat || !lng) return { error: 'lat and lng are required' };

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return { error: 'Invalid coordinates' };
  }
  const distNum = Math.min(Math.max(parseInt(dist, 10) || 25, 1), 50);

  return {
    lat: Math.round(latNum * 100) / 100,
    lng: Math.round(lngNum * 100) / 100,
    dist: distNum,
  };
}

export function isGeoError(p: GeoParams | { error: string }): p is { error: string } {
  return 'error' in p;
}

// ─── Global upstream budget (circuit breaker for the eBird API key) ──────────

let memoryBudgetBucket = 0;
let memoryBudgetCount = 0;

/** Returns true if this upstream call is within budget. Consumes one token. */
async function takeUpstreamBudget(): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 60_000);

  if (redis) {
    try {
      const key = `br:budget:${bucket}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 120);
      return count <= UPSTREAM_BUDGET_PER_MIN;
    } catch {
      // Upstash unreachable — fall through to the per-instance counter
    }
  }

  if (bucket !== memoryBudgetBucket) {
    memoryBudgetBucket = bucket;
    memoryBudgetCount = 0;
  }
  memoryBudgetCount++;
  return memoryBudgetCount <= UPSTREAM_BUDGET_PER_MIN;
}

// ─── Response cache (L1 in-memory + shared Redis, with stale copies) ─────────

/**
 * Which tier answered. Reported to a verified developer session through
 * `x-br-cache`; `'miss'` also covers a bypass that then went upstream.
 */
export type CacheTier =
  | 'memory-fresh'
  | 'memory-stale'
  | 'redis-fresh'
  | 'redis-stale'
  | 'miss'
  | 'bypass';

/**
 * A cache answer plus where it came from.
 *
 * ─── Why `ageMs` is null for the Redis tiers ─────────────────────────────────
 *
 * `storedAt` is added to the in-memory entry, where it costs one number. The
 * Redis tier stores the payload **raw** (`redis.set('br:fresh:' + key, data)`),
 * so age is not recoverable from it — and it stays that way deliberately.
 * Wrapping the value as `{ v, at }` to carry a timestamp would invalidate every
 * existing shared cache entry on deploy, producing a cold-start burst against
 * the eBird upstream budget, and would add an unwrap to every read path — all to
 * put a number on a debug overlay.
 *
 * So the overlay shows an exact age for a memory hit and a dash for a Redis hit.
 * A dash is the honest answer; a `0` would be a fabricated one. Same rule as the
 * odds chip in `PhaseE1_fixes.md` §4e: an unknown value must never borrow the
 * look of a known one.
 */
interface CacheHit {
  data: unknown;
  tier: CacheTier;
  ageMs: number | null;
}

interface CacheEntry {
  freshUntil: number;
  staleUntil: number;
  /** For the debug overlay only. Nothing in the request path reads it. */
  storedAt: number;
  data: unknown;
}

const MEMORY_CACHE_MAX_ENTRIES = 200;
const responseCache = new Map<string, CacheEntry>();

function memoryCacheGet(key: string, allowStale: boolean): CacheHit | undefined {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  const now = Date.now();
  const ageMs = now - entry.storedAt;
  if (now <= entry.freshUntil) return { data: entry.data, tier: 'memory-fresh', ageMs };
  if (allowStale && now <= entry.staleUntil) {
    return { data: entry.data, tier: 'memory-stale', ageMs };
  }
  if (now > entry.staleUntil) responseCache.delete(key);
  return undefined;
}

function memoryCacheSet(key: string, data: unknown, ttlMs: number): void {
  if (responseCache.size >= MEMORY_CACHE_MAX_ENTRIES && !responseCache.has(key)) {
    // Evict oldest-inserted entry (Map preserves insertion order)
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  const now = Date.now();
  responseCache.set(key, {
    freshUntil: now + ttlMs,
    staleUntil: now + STALE_TTL_MS,
    storedAt: now,
    data,
  });
}

async function cacheGetFresh(key: string): Promise<CacheHit | undefined> {
  const memory = memoryCacheGet(key, false);
  if (memory !== undefined) return memory;

  if (redis) {
    try {
      const data = await redis.get(`br:fresh:${key}`);
      if (data !== null && data !== undefined) {
        return { data, tier: 'redis-fresh', ageMs: null };
      }
    } catch {
      // Upstash unreachable — treat as miss
    }
  }
  return undefined;
}

async function cacheGetStale(key: string): Promise<CacheHit | undefined> {
  const memory = memoryCacheGet(key, true);
  if (memory !== undefined) return memory;

  if (redis) {
    try {
      const data = await redis.get(`br:stale:${key}`);
      if (data !== null && data !== undefined) {
        return { data, tier: 'redis-stale', ageMs: null };
      }
    } catch {
      // Upstash unreachable — treat as miss
    }
  }
  return undefined;
}

async function cacheSet(key: string, data: unknown, ttlMs: number): Promise<void> {
  memoryCacheSet(key, data, ttlMs);

  if (redis) {
    try {
      await Promise.all([
        redis.set(`br:fresh:${key}`, data, { px: ttlMs }),
        redis.set(`br:stale:${key}`, data, { px: STALE_TTL_MS }),
      ]);
    } catch {
      // Upstash unreachable — memory copy still serves this instance
    }
  }
}

// ─── Core cached fetch (shared by the HTTP proxy and the push watcher) ────────

export type EbirdResult =
  | { ok: true; data: unknown; stale: boolean; tier: CacheTier; ageMs: number | null }
  | { ok: false; status: number; error: string; tier: CacheTier };

export interface FetchEbirdOptions {
  /**
   * Skip **both** cache tiers on the way in. Set only for a request carrying
   * `x-dev-nocache: 1` on a verified developer session — see `proxyEbird`.
   *
   * The result is still *written* to the cache, so this is a forced refresh
   * rather than a private read: the next ordinary visitor benefits. The stale
   * fallback on error is also still in play, because "I asked for fresh data"
   * is not a reason to prefer an error page over a day-old answer.
   */
  bypassCache?: boolean;
}

/**
 * Fetch an eBird path through the shared cache + global budget, with stale
 * fallback on error/timeout/budget-exhaustion. No per-IP rate limiting — the
 * HTTP proxy layers that on; server-side callers (the watcher) skip it.
 */
export async function fetchEbirdCached(
  upstreamPath: string,
  sMaxAge: number,
  transform?: (data: unknown) => unknown,
  options?: FetchEbirdOptions
): Promise<EbirdResult> {
  const apiKey = process.env.EBIRD_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 500, error: 'Server configuration error', tier: 'miss' };
  }

  if (!options?.bypassCache) {
    const cached = await cacheGetFresh(upstreamPath);
    if (cached !== undefined) {
      return { ok: true, data: cached.data, stale: false, tier: cached.tier, ageMs: cached.ageMs };
    }
  }

  // Only cache misses consume upstream budget; when the deployment-wide budget
  // is exhausted, serve stale data rather than hammering the eBird key.
  //
  // A bypass consumes budget exactly like a miss, which is the point: it is a
  // debugging tool, not a free refresh. UPSTREAM_BUDGET_PER_MIN is shared across
  // every instance *and* every local dev server (phaseB_rationale.md §6), so
  // holding the flag on through a busy session can starve the real app.
  if (!(await takeUpstreamBudget())) {
    const stale = await cacheGetStale(upstreamPath);
    if (stale !== undefined) {
      return { ok: true, data: stale.data, stale: true, tier: stale.tier, ageMs: stale.ageMs };
    }
    return { ok: false, status: 503, error: 'Service is busy, please retry shortly', tier: 'miss' };
  }

  try {
    const res = await fetch(`${EBIRD_BASE}${upstreamPath}`, {
      headers: { 'X-eBirdApiToken': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!res.ok) {
      const stale = await cacheGetStale(upstreamPath);
      if (stale !== undefined) {
        return { ok: true, data: stale.data, stale: true, tier: stale.tier, ageMs: stale.ageMs };
      }
      return {
        ok: false,
        status: res.status,
        error: `eBird API error: ${res.status}`,
        tier: 'miss',
      };
    }

    const raw = await res.json();
    const data = transform ? transform(raw) : raw;
    await cacheSet(upstreamPath, data, sMaxAge * 1000);
    return {
      ok: true,
      data,
      stale: false,
      tier: options?.bypassCache ? 'bypass' : 'miss',
      ageMs: 0,
    };
  } catch {
    // Timeout or network failure — a day-old answer beats an error page
    const stale = await cacheGetStale(upstreamPath);
    if (stale !== undefined) {
      return { ok: true, data: stale.data, stale: true, tier: stale.tier, ageMs: stale.ageMs };
    }
    return { ok: false, status: 500, error: 'Failed to fetch from eBird', tier: 'miss' };
  }
}

/**
 * Read-only snapshot of the deployment-wide upstream budget, for the Developer
 * Mode overlay. Consumes nothing. Returns `used: null` when the answer is not
 * knowable (no Redis, or Upstash unreachable) rather than guessing.
 */
export async function peekUpstreamBudget(): Promise<{
  used: number | null;
  max: number;
  bucket: number;
}> {
  const bucket = Math.floor(Date.now() / 60_000);
  const max = UPSTREAM_BUDGET_PER_MIN;

  if (redis) {
    try {
      const raw = await redis.get<number>(`br:budget:${bucket}`);
      return { used: typeof raw === 'number' ? raw : Number(raw ?? 0), max, bucket };
    } catch {
      return { used: null, max, bucket };
    }
  }

  // Per-instance counter. Only meaningful for the bucket it belongs to.
  return { used: bucket === memoryBudgetBucket ? memoryBudgetCount : 0, max, bucket };
}

// ─── HTTP proxy (per-IP rate-limited wrapper around fetchEbirdCached) ─────────

export interface ProxyOptions {
  /** Path + query under https://api.ebird.org/v2 (no leading base) */
  upstreamPath: string;
  /** CDN cache TTL in seconds (Cache-Control s-maxage) */
  sMaxAge: number;
  /** stale-while-revalidate window in seconds */
  staleWhileRevalidate: number;
  /** Applied to the upstream JSON before caching/returning (e.g. field stripping) */
  transform?: (data: unknown) => unknown;
}

/** eBird proxy per-IP limit. Named so `proxyEbird` and the debug peek agree. */
const EBIRD_RATE_LIMIT = { name: 'ebird', max: 30, windowSec: 60 } as const;

/**
 * Debug headers for a verified developer session.
 *
 * Everything here is gated on `readDevSession(request.cookies)` and is
 * unreachable without it — including the cache bypass. A forged `br_dev_flags`
 * cookie gets none of it: `readDevSession` reads `br_dev`, which is httpOnly and
 * HMAC-signed, and ignores the flags cookie entirely.
 *
 * Attached to the *response* so the overlay reads real per-request numbers off
 * the very fetches the page just made, rather than polling something adjacent
 * and hoping it correlates.
 */
async function devDebugHeaders(
  request: NextRequest,
  result: EbirdResult
): Promise<Record<string, string>> {
  const [budget, rateRemaining] = await Promise.all([
    peekUpstreamBudget(),
    peekRateLimit(request, EBIRD_RATE_LIMIT.name, EBIRD_RATE_LIMIT.max, EBIRD_RATE_LIMIT.windowSec),
  ]);

  const headers: Record<string, string> = {
    'x-br-cache': result.tier,
    'x-br-budget-max': String(budget.max),
    'x-br-ratelimit-max': String(EBIRD_RATE_LIMIT.max),
  };

  // Absent rather than a placeholder wherever the number is genuinely unknown.
  // A header that is missing reads as "unknown" in the overlay; a `0` would read
  // as a measurement.
  if (result.ok && result.ageMs !== null) headers['x-br-cache-age'] = String(result.ageMs);
  if (budget.used !== null) {
    headers['x-br-budget-remaining'] = String(Math.max(0, budget.max - budget.used));
  }
  if (rateRemaining !== null) headers['x-br-ratelimit-remaining'] = String(rateRemaining);

  return headers;
}

export async function proxyEbird(request: NextRequest, opts: ProxyOptions): Promise<Response> {
  // Local, synchronous, no I/O — an HMAC verify against a cookie.
  const isDev = readDevSession(request.cookies);

  if (
    await rateLimit(request, EBIRD_RATE_LIMIT.name, EBIRD_RATE_LIMIT.max, EBIRD_RATE_LIMIT.windowSec)
  ) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } }
    );
  }

  // The bypass requires a verified session, not merely the header. The header is
  // trivially forgeable; without this check any client could evict the shared
  // cache and drain the upstream budget at will.
  const bypassCache = isDev && request.headers.get('x-dev-nocache') === '1';

  const result = await fetchEbirdCached(opts.upstreamPath, opts.sMaxAge, opts.transform, {
    bypassCache,
  });

  const debug = isDev ? await devDebugHeaders(request, result) : {};

  if (!result.ok) {
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', ...debug };
    if (result.status === 503) headers['Retry-After'] = '30';
    return Response.json({ error: result.error }, { status: result.status, headers });
  }

  const headers: Record<string, string> = result.stale
    ? { 'Cache-Control': 'public, s-maxage=60', 'X-BirdRadar-Stale': '1' }
    : { 'Cache-Control': `public, s-maxage=${opts.sMaxAge}, stale-while-revalidate=${opts.staleWhileRevalidate}` };

  // A bypassed response must never be stored by a CDN — it was fetched
  // precisely to get around a cache, and letting it populate a shared one would
  // hand the developer's forced refresh to every subsequent visitor as if it
  // were a normal cacheable answer.
  if (bypassCache) headers['Cache-Control'] = 'no-store';

  return Response.json(result.data, { headers: { ...headers, ...debug } });
}

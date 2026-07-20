import { type NextRequest } from 'next/server';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

/**
 * Shared eBird proxy plumbing for all /api/ebird/* routes:
 * input validation, per-IP rate limiting, a global upstream-call budget,
 * fresh/stale response caching, and CDN Cache-Control headers.
 *
 * When Upstash Redis is configured (UPSTASH_REDIS_REST_URL/_TOKEN), rate
 * limits, the upstream budget, and the response cache are shared across all
 * serverless instances. Without it, everything degrades to the previous
 * per-instance in-memory behavior so local dev needs no credentials.
 *
 * Every Redis call is wrapped so an Upstash outage degrades to in-memory
 * behavior instead of taking the API down.
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

// ─── Redis (optional, shared across instances) ───────────────────────────────

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

// ─── Rate limiting (per-IP sliding window) ───────────────────────────────────

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;

const ratelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(RATE_MAX_REQUESTS, '60 s'),
      prefix: 'br:rl',
      // Short-circuits repeat offenders without a Redis round-trip
      ephemeralCache: new Map(),
    })
  : null;

// In-memory fallback limiter (per instance) when Redis is not configured
const ipHits = new Map<string, number[]>();

function clientIp(request: NextRequest): string {
  // x-real-ip is set by Vercel from the connecting socket and can't be spoofed
  // by the client; x-forwarded-for's leftmost entry is client-supplied on some
  // hosts, so it's only the fallback.
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = request.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'local';
}

async function isRateLimited(request: NextRequest): Promise<boolean> {
  const ip = clientIp(request);

  if (ratelimit) {
    try {
      const { success } = await ratelimit.limit(ip);
      return !success;
    } catch {
      // Upstash unreachable — fall through to the in-memory limiter
    }
  }

  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);

  // Bound memory: drop fully-expired IP buckets once the map grows large
  if (ipHits.size > 5_000) {
    for (const [key, arr] of ipHits) {
      if (arr.every((t) => now - t >= RATE_WINDOW_MS)) ipHits.delete(key);
    }
  }

  return hits.length > RATE_MAX_REQUESTS;
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

interface CacheEntry {
  freshUntil: number;
  staleUntil: number;
  data: unknown;
}

const MEMORY_CACHE_MAX_ENTRIES = 200;
const responseCache = new Map<string, CacheEntry>();

function memoryCacheGet(key: string, allowStale: boolean): unknown | undefined {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  const now = Date.now();
  if (now <= entry.freshUntil) return entry.data;
  if (allowStale && now <= entry.staleUntil) return entry.data;
  if (now > entry.staleUntil) responseCache.delete(key);
  return undefined;
}

function memoryCacheSet(key: string, data: unknown, ttlMs: number): void {
  if (responseCache.size >= MEMORY_CACHE_MAX_ENTRIES && !responseCache.has(key)) {
    // Evict oldest-inserted entry (Map preserves insertion order)
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, {
    freshUntil: Date.now() + ttlMs,
    staleUntil: Date.now() + STALE_TTL_MS,
    data,
  });
}

async function cacheGetFresh(key: string): Promise<unknown | undefined> {
  const memory = memoryCacheGet(key, false);
  if (memory !== undefined) return memory;

  if (redis) {
    try {
      const data = await redis.get(`br:fresh:${key}`);
      if (data !== null && data !== undefined) return data;
    } catch {
      // Upstash unreachable — treat as miss
    }
  }
  return undefined;
}

async function cacheGetStale(key: string): Promise<unknown | undefined> {
  const memory = memoryCacheGet(key, true);
  if (memory !== undefined) return memory;

  if (redis) {
    try {
      const data = await redis.get(`br:stale:${key}`);
      if (data !== null && data !== undefined) return data;
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

// ─── Proxy ────────────────────────────────────────────────────────────────────

export interface ProxyOptions {
  /** Path + query under https://api.ebird.org/v2 (no leading base) */
  upstreamPath: string;
  /** CDN cache TTL in seconds (Cache-Control s-maxage) */
  sMaxAge: number;
  /** stale-while-revalidate window in seconds */
  staleWhileRevalidate: number;
}

export async function proxyEbird(request: NextRequest, opts: ProxyOptions): Promise<Response> {
  if (await isRateLimited(request)) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } }
    );
  }

  const apiKey = process.env.EBIRD_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'Server configuration error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const cacheHeaders = {
    'Cache-Control': `public, s-maxage=${opts.sMaxAge}, stale-while-revalidate=${opts.staleWhileRevalidate}`,
  };
  // Stale responses get a short CDN TTL so a recovered upstream refreshes soon
  const staleHeaders = {
    'Cache-Control': 'public, s-maxage=60',
    'X-BirdRadar-Stale': '1',
  };

  const cached = await cacheGetFresh(opts.upstreamPath);
  if (cached !== undefined) {
    return Response.json(cached, { headers: cacheHeaders });
  }

  // Only cache misses consume upstream budget; when the deployment-wide budget
  // is exhausted, serve stale data rather than hammering the eBird key.
  if (!(await takeUpstreamBudget())) {
    const stale = await cacheGetStale(opts.upstreamPath);
    if (stale !== undefined) {
      return Response.json(stale, { headers: staleHeaders });
    }
    return Response.json(
      { error: 'Service is busy, please retry shortly' },
      { status: 503, headers: { 'Retry-After': '30', 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const res = await fetch(`${EBIRD_BASE}${opts.upstreamPath}`, {
      headers: { 'X-eBirdApiToken': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!res.ok) {
      const stale = await cacheGetStale(opts.upstreamPath);
      if (stale !== undefined) {
        return Response.json(stale, { headers: staleHeaders });
      }
      return Response.json(
        { error: `eBird API error: ${res.status}` },
        { status: res.status, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const data = await res.json();
    await cacheSet(opts.upstreamPath, data, opts.sMaxAge * 1000);
    return Response.json(data, { headers: cacheHeaders });
  } catch {
    // Timeout or network failure — a day-old answer beats an error page
    const stale = await cacheGetStale(opts.upstreamPath);
    if (stale !== undefined) {
      return Response.json(stale, { headers: staleHeaders });
    }
    return Response.json(
      { error: 'Failed to fetch from eBird' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

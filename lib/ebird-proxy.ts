import { type NextRequest } from 'next/server';
import { redis } from './redis';
import { rateLimit } from './ratelimit';

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

// ─── Core cached fetch (shared by the HTTP proxy and the push watcher) ────────

export type EbirdResult =
  | { ok: true; data: unknown; stale: boolean }
  | { ok: false; status: number; error: string };

/**
 * Fetch an eBird path through the shared cache + global budget, with stale
 * fallback on error/timeout/budget-exhaustion. No per-IP rate limiting — the
 * HTTP proxy layers that on; server-side callers (the watcher) skip it.
 */
export async function fetchEbirdCached(
  upstreamPath: string,
  sMaxAge: number,
  transform?: (data: unknown) => unknown
): Promise<EbirdResult> {
  const apiKey = process.env.EBIRD_API_KEY;
  if (!apiKey) return { ok: false, status: 500, error: 'Server configuration error' };

  const cached = await cacheGetFresh(upstreamPath);
  if (cached !== undefined) return { ok: true, data: cached, stale: false };

  // Only cache misses consume upstream budget; when the deployment-wide budget
  // is exhausted, serve stale data rather than hammering the eBird key.
  if (!(await takeUpstreamBudget())) {
    const stale = await cacheGetStale(upstreamPath);
    if (stale !== undefined) return { ok: true, data: stale, stale: true };
    return { ok: false, status: 503, error: 'Service is busy, please retry shortly' };
  }

  try {
    const res = await fetch(`${EBIRD_BASE}${upstreamPath}`, {
      headers: { 'X-eBirdApiToken': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!res.ok) {
      const stale = await cacheGetStale(upstreamPath);
      if (stale !== undefined) return { ok: true, data: stale, stale: true };
      return { ok: false, status: res.status, error: `eBird API error: ${res.status}` };
    }

    const raw = await res.json();
    const data = transform ? transform(raw) : raw;
    await cacheSet(upstreamPath, data, sMaxAge * 1000);
    return { ok: true, data, stale: false };
  } catch {
    // Timeout or network failure — a day-old answer beats an error page
    const stale = await cacheGetStale(upstreamPath);
    if (stale !== undefined) return { ok: true, data: stale, stale: true };
    return { ok: false, status: 500, error: 'Failed to fetch from eBird' };
  }
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

export async function proxyEbird(request: NextRequest, opts: ProxyOptions): Promise<Response> {
  if (await rateLimit(request, 'ebird', 30, 60)) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } }
    );
  }

  const result = await fetchEbirdCached(opts.upstreamPath, opts.sMaxAge, opts.transform);

  if (!result.ok) {
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (result.status === 503) headers['Retry-After'] = '30';
    return Response.json({ error: result.error }, { status: result.status, headers });
  }

  const headers: Record<string, string> = result.stale
    ? { 'Cache-Control': 'public, s-maxage=60', 'X-BirdRadar-Stale': '1' }
    : { 'Cache-Control': `public, s-maxage=${opts.sMaxAge}, stale-while-revalidate=${opts.staleWhileRevalidate}` };

  return Response.json(result.data, { headers });
}

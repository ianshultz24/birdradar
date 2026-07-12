import { type NextRequest } from 'next/server';

/**
 * Shared eBird proxy plumbing for all /api/ebird/* routes:
 * input validation, per-IP rate limiting, in-memory response caching,
 * and CDN Cache-Control headers.
 *
 * Rate limiting and the memory cache are per-instance (best-effort on
 * serverless) — the CDN cache in front absorbs the bulk of traffic since
 * responses carry s-maxage. For hard multi-instance guarantees, swap the
 * Map-based limiter for a shared store (e.g. Upstash Redis).
 */

const EBIRD_BASE = 'https://api.ebird.org/v2';

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

// ─── Rate limiting (per-IP sliding window) ───────────────────────────────────

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;
const ipHits = new Map<string, number[]>();

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'local';
}

function isRateLimited(request: NextRequest): boolean {
  const now = Date.now();
  const ip = clientIp(request);

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

// ─── In-memory response cache ─────────────────────────────────────────────────

interface CacheEntry {
  expires: number;
  data: unknown;
}

const MEMORY_CACHE_MAX_ENTRIES = 200;
const responseCache = new Map<string, CacheEntry>();

function cacheGet(key: string): unknown | undefined {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    responseCache.delete(key);
    return undefined;
  }
  return entry.data;
}

function cacheSet(key: string, data: unknown, ttlMs: number): void {
  if (responseCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    // Evict oldest-inserted entry (Map preserves insertion order)
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, { expires: Date.now() + ttlMs, data });
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
  if (isRateLimited(request)) {
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

  const cached = cacheGet(opts.upstreamPath);
  if (cached !== undefined) {
    return Response.json(cached, { headers: cacheHeaders });
  }

  try {
    const res = await fetch(`${EBIRD_BASE}${opts.upstreamPath}`, {
      headers: { 'X-eBirdApiToken': apiKey },
      cache: 'no-store',
    });

    if (!res.ok) {
      return Response.json(
        { error: `eBird API error: ${res.status}` },
        { status: res.status, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const data = await res.json();
    cacheSet(opts.upstreamPath, data, opts.sMaxAge * 1000);
    return Response.json(data, { headers: cacheHeaders });
  } catch {
    return Response.json(
      { error: 'Failed to fetch from eBird' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

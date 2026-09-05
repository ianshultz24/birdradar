import { type NextRequest } from 'next/server';
import { rateLimit } from '@/lib/ratelimit';

/**
 * Coarse location from the requester's connection.
 *
 * Reached **only** when the user has turned "Precise location" off
 * (`AppSettings.preciseLocation`). With it on, nothing in the app may
 * IP-estimate — see lib/geolocation.ts.
 *
 * ─── Why this is a server route ──────────────────────────────────────────────
 *
 * `next.config.ts` pins `connect-src 'self'`, so a browser-side call to any
 * IP-geolocation service is blocked by CSP before it leaves the page. The proxy
 * is structural, exactly as `/api/drive-time` is — do not "simplify" it into a
 * client fetch.
 *
 * ─── The primary source costs nothing ────────────────────────────────────────
 *
 * Vercel populates `x-vercel-ip-latitude` / `-longitude` / `-city` on every
 * Function request, on all plans including Hobby. No key, no third party, no new
 * CSP entry, no extra round trip. `IP_GEO_URL` exists only so the OFF path can
 * be exercised in local dev, where those headers do not exist; it is empty by
 * default and is a development convenience, not a production dependency.
 *
 * ─── This response is per-requester and must never be cached ─────────────────
 *
 * A geo-estimate that reaches a shared cache hands one visitor's city to the
 * next. That is a privacy leak strictly worse than the wrong-location bug this
 * route exists to fix, and it is invisible in dev, where there is no CDN and no
 * second user. Hence `no-store` on every response and `dynamic = 'force-dynamic'`
 * so Next never treats the handler as statically resolvable.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The estimate is coarse by nature; a slow lookup is not worth waiting on. */
const IP_GEO_TIMEOUT_MS = 3_000;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export interface GeoEstimate {
  /** `[lat, lng]`, or `null` when no source could answer. */
  coords: [number, number] | null;
  /** Coarse label for the UI, e.g. "Austin". Never a street-level address. */
  label: string | null;
  source: 'vercel' | 'ip-geo-url' | 'none';
}

function parseCoord(raw: string | null, max: number): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

/**
 * Vercel's headers, when running on Vercel.
 *
 * `x-vercel-ip-city` is percent-encoded (a city with a space or an accent
 * arrives as `San%20Jos%C3%A9`), so it has to be decoded — and decoding can
 * throw on a malformed sequence, which must not take the route down for a
 * cosmetic label.
 */
function fromVercelHeaders(request: NextRequest): GeoEstimate | null {
  const lat = parseCoord(request.headers.get('x-vercel-ip-latitude'), 90);
  const lng = parseCoord(request.headers.get('x-vercel-ip-longitude'), 180);
  if (lat === null || lng === null) return null;

  let label: string | null = request.headers.get('x-vercel-ip-city');
  if (label) {
    try {
      label = decodeURIComponent(label);
    } catch {
      // keep the raw value rather than dropping the whole estimate
    }
  }
  return { coords: [lat, lng], label: label || null, source: 'vercel' };
}

/**
 * Development fallback. Expects a JSON body carrying latitude/longitude under
 * any of the common spellings the free services use.
 */
async function fromIpGeoUrl(url: string): Promise<GeoEstimate | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IP_GEO_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data: Record<string, unknown> = await res.json();
    const pick = (...keys: string[]): number | null => {
      for (const k of keys) {
        const v = data[k];
        const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
        if (Number.isFinite(n)) return n;
      }
      return null;
    };
    const lat = pick('latitude', 'lat');
    const lng = pick('longitude', 'lon', 'lng');
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const city = data.city;
    return {
      coords: [lat, lng],
      label: typeof city === 'string' && city ? city : null,
      source: 'ip-geo-url',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  if (await rateLimit(request, 'geo-estimate', 10, 60)) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': '60' } }
    );
  }

  const vercel = fromVercelHeaders(request);
  if (vercel) return Response.json(vercel, { headers: NO_STORE });

  const devUrl = process.env.IP_GEO_URL;
  if (devUrl) {
    const fallback = await fromIpGeoUrl(devUrl);
    if (fallback) return Response.json(fallback, { headers: NO_STORE });
  }

  // Deliberately NOT a default region. Returning a plausible-looking coordinate
  // nobody established is the bug; an honest `null` leaves the client in its
  // neutral view with the pin-drop escape hatch on screen.
  const none: GeoEstimate = { coords: null, label: null, source: 'none' };
  return Response.json(none, { headers: NO_STORE });
}

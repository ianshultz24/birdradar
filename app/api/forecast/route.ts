import { type NextRequest } from 'next/server';
import { rateLimit } from '@/lib/ratelimit';
import { markRegionActive, getOrBuildForecast } from '@/lib/forecast-build';

export const runtime = 'nodejs';
// A cold region builds by sampling historic dates in parallel (~seconds); the
// margin covers a slow upstream. Warm regions return from cache instantly.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (await rateLimit(request, 'forecast', 20, 60)) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  const regionCode = new URL(request.url).searchParams.get('regionCode');
  if (!regionCode) {
    return Response.json({ error: 'regionCode is required' }, { status: 400 });
  }
  // Same shape as the spplist route (e.g. "US-WA", "CA-BC", "MX")
  if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(regionCode)) {
    return Response.json({ error: 'Invalid regionCode format' }, { status: 400 });
  }

  // Track this region so the nightly job keeps its forecast warm
  await markRegionActive(regionCode);

  try {
    const forecast = await getOrBuildForecast(regionCode);
    return Response.json(forecast, {
      // The forward window shifts slowly — a day of CDN caching is safe
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400' },
    });
  } catch {
    return Response.json({ error: 'Could not build forecast' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

import { type NextRequest } from 'next/server';
import { parseGeoParams, isGeoError, proxyEbird } from '@/lib/ebird-proxy';

export async function GET(request: NextRequest) {
  const params = parseGeoParams(new URL(request.url).searchParams);
  if (isGeoError(params)) {
    return Response.json({ error: params.error }, { status: 400 });
  }
  const { lat, lng, dist } = params;

  return proxyEbird(request, {
    upstreamPath: `/data/obs/geo/recent/notable?lat=${lat}&lng=${lng}&dist=${dist}&back=7&maxResults=200&detail=full&fmt=json`,
    sMaxAge: 180,
    staleWhileRevalidate: 300,
  });
}

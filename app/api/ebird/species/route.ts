import { type NextRequest } from 'next/server';
import { parseGeoParams, isGeoError, proxyEbird } from '@/lib/ebird-proxy';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const speciesCode = searchParams.get('speciesCode');

  if (!speciesCode) {
    return Response.json({ error: 'speciesCode is required' }, { status: 400 });
  }

  // Validate species code (alphanumeric only)
  if (!/^[a-zA-Z0-9]+$/.test(speciesCode) || speciesCode.length > 10) {
    return Response.json({ error: 'Invalid speciesCode' }, { status: 400 });
  }

  const params = parseGeoParams(searchParams);
  if (isGeoError(params)) {
    return Response.json({ error: params.error }, { status: 400 });
  }
  const { lat, lng, dist } = params;

  // includeProvisional: rare-bird reports sit unreviewed for days or weeks, and
  // those are exactly the species this history is consulted for. Without it the
  // sighting-odds graph goes blank for the birds that most need chasing.
  return proxyEbird(request, {
    upstreamPath: `/data/obs/geo/recent/${encodeURIComponent(speciesCode)}?lat=${lat}&lng=${lng}&dist=${dist}&back=30&maxResults=50&includeProvisional=true&fmt=json`,
    sMaxAge: 180,
    staleWhileRevalidate: 300,
  });
}

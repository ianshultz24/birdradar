import { type NextRequest } from 'next/server';
import { proxyEbird } from '@/lib/ebird-proxy';

export async function GET(request: NextRequest) {
  const regionCode = new URL(request.url).searchParams.get('regionCode');

  if (!regionCode) {
    return Response.json({ error: 'regionCode is required' }, { status: 400 });
  }

  // Validate region code format (e.g. "US-WA", "CA-BC", "MX")
  if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(regionCode)) {
    return Response.json({ error: 'Invalid regionCode format' }, { status: 400 });
  }

  // Regional species lists change ~never — cache a full day
  return proxyEbird(request, {
    upstreamPath: `/product/spplist/${encodeURIComponent(regionCode)}`,
    sMaxAge: 86400,
    staleWhileRevalidate: 86400,
  });
}

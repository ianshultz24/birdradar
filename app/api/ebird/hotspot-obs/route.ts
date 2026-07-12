import { type NextRequest } from 'next/server';
import { proxyEbird } from '@/lib/ebird-proxy';

export async function GET(request: NextRequest) {
  const locId = new URL(request.url).searchParams.get('locId');

  if (!locId) {
    return Response.json({ error: 'locId is required' }, { status: 400 });
  }

  // Validate eBird location ID format (e.g. "L123456")
  if (!/^L\d{1,10}$/.test(locId)) {
    return Response.json({ error: 'Invalid locId format' }, { status: 400 });
  }

  return proxyEbird(request, {
    upstreamPath: `/data/obs/${encodeURIComponent(locId)}/recent?back=14&detail=full&fmt=json`,
    sMaxAge: 300,
    staleWhileRevalidate: 600,
  });
}

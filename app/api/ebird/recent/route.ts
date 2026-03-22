import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const dist = searchParams.get('dist') ?? '25';

  if (!lat || !lng) {
    return Response.json({ error: 'lat and lng are required' }, { status: 400 });
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return Response.json({ error: 'Invalid coordinates' }, { status: 400 });
  }
  const distNum = Math.min(Math.max(parseInt(dist, 10) || 25, 1), 50);

  const apiKey = process.env.EBIRD_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'EBIRD_API_KEY not configured' }, { status: 500 });
  }

  const url = `https://api.ebird.org/v2/data/obs/geo/recent?lat=${latNum}&lng=${lngNum}&dist=${distNum}&back=7&maxResults=200&fmt=json`;

  try {
    const res = await fetch(url, {
      headers: { 'X-eBirdApiToken': apiKey },
      cache: 'no-store',
    });

    if (!res.ok) {
      return Response.json({ error: `eBird API error: ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return Response.json(data);
  } catch {
    return Response.json({ error: 'Failed to fetch from eBird' }, { status: 500 });
  }
}

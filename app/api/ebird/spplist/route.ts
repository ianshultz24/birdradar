import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const regionCode = searchParams.get('regionCode');

  if (!regionCode) {
    return Response.json({ error: 'regionCode is required' }, { status: 400 });
  }

  // Validate region code format (e.g. "US-WA", "CA-BC", "MX")
  if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(regionCode)) {
    return Response.json({ error: 'Invalid regionCode format' }, { status: 400 });
  }

  const apiKey = process.env.EBIRD_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'EBIRD_API_KEY not configured' }, { status: 500 });
  }

  const url = `https://api.ebird.org/v2/product/spplist/${encodeURIComponent(regionCode)}`;

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

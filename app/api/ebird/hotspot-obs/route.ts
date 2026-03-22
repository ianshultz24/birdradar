import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const locId = searchParams.get('locId');

  if (!locId) {
    return Response.json({ error: 'locId is required' }, { status: 400 });
  }

  // Validate eBird location ID format (e.g. "L123456")
  if (!/^L\d{1,10}$/.test(locId)) {
    return Response.json({ error: 'Invalid locId format' }, { status: 400 });
  }

  const apiKey = process.env.EBIRD_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'EBIRD_API_KEY not configured' }, { status: 500 });
  }

  const url = `https://api.ebird.org/v2/data/obs/${encodeURIComponent(locId)}/recent?back=14&detail=full&fmt=json`;

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

import { type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/ratelimit';
import { generateCode, codeHash, sanitizePayload } from '@/lib/sync';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (await rateLimit(request, 'sync-create', 10, 60)) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const db = await getDb();
  if (!db) return Response.json({ error: 'Sync is not configured' }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const payload = sanitizePayload(body);
  const code = generateCode();

  await db`
    INSERT INTO sync_data (id, data) VALUES (${codeHash(code)}, ${JSON.stringify(payload)})
  `;

  // Returned once; the DB only ever holds the hash
  return Response.json({ code }, { headers: { 'Cache-Control': 'no-store' } });
}

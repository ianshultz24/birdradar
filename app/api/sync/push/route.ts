import { type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/ratelimit';
import { normalizeCode, isValidCode, codeHash, sanitizePayload } from '@/lib/sync';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (await rateLimit(request, 'sync-push', 30, 60)) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const db = await getDb();
  if (!db) return Response.json({ error: 'Sync is not configured' }, { status: 503 });

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? normalizeCode(body.code) : '';
  if (!isValidCode(code)) return Response.json({ error: 'Invalid sync code' }, { status: 400 });

  const payload = sanitizePayload(body);

  // Only updates an existing code — you can't push to a code that was never created
  const rows = (await db`
    UPDATE sync_data SET data = ${JSON.stringify(payload)}, updated_at = now()
    WHERE id = ${codeHash(code)}
    RETURNING id
  `) as { id: string }[];

  if (!rows.length) return Response.json({ error: 'Sync code not found' }, { status: 404 });

  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

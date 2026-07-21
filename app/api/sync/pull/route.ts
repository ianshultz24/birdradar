import { type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/ratelimit';
import { normalizeCode, isValidCode, codeHash, type SyncPayload } from '@/lib/sync';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (await rateLimit(request, 'sync-pull', 20, 60)) {
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

  const rows = (await db`SELECT data FROM sync_data WHERE id = ${codeHash(code)}`) as { data: SyncPayload }[];
  if (!rows.length) return Response.json({ error: 'Sync code not found' }, { status: 404 });

  return Response.json({ data: rows[0].data }, { headers: { 'Cache-Control': 'no-store' } });
}

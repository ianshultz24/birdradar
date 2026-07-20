import { type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db';
import { getPublicKey, isPushConfigured } from '@/lib/push';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const MAX_LIFE_CODES = 12_000; // full world life list fits comfortably

function subId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

interface IncomingSub {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

function validSubscription(s: unknown): s is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!s || typeof s !== 'object') return false;
  const sub = s as IncomingSub;
  return (
    typeof sub.endpoint === 'string' &&
    sub.endpoint.startsWith('https://') &&
    sub.endpoint.length < 1000 &&
    !!sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    typeof sub.keys.auth === 'string'
  );
}

// ─── Bootstrap: client fetches the VAPID public key + availability ───────────
export async function GET() {
  return Response.json(
    { configured: isPushConfigured(), publicKey: getPublicKey() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

// ─── Subscribe / update a location alert ─────────────────────────────────────
export async function POST(request: NextRequest) {
  if (await rateLimit(request, 'alerts-sub', 20, 60)) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  if (!isPushConfigured()) {
    return Response.json({ error: 'Push alerts are not configured' }, { status: 503 });
  }
  const db = await getDb();
  if (!db) {
    return Response.json({ error: 'Alert storage is not configured' }, { status: 503 });
  }

  let body: {
    subscription?: unknown;
    lat?: unknown;
    lng?: unknown;
    radiusKm?: unknown;
    lifeCodes?: unknown;
    useMetric?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!validSubscription(body.subscription)) {
    return Response.json({ error: 'Invalid push subscription' }, { status: 400 });
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return Response.json({ error: 'Invalid coordinates' }, { status: 400 });
  }
  const radiusKm = Math.min(Math.max(Math.round(Number(body.radiusKm) || 25), 1), 50);
  const lifeCodes = Array.isArray(body.lifeCodes)
    ? body.lifeCodes.filter((c): c is string => typeof c === 'string' && c.length <= 20).slice(0, MAX_LIFE_CODES)
    : [];
  const useMetric = body.useMetric === true;

  const id = subId(body.subscription.endpoint);

  await db`
    INSERT INTO alert_subscriptions (id, subscription, lat, lng, radius_km, life_codes, use_metric, updated_at)
    VALUES (${id}, ${JSON.stringify(body.subscription)}, ${lat}, ${lng}, ${radiusKm}, ${lifeCodes}, ${useMetric}, now())
    ON CONFLICT (id) DO UPDATE SET
      subscription = EXCLUDED.subscription,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      radius_km = EXCLUDED.radius_km,
      life_codes = EXCLUDED.life_codes,
      use_metric = EXCLUDED.use_metric,
      updated_at = now()
  `;

  return Response.json({ ok: true, id }, { headers: { 'Cache-Control': 'no-store' } });
}

// ─── Unsubscribe ─────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  if (await rateLimit(request, 'alerts-sub', 20, 60)) {
    return Response.json({ error: 'Too many requests' }, { status: 429 });
  }
  const db = await getDb();
  if (!db) return Response.json({ error: 'Alert storage is not configured' }, { status: 503 });

  let body: { endpoint?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.endpoint !== 'string') {
    return Response.json({ error: 'endpoint is required' }, { status: 400 });
  }

  await db`DELETE FROM alert_subscriptions WHERE id = ${subId(body.endpoint)}`;
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

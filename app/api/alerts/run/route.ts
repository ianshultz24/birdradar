import { type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { redis } from '@/lib/redis';
import { fetchEbirdCached } from '@/lib/ebird-proxy';
import { sendPush, isPushConfigured } from '@/lib/push';
import { findNewLifers, groupKey, MAX_ALERTS_PER_RUN, type AlertSubscription } from '@/lib/alerts';
import { mergeObservations, fmtDist, type Observation } from '@/lib/ebird';
import { isPrivateLocation, PRIVATE_LOCATION_LABEL } from '@/lib/location-privacy';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALERTED_TTL_SEC = 7 * 24 * 60 * 60;

/**
 * Where a push alert says the bird is.
 *
 * A personal location is never named — but "Lifer nearby: Anna's Hummingbird ·
 * Personal location (approximate)" is also useless, and private is the *common*
 * case (measured: 3 of 3 recent observations in the default search area). An
 * alert nobody can act on quietly guts the alerts feature, so substitute a coarse
 * but real locator instead of just withholding.
 *
 * County (`subnational2Name`) is only returned under `detail=full`, i.e. by the
 * notable feed — hence the optional chain rather than an assumption. The caller
 * always appends the distance from the subscriber, which carries the alert on its
 * own when no county is available.
 */
function alertPlace(obs: Observation): string {
  if (!isPrivateLocation(obs)) return obs.locName;
  const region = obs.subnational2Name ?? obs.subnational1Name;
  return region ? `${PRIVATE_LOCATION_LABEL} in ${region}` : PRIVATE_LOCATION_LABEL;
}

interface SubRow {
  id: string;
  subscription: unknown;
  lat: number;
  lng: number;
  radius_km: number;
  life_codes: string[];
  use_metric: boolean;
}

/**
 * Server-side push watcher. Invoked every ~5 min by an external scheduler
 * (Upstash QStash schedule or a GitHub Actions cron) with a bearer secret —
 * Vercel Hobby cron only fires daily, so we don't depend on it.
 *
 * Groups subscriptions onto the shared eBird cache grid, fetches each group
 * once through the Phase-0 budget/cache layer, and pushes new lifers within
 * each subscriber's radius, deduped against a 7-day Redis marker set.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: 'Watcher not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPushConfigured()) {
    return Response.json({ error: 'Push not configured' }, { status: 503 });
  }
  if (!redis) {
    // Without durable dedup the watcher would re-notify every run — refuse
    // rather than spam devices.
    return Response.json({ error: 'Dedup store (Redis) not configured' }, { status: 503 });
  }
  const db = await getDb();
  if (!db) {
    return Response.json({ error: 'Alert storage not configured' }, { status: 503 });
  }

  const rows = (await db`
    SELECT id, subscription, lat, lng, radius_km, life_codes, use_metric
    FROM alert_subscriptions
  `) as SubRow[];

  const subs: AlertSubscription[] = rows.map((r) => ({
    id: r.id,
    subscription: r.subscription,
    lat: r.lat,
    lng: r.lng,
    radiusKm: r.radius_km,
    lifeCodes: r.life_codes ?? [],
    useMetric: r.use_metric,
  }));

  // Group so nearby subscribers share one eBird fetch (and its cache entry)
  const groups = new Map<string, { lat: number; lng: number; radiusKm: number; members: AlertSubscription[] }>();
  for (const s of subs) {
    const key = groupKey(s.lat, s.lng, s.radiusKm);
    const g = groups.get(key);
    if (g) g.members.push(s);
    else groups.set(key, { lat: Number(s.lat.toFixed(2)), lng: Number(s.lng.toFixed(2)), radiusKm: s.radiusKm, members: [s] });
  }

  let pushed = 0;
  let expired = 0;
  const expiredEndpoints: string[] = [];

  for (const g of groups.values()) {
    const recentRes = await fetchEbirdCached(
      `/data/obs/geo/recent?lat=${g.lat}&lng=${g.lng}&dist=${g.radiusKm}&back=7&maxResults=200&fmt=json`,
      180
    );
    const notableRes = await fetchEbirdCached(
      `/data/obs/geo/recent/notable?lat=${g.lat}&lng=${g.lng}&dist=${g.radiusKm}&back=7&maxResults=200&detail=full&fmt=json`,
      180
    );

    const recent = recentRes.ok && Array.isArray(recentRes.data) ? (recentRes.data as Observation[]) : [];
    const notable = notableRes.ok && Array.isArray(notableRes.data) ? (notableRes.data as Observation[]) : [];
    if (recent.length === 0 && notable.length === 0) continue;

    const observations = mergeObservations(recent, notable);

    for (const sub of g.members) {
      const candidates = findNewLifers(sub, observations, new Set());
      if (candidates.length === 0) continue;

      // Durable dedup: skip anything already pushed in the last 7 days
      const keys = candidates.map((c) => `br:alerted:${c.dedupeKey}`);
      let existing: (unknown | null)[] = [];
      try {
        existing = keys.length ? await redis.mget<unknown[]>(...keys) : [];
      } catch {
        existing = keys.map(() => null); // Redis blip — better a rare dupe than silence
      }
      const fresh = candidates.filter((_, i) => existing[i] == null).slice(0, MAX_ALERTS_PER_RUN);
      if (fresh.length === 0) continue;

      for (const match of fresh) {
        const result = await sendPush(sub.subscription as Parameters<typeof sendPush>[0], {
          title: `🐦 Lifer nearby: ${match.obs.comName}`,
          body: `${alertPlace(match.obs)} · ${fmtDist(match.distKm, sub.useMetric)} away`,
          url: `/?lat=${match.obs.lat}&lng=${match.obs.lng}&sp=${encodeURIComponent(match.obs.speciesCode)}`,
          tag: match.obs.speciesCode,
        });

        if (result === 'sent') {
          pushed++;
          try {
            await redis.set(`br:alerted:${match.dedupeKey}`, 1, { ex: ALERTED_TTL_SEC });
          } catch {
            // marker write failed — a possible dupe next run, not fatal
          }
        } else if (result === 'expired') {
          expired++;
          const endpoint = (sub.subscription as { endpoint?: string }).endpoint;
          if (endpoint) expiredEndpoints.push(sub.id);
          break; // dead endpoint — stop sending to it this run
        }
      }
    }
  }

  // Reap dead push endpoints
  if (expiredEndpoints.length) {
    try {
      await db`DELETE FROM alert_subscriptions WHERE id = ANY(${expiredEndpoints})`;
    } catch {
      // non-fatal; they'll be retried next run
    }
  }

  return Response.json(
    { ok: true, subscriptions: subs.length, groups: groups.size, pushed, expired },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

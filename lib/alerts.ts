import type { Observation } from './ebird';
import { haversineKm } from './geo';

/**
 * Shared alert types and the pure new-lifer matching used by the watcher.
 * Keeping the match logic pure makes the "who gets notified" decision testable
 * without a database or push service.
 */

export interface AlertSubscription {
  /** SHA-256 of the push endpoint — stable per browser/device, no account needed */
  id: string;
  subscription: unknown; // full PushSubscription JSON
  lat: number;
  lng: number;
  radiusKm: number;
  lifeCodes: string[];
  useMetric: boolean;
}

export interface AlertMatch {
  obs: Observation;
  distKm: number;
  dedupeKey: string;
}

/** Max pushes emitted for one subscription in a single watcher run — a burst of
 *  rarities shouldn't turn into a notification storm. */
export const MAX_ALERTS_PER_RUN = 5;

/**
 * Pure: given a subscription, the observations near it, and the set of
 * already-alerted dedupe keys, return the new lifers within radius to notify,
 * closest first. A "lifer" here is any species not in the subscriber's
 * life-list snapshot. The per-run cap is applied by the caller after the
 * durable dedup check, so an already-alerted close bird can't hide a genuinely
 * new farther one.
 */
export function findNewLifers(
  sub: Pick<AlertSubscription, 'id' | 'lat' | 'lng' | 'radiusKm' | 'lifeCodes'>,
  observations: Observation[],
  alreadyAlerted: Set<string>
): AlertMatch[] {
  const lifeSet = new Set(sub.lifeCodes);
  const seenThisRun = new Set<string>();
  const out: AlertMatch[] = [];

  for (const obs of observations) {
    if (!obs.speciesCode) continue;
    if (lifeSet.has(obs.speciesCode)) continue; // already on their life list
    const distKm = haversineKm(sub.lat, sub.lng, obs.lat, obs.lng);
    if (distKm > sub.radiusKm) continue;

    const dedupeKey = `${sub.id}|${obs.speciesCode}|${obs.locId || obs.locName}`;
    if (alreadyAlerted.has(dedupeKey) || seenThisRun.has(dedupeKey)) continue;
    seenThisRun.add(dedupeKey);
    out.push({ obs, distKm, dedupeKey });
  }

  return out.sort((a, b) => a.distKm - b.distKm);
}

/** Round to the shared cache grid so nearby subscriptions collapse to one eBird fetch. */
export function groupKey(lat: number, lng: number, radiusKm: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)},${radiusKm}`;
}

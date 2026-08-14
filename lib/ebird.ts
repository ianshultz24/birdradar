export interface Observation {
  speciesCode: string;
  comName: string;
  sciName: string;
  locName: string;
  locId: string;
  obsDt: string;
  howMany?: number;
  lat: number;
  lng: number;
  obsId: string;
  locationPrivate: boolean;
  subId: string;
  notable?: boolean;
  /** Number of separate checklists reporting this species at this location in the last 7 days */
  reportCount?: number;
}

export interface Hotspot {
  locId: string;
  locName: string;
  lat: number;
  lng: number;
  numSpeciesAllTime: number;
  countryCode: string;
  subnational1Code: string;
  latestObsDt?: string;
}

export type PriorityTier = 'lifer-rare' | 'lifer' | 'rare' | 'seen';

export interface ClassifiedObservation extends Observation {
  tier: PriorityTier;
}

export interface TargetSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
  nearbyCount: number;
}

export interface AppSettings {
  showHotspots: boolean;
  dimSeenSpecies: boolean;
  liferPulse: boolean;
  lightMode: boolean;
  yearListActive: boolean;
  /** stored in km; passed directly to eBird API (max 50) */
  searchRadius: number;
  /** display unit preference — does NOT affect API calls */
  useMetric: boolean;
  autoRefresh: 0 | 5 | 15 | 30;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  showRadiusCircle: boolean;
  /** @deprecated radar overlay archived — see components/archive. Kept so stored
   *  and cross-device-synced settings blobs don't churn. */
  showRadarAnimation: boolean;
  /** Disables marker pulse/glow and drop shadows. On by default; also forced on
   *  when the OS reports `prefers-reduced-motion: reduce`. */
  lowBatteryMode: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  showHotspots: true,
  dimSeenSpecies: true,
  liferPulse: true,
  lightMode: true,
  yearListActive: false,
  searchRadius: 25,
  useMetric: false,
  autoRefresh: 0,
  notificationsEnabled: false,
  soundEnabled: false,
  showRadiusCircle: false,
  showRadarAnimation: false,
  lowBatteryMode: true,
};

export function fmtDist(km: number, useMetric = true): string {
  if (useMetric) {
    if (km < 1) return `${Math.round(km * 1000)}m`;
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km)} km`;
  }
  const mi = km * 0.621371;
  if (mi < 0.1) return `${Math.round(mi * 5280)} ft`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/**
 * Parse an eBird obsDt string ("YYYY-MM-DD HH:mm", or "YYYY-MM-DD" on checklists
 * submitted without a time).
 *
 * The space-separated format is not parseable by Safari/iOS `new Date()` —
 * always go through here instead of calling `new Date(obsDt)` directly.
 *
 * The two forms are also parsed differently by the spec: a date-*time* with no
 * offset is local, but a date-*only* string is UTC midnight. Left alone, a
 * time-less observation lands on the previous calendar day everywhere west of
 * Greenwich, which is exactly where it shows up as an off-by-one bar on the
 * sightings graph. Pin those to local midnight so both forms agree.
 *
 * Returns an Invalid Date for malformed input; callers that bucket by date must
 * check `isNaN(getTime())` rather than letting NaN reach an array index.
 */
export function parseObsDt(dateStr: string): Date {
  const s = (dateStr ?? '').trim().replace(' ', 'T');
  if (!s) return new Date(NaN);
  return new Date(s.length <= 10 ? `${s}T00:00` : s);
}

export function timeAgo(dateStr: string): string {
  const date = parseObsDt(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (isNaN(diffMs)) return 'unknown';
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

export function mergeObservations(
  recent: Observation[],
  notable: Observation[]
): Observation[] {
  const notableKeys = new Set(
    notable.map((o) => `${o.speciesCode}|${o.locId || o.locName}`)
  );

  const withFlags: Observation[] = [
    ...notable.map((o) => ({ ...o, notable: true })),
    ...recent.map((o) => ({
      ...o,
      notable: notableKeys.has(`${o.speciesCode}|${o.locId || o.locName}`),
    })),
  ];

  // Deduplicate by speciesCode + location, keep most recent
  const seen = new Map<string, Observation>();
  for (const obs of withFlags) {
    const key = `${obs.speciesCode}|${obs.locId || obs.locName}`;
    const existing = seen.get(key);
    if (!existing || parseObsDt(obs.obsDt) > parseObsDt(existing.obsDt)) {
      seen.set(key, obs);
    }
  }

  return Array.from(seen.values());
}

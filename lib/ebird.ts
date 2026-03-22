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
  autoRefresh: 0 | 5 | 15 | 30;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  showRadiusCircle: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  showHotspots: true,
  dimSeenSpecies: true,
  liferPulse: true,
  lightMode: false,
  yearListActive: false,
  searchRadius: 25,
  autoRefresh: 0,
  notificationsEnabled: false,
  soundEnabled: false,
  showRadiusCircle: false,
};

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr.replace(' ', 'T'));
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
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
    if (
      !existing ||
      new Date(obs.obsDt.replace(' ', 'T')) >
        new Date(existing.obsDt.replace(' ', 'T'))
    ) {
      seen.set(key, obs);
    }
  }

  return Array.from(seen.values());
}

import type { Observation, ClassifiedObservation, PriorityTier } from './ebird';
import type { SpeciesMeta } from './lifelist';

export function classifyObservation(
  obs: Observation,
  lifeSet: Set<string>,
  /** Fallback: scientific names of life-list species (handles stale code mismatches) */
  sciNameSet?: Set<string>
): ClassifiedObservation {
  const isOnList =
    lifeSet.has(obs.speciesCode) ||
    (!!sciNameSet && !!obs.sciName && sciNameSet.has(obs.sciName.toLowerCase()));
  const isNotable = !!obs.notable;

  let tier: PriorityTier;
  if (!isOnList && isNotable) {
    tier = 'lifer-rare';
  } else if (!isOnList) {
    tier = 'lifer';
  } else if (isNotable) {
    tier = 'rare';
  } else {
    tier = 'seen';
  }

  return { ...obs, tier };
}

export function classifyAll(
  observations: Observation[],
  lifeList: string[],
  /** Optional metadata — used to build a sciName fallback set.
   *  Only sciNames of species whose code is in `lifeList` are included,
   *  so the fallback is scoped correctly for both life and year list modes. */
  lifeListMeta?: Record<string, SpeciesMeta>
): ClassifiedObservation[] {
  const lifeSet = new Set(lifeList);
  // Map each active-list code to its sciName (handles stale PNW_SPECIES code mismatches)
  const sciNameSet = lifeListMeta
    ? new Set(
        lifeList
          .map((code) => lifeListMeta[code]?.sciName?.toLowerCase())
          .filter((s): s is string => !!s)
      )
    : undefined;
  return observations.map((obs) => classifyObservation(obs, lifeSet, sciNameSet));
}

export function getTierLabel(tier: PriorityTier): string {
  switch (tier) {
    case 'lifer-rare': return 'LIFER + RARE';
    case 'lifer':      return 'LIFER';
    case 'rare':       return 'RARE SEEN';
    case 'seen':       return 'SEEN';
  }
}

/**
 * UI accent color — used in sidebar cards, badges, popups.
 * White-tier birds (seen/rare) use readable grays; lifer tiers use blue.
 */
export function getTierColor(tier: PriorityTier): string {
  switch (tier) {
    case 'lifer-rare': return '#60a5fa'; // blue — rare new lifer
    case 'lifer':      return '#60a5fa'; // blue — new lifer
    case 'rare':       return '#94a3b8'; // silver — rare but already seen
    case 'seen':       return '#6b7280'; // gray — common, already seen
  }
}

/**
 * Map dot color — used in Leaflet markers.
 * Seen tiers → white (light mode: dark gray); lifer tiers → blue.
 */
export function getTierMapColor(tier: PriorityTier, lightMode = false): string {
  const isSeenTier = tier === 'seen' || tier === 'rare';
  if (isSeenTier) return lightMode ? '#64748b' : '#e2e8f0';
  return '#60a5fa';
}

export function getTierBg(tier: PriorityTier): string {
  switch (tier) {
    case 'lifer-rare': return 'rgba(96,165,250,0.12)';
    case 'lifer':      return 'rgba(96,165,250,0.10)';
    case 'rare':       return 'rgba(148,163,184,0.10)';
    case 'seen':       return 'rgba(107,114,128,0.06)';
  }
}

import type { ClassifiedObservation } from './ebird';

/**
 * Map marker grouping — shared so the map and the species detail panel agree on
 * what a "location" is.
 *
 * This used to live inside components/Map.tsx. It moved out when clicking a pin
 * started opening a panel owned by app/page.tsx: the panel resolves its content
 * from the same array the markers are rendered from, so a marker key can never
 * point at a group the panel would build differently.
 */

/** [locKey, observations at that location] — locKey is also the React key. */
export type MarkerGroup = [locKey: string, group: ClassifiedObservation[]];

/** Draw order / stacking priority when several species share a pin. */
const TIER_ORDER: Record<string, number> = { 'lifer-rare': 0, lifer: 1, rare: 2, seen: 3 };

/**
 * Observations that should render as pins. With `dimSeenSpecies` off, already-seen
 * and merely-rare birds are hidden outright rather than dimmed.
 */
export function visibleObservations(
  observations: ClassifiedObservation[],
  dimSeenSpecies: boolean,
): ClassifiedObservation[] {
  return dimSeenSpecies
    ? observations
    : observations.filter((o) => o.tier !== 'seen' && o.tier !== 'rare');
}

/**
 * The location identity of one observation.
 *
 * Falls back to coordinates, not locName — two distinct points sharing a name
 * would otherwise collide onto one marker (and one React key).
 *
 * Exported because drive time is computed per *location*, not per observation,
 * and the sidebar list has to filter individual observations by the same key the
 * map filters groups by. Two hand-rolled copies of this expression is exactly how
 * the list and the map would come to disagree about what they are showing.
 */
export function locKeyOf(obs: Pick<ClassifiedObservation, 'locId' | 'lat' | 'lng'>): string {
  return obs.locId || `${obs.lat},${obs.lng}`;
}

export function buildMarkerGroups(
  observations: ClassifiedObservation[],
  dimSeenSpecies: boolean,
): MarkerGroup[] {
  const groups = new Map<string, ClassifiedObservation[]>();
  for (const obs of visibleObservations(observations, dimSeenSpecies)) {
    const key = locKeyOf(obs);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(obs);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  }
  return Array.from(groups.entries());
}

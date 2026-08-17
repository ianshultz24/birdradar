import type { Hotspot, Observation } from './ebird';

/**
 * Location privacy — the single chokepoint for turning an observation into
 * something a user can navigate to.
 *
 * ─── What eBird's flag actually means ────────────────────────────────────────
 *
 * `locationPrivate: true` marks a **personal location**: one the observer created
 * rather than picking an existing hotspot. Sometimes that is a home. Far more
 * often it is a roadside pullout, a trail junction, a parking lot, or a birder's
 * own name for a corner of a public park. The flag means "not a hotspot", *not*
 * "residence" — and the two are indistinguishable through the API, which is why
 * the treatment here is conservative.
 *
 * It is also the common case, not an edge case. Measured against the live API for
 * the app's default search area, 3 of 3 recent observations came back private.
 * Anything that degrades badly when this flag is set will degrade badly most of
 * the time — see the note on push-alert bodies in app/api/alerts/run/route.ts.
 *
 * Verified against the live API rather than assumed: `locationPrivate` is present
 * in **both** feeds that reach `mergeObservations` — `/data/obs/geo/recent`
 * (simple detail) and `/data/obs/geo/recent/notable` (`detail=full`) — and
 * `classifyAll` preserves it by spread. Two things that look like signals but are
 * not: private locations carry ordinary `L…` locIds, and their `locName` can be a
 * perfectly normal-looking place name ("Monohon Woods (Restricted Access)").
 * **Only the boolean is a signal.**
 *
 * ─── The rule ────────────────────────────────────────────────────────────────
 *
 * Routing to a private location must be impossible anywhere in the app. That is
 * enforced structurally, not by convention: `observationDirectionsUrl()` is the
 * only function in the codebase permitted to build a navigation URL from an
 * observation, and it returns `null` for private ones. A caller that wants to
 * route has to come through here, and a caller that comes through here cannot
 * route to a backyard. Verify with:
 *
 *     grep -rn "google.com/maps\|maps.apple\|geo:\|/dir/" app components lib
 *
 * which must only ever hit this file.
 */

export const PRIVATE_LOCATION_LABEL = 'Personal location (approximate)';

/** Shown where the absent Directions control would otherwise be. A silently
 *  missing button reads as a bug; this says it was a decision. */
export const PRIVATE_LOCATION_HINT =
  'This is a birder’s own location, not a public hotspot. Directions are unavailable.';

/** The minimum an object needs before this module will judge it. */
type PrivacyBearing = { locationPrivate?: boolean } | null | undefined;

/**
 * Fail closed: only an explicit `false` is treated as public.
 *
 * `undefined` — a truncated response, a hand-built fixture, a future feed that
 * drops the field — resolves to *private*. The cost of a false positive is a
 * missing Directions button; the cost of a false negative is routing a stranger
 * to someone's house. Those are not symmetric.
 */
export function isPrivateLocation(o: PrivacyBearing): boolean {
  return o?.locationPrivate !== false;
}

export function canRoute(o: PrivacyBearing): boolean {
  return !isPrivateLocation(o);
}

function directionsTo(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/**
 * Navigation URL for a sighting, or `null` when the location is private.
 *
 * Callers must render the action conditionally on the return value rather than
 * disabling a button that still holds a live href.
 */
export function observationDirectionsUrl(o: Observation): string | null {
  if (isPrivateLocation(o)) return null;
  return directionsTo(o.lat, o.lng);
}

/**
 * Hotspots are public by definition and carry no `locationPrivate` field, so they
 * must **never** be passed through `isPrivateLocation()` — fail-closed would mark
 * every one of them private. That asymmetry is why there are two functions here
 * rather than one generic.
 */
export function hotspotDirectionsUrl(hs: Hotspot): string {
  return directionsTo(hs.lat, hs.lng);
}

/** Location name for display: private locations are labelled rather than named. */
export function displayLocationName(o: Observation): string {
  return isPrivateLocation(o) ? PRIVATE_LOCATION_LABEL : o.locName;
}

/**
 * Coordinates for display. Private locations round to 2 decimals (~1.1 km).
 *
 * This is a **display** treatment and nothing more. The marker is still plotted
 * at the true coordinate, because rounding the plotted position would change the
 * `locKey` in lib/markers.ts and could merge genuinely distinct locations onto
 * one pin. Do not describe this as coordinate obfuscation.
 */
export function formatCoords(o: Observation): string {
  const dp = isPrivateLocation(o) ? 2 : 4;
  return `${o.lat.toFixed(dp)}, ${o.lng.toFixed(dp)}`;
}

/**
 * Filter a list down to what may be **navigated** to.
 *
 * Scoped to navigation on purpose, and named for it. It is *not* a drive-time
 * filter: a drive-time duration is a number computed server-side, with no address
 * and no route, so it leaks strictly less than the pin the user is already looking
 * at — and excluding private locations would strip the badge from the majority of
 * sightings while protecting nothing. Drive-time keeps private locations; only
 * navigation drops them. If a future phase adds turn-by-turn directions or a route
 * polyline, that is navigation and belongs behind this filter.
 */
export function navigableTargets<T extends { locationPrivate?: boolean }>(xs: T[]): T[] {
  return xs.filter((x) => canRoute(x));
}

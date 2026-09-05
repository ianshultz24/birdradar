import type { ClassifiedObservation, PriorityTier } from './ebird';
import { parseObsDt } from './ebird';
import { haversineKm } from './geo';

/**
 * Ordering for the Alerts list — extracted from components/AlertsPanel.tsx.
 *
 * It lives here for the same reason `locKeyOf` moved into lib/markers.ts in
 * Phase D: a comparator buried in a component body cannot be reasoned about,
 * asserted on, or driven from a console. The reported Phase E1 bug ("the Alerts
 * tab sorts identically regardless of the selected category") was two defects in
 * that buried code, and the second one was invisible precisely because the
 * ordering rule and the thing that displayed it were the same 900-line file.
 *
 * ─── Every comparator here is total ──────────────────────────────────────────
 *
 * `Array.prototype.sort` treats a comparator that returns `NaN` as if it had
 * returned `+0` (ECMA-262 SortCompare) — so the sort silently becomes a no-op
 * and the input order survives, looking exactly like "the sort button does
 * nothing". Two live inputs can produce a `NaN`:
 *
 *   - `parseObsDt()` returns an Invalid Date for a malformed `obsDt`, and
 *     `NaN - NaN` is `NaN`.
 *   - `haversineKm()` returns `NaN` if any coordinate is not a number, which is
 *     reachable whenever a caller hands over a centre it has not established.
 *
 * Nothing below ever subtracts two possibly-`NaN` numbers. Bad rows sort last
 * with a defined tie-break instead of poisoning the whole array.
 */

export type SortMode = 'recent' | 'closest' | 'chase';

export const SORT_MODES = ['recent', 'closest', 'chase'] as const;

export const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Recent',
  closest: 'Closest',
  chase: 'Chase Odds',
};

export interface SortContext {
  /** Where "closest" is measured from. `null` when no location is established —
   *  the mode then degrades to recency rather than to a NaN comparator. */
  center: [number, number] | null;
  /** speciesCode → 0–100 chase score, as far as scoring has got. Species absent
   *  from the map are *unscored*, not zero-scored: they sort below everything
   *  scored, and the card must say so rather than render an odds chip it does
   *  not have. */
  scores: Map<string, number>;
}

/** Milliseconds for an observation, with malformed rows pinned to the bottom. */
function obsTime(o: ClassifiedObservation): number {
  const t = parseObsDt(o.obsDt).getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

/** Newest first. Comparison, not subtraction — `-Infinity - -Infinity` is NaN. */
function byRecency(a: ClassifiedObservation, b: ClassifiedObservation): number {
  const ta = obsTime(a);
  const tb = obsTime(b);
  if (ta === tb) return 0;
  return tb > ta ? 1 : -1;
}

function isFiniteLatLng(c: [number, number] | null): c is [number, number] {
  return !!c && Number.isFinite(c[0]) && Number.isFinite(c[1]);
}

/**
 * Chase odds answer "will the bird still be there if I drive out?" — a question
 * that only has a point for a bird you would drive out for. `ObsCard` renders a
 * `ChasePanel` for every tier except `seen` for exactly that reason, so the
 * `seen` section has no score on screen to be ordered by.
 *
 * Ranking it anyway would order visible cards by an invisible number. It keeps
 * recency instead, and the section header says so. This is the *deliberate*
 * remnant of the bug being fixed here — the difference is that it is now one
 * section with a stated reason, rather than two sections silently.
 */
export function sectionSortMode(mode: SortMode, tier: PriorityTier): SortMode {
  return mode === 'chase' && tier === 'seen' ? 'recent' : mode;
}

/** Tiers that carry a chase score. Mirrors `showChase` in AlertsPanel's ObsCard. */
export function tierHasChaseOdds(tier: PriorityTier): boolean {
  return tier !== 'seen';
}

export function sortObservations(
  arr: ClassifiedObservation[],
  mode: SortMode,
  ctx: SortContext,
): ClassifiedObservation[] {
  if (mode === 'closest') {
    // No established centre means no distances. Falling back to recency is the
    // point: a "Closest" that quietly returned the input order is the bug.
    if (!isFiniteLatLng(ctx.center)) return [...arr].sort(byRecency);
    const [lat, lng] = ctx.center;
    // Distances precomputed once rather than inside the comparator — O(n)
    // haversines instead of O(n log n).
    return arr
      .map((obs) => {
        const d = haversineKm(lat, lng, obs.lat, obs.lng);
        return { obs, d: Number.isFinite(d) ? d : Infinity };
      })
      .sort((a, b) => (a.d === b.d ? byRecency(a.obs, b.obs) : a.d - b.d))
      .map(({ obs }) => obs);
  }

  if (mode === 'chase') {
    return [...arr].sort((a, b) => {
      const sa = ctx.scores.get(a.speciesCode);
      const sb = ctx.scores.get(b.speciesCode);
      if (sa !== undefined && sb !== undefined) {
        return sa === sb ? byRecency(a, b) : sb - sa;
      }
      // Unscored sorts below scored — including while scoring is still in
      // flight, which is why the card has to show a pending state.
      if (sa !== undefined) return -1;
      if (sb !== undefined) return 1;
      return byRecency(a, b);
    });
  }

  return [...arr].sort(byRecency);
}

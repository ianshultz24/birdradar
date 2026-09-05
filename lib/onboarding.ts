/**
 * First-visit flag for the intro modal.
 *
 * Same storage conventions as lib/lifelist.ts: a `birdradar_` key and a
 * setItem that swallows quota / restricted-context failures rather than letting
 * a throw escape into a React state update.
 *
 * ─── Why a version integer and not `true` ────────────────────────────────────
 *
 * A boolean can only ever be spent once. Storing the version the user was shown
 * lets a later phase re-introduce the modal — for a feature that genuinely needs
 * teaching — by bumping `ONBOARDING_VERSION`, instead of inventing a second key
 * and leaving two flags that can disagree.
 *
 * Anything unparseable (an old `"true"`, a hand-edited value, a half-written
 * entry) reads as version 0, i.e. "has seen nothing" — a spurious extra modal is
 * recoverable; suppressing onboarding for a user who never saw it is not.
 */

const ONBOARDING_KEY = 'birdradar_onboarded';

/** Bump to re-show the intro to everyone. See the note above. */
export const ONBOARDING_VERSION = 1;

export function seenOnboardingVersion(): number {
  if (typeof window === 'undefined') return ONBOARDING_VERSION;
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    const n = raw === null ? 0 : parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Returns `true` on the server.
 *
 * That guard keeps the modal out of the SSR payload, but it is **not** licence
 * to call this from a `useState` initializer: hydration re-runs the initializer
 * on the client, where `window` exists, so a first-time visitor would compute
 * `open = true` against a server payload that rendered nothing — a hydration
 * mismatch, and React discards the mismatched tree. Read it in a mount effect.
 * See the call site in app/page.tsx.
 */
export function hasSeenOnboarding(): boolean {
  return seenOnboardingVersion() >= ONBOARDING_VERSION;
}

export function markOnboardingSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ONBOARDING_KEY, String(ONBOARDING_VERSION));
  } catch {
    // Private-browsing / quota. The modal reappears next visit, which is a
    // nuisance rather than a fault; it must not take the render down.
  }
}

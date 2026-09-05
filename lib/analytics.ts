/**
 * PostHog custom events.
 *
 * app/PostHogPageView.tsx was the only `capture()` in the repo, and it can rely on
 * `usePostHog()` because it is a component. The donation prompt fires from a mount
 * effect and from two click handlers, so it wants a plain function rather than a
 * hook, and it must survive the build having no analytics key at all.
 *
 * ─── Why the key is tested rather than the client ────────────────────────────
 *
 * app/providers.tsx skips `posthog.init` entirely when NEXT_PUBLIC_POSTHOG_KEY is
 * unset — local checkouts and preview builds run with no analytics. `capture()` on
 * an uninitialised client is not a documented no-op, so the guard here is the same
 * condition the provider uses, not an inspection of the client's internals.
 *
 * The env var is written as a complete `process.env.NEXT_PUBLIC_POSTHOG_KEY`
 * member expression on purpose: Next inlines NEXT_PUBLIC_* by *textual*
 * substitution at build time, so destructuring `process.env` or computing the name
 * silently yields undefined and disables analytics in production with no error.
 * lib/tiles.ts records the same hazard for the Stadia key.
 */

import posthog from 'posthog-js';

const ANALYTICS_ENABLED = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

/**
 * Fire and forget. Never throws — an analytics failure must not take down the
 * click handler it is attached to, and every current caller is a user gesture.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  if (!ANALYTICS_ENABLED || typeof window === 'undefined') return;
  try {
    posthog.capture(event, props);
  } catch {
    // Blocked by an extension, offline, or not yet initialised. Not our problem.
  }
}

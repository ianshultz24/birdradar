'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';

import { initDevClient, getDevSnapshot, subscribeDev } from '@/lib/dev/client';

/**
 * Boots the Developer Mode client and owns the analytics opt-out.
 *
 * Renders nothing. Mounted once, in `app/layout.tsx`, above the page — it has to
 * run on every route (including `/dev` itself) and it has to run before the
 * first PostHog event, which rules out mounting it inside `app/page.tsx`.
 *
 * ─── Cost for an ordinary visitor: zero ──────────────────────────────────────
 *
 * `initDevClient()` checks synchronously for the `br_dev_flags` cookie. Without
 * it the session resolves to `'none'` immediately and no request is made. The
 * only ongoing work for anybody is the `/api/health` backstop poll, which is
 * five-minutely and suspended while the tab is hidden.
 *
 * ─── Analytics (spec §8) ─────────────────────────────────────────────────────
 *
 * A verified dev session is opted **out** of capture unless the panel's
 * `analytics` toggle is on. "My own testing must not inflate the usage numbers"
 * — and the numbers in question are the ones that decide whether the September
 * distribution push worked, so a dev session that quietly counted itself would
 * corrupt the only measurement that matters.
 *
 * The opt-out is driven by the **server-validated** session from
 * `/api/dev/session`, never by the cookie alone. Forging `br_dev_flags` cannot
 * opt you out of analytics, which is the correct direction for a flag that
 * suppresses data collection.
 *
 * The env-var guard is the same one `app/providers.tsx` uses to decide whether
 * to call `posthog.init` at all, and it is written as a complete
 * `process.env.NEXT_PUBLIC_POSTHOG_KEY` member expression on purpose: Next
 * inlines `NEXT_PUBLIC_*` by *textual* substitution at build time, so
 * destructuring `process.env` or computing the name silently yields `undefined`
 * and disables the guard in production with no error. `lib/analytics.ts` and
 * `lib/tiles.ts` both record this hazard.
 */
export default function DevClientProvider() {
  useEffect(() => {
    initDevClient();

    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;

    // `opt_out_capturing` persists to storage, so re-applying the same decision
    // on every snapshot is cheap and idempotent — and re-applying is what makes
    // the panel toggle take effect without a reload.
    const apply = () => {
      const { session, flags } = getDevSnapshot();
      if (session === 'unknown') return;

      try {
        if (session === 'active' && !flags.analytics) {
          if (!posthog.has_opted_out_capturing()) posthog.opt_out_capturing();
        } else if (posthog.has_opted_out_capturing()) {
          // Covers both the panel toggle and, importantly, `Lock`: ending a dev
          // session must not leave the browser permanently opted out.
          posthog.opt_in_capturing();
        }
      } catch {
        // Blocked by an extension, offline, or not yet initialised. An
        // analytics failure must never take down the app around it — same
        // contract as lib/analytics.ts's `track()`.
      }
    };

    apply();
    return subscribeDev(apply);
  }, []);

  return null;
}

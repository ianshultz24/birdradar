/**
 * The dev-flag shape and the two cookie names — and nothing else.
 *
 * ─── Why this is its own file ────────────────────────────────────────────────
 *
 * `lib/dev/auth.ts` imports `node:crypto`. `lib/dev/client.ts` runs in the
 * browser. Both need `DevFlags`, `DEFAULT_DEV_FLAGS` and the cookie names, and
 * if the client imported them from `auth.ts` it would pull `node:crypto` into
 * the client bundle — which either fails the build or silently ships a polyfill,
 * and neither is something you want to discover at deploy time.
 *
 * A type-only import would be erased, but `DEFAULT_DEV_FLAGS` is a *value*. So
 * the shared surface lives here, with zero imports of its own, and both sides
 * depend on this rather than on each other. `auth.ts` re-exports it so server
 * callers still have one place to import from.
 */

export const DEV_COOKIE = 'br_dev';
export const DEV_FLAGS_COOKIE = 'br_dev_flags';

/** 7 days, as specced. */
export const DEV_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface DevFlags {
  /** Sends `x-dev-nocache: 1`; the eBird cache layer skips both tiers. */
  cacheBypass: boolean;
  /** Mounts the floating debug overlay. */
  showDebugBadges: boolean;
  /**
   * PostHog capture. Defaults to **false** — spec §8: a verified dev session
   * opts out of analytics unless the operator deliberately turns it back on.
   * Testing against production must not inflate the usage numbers.
   */
  analytics: boolean;
}

export const DEFAULT_DEV_FLAGS: DevFlags = {
  cacheBypass: false,
  showDebugBadges: false,
  analytics: false,
};

/**
 * Parse a flags cookie body.
 *
 * Unknown keys are dropped and every field is coerced with `=== true`, so a
 * hand-edited cookie cannot slip a truthy string into a branch expecting a
 * boolean. This runs on both sides: the server treats the cookie as hostile
 * because it is client-writable, and the client treats it as hostile because
 * the user may simply have typed something into it.
 */
export function parseDevFlags(raw: string | undefined | null): DevFlags {
  if (!raw) return { ...DEFAULT_DEV_FLAGS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_DEV_FLAGS };
    const o = parsed as Record<string, unknown>;
    return {
      cacheBypass: o.cacheBypass === true,
      showDebugBadges: o.showDebugBadges === true,
      analytics: o.analytics === true,
    };
  } catch {
    return { ...DEFAULT_DEV_FLAGS };
  }
}

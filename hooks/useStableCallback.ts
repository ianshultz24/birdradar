'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Returns a callback whose identity never changes but which always invokes the
 * latest `fn` passed in.
 *
 * Why this exists: `app/page.tsx` re-creates its handler props on every render
 * (`onRefreshNow={() => fetchData(true)}` and friends). Passing those straight
 * into `React.memo`'d markers would defeat the memo and re-render ~400 pins on
 * every unrelated state change.
 *
 * The ref is written in a layout effect rather than during render: a render-phase
 * mutation can leave the ref holding a callback from a render that never commits,
 * whereas layout effects flush before paint, so no user event can fire against a
 * stale ref.
 */
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const ref = useRef(fn);

  useLayoutEffect(() => {
    ref.current = fn;
  }, [fn]);

  return useCallback((...args: A) => ref.current(...args), []);
}

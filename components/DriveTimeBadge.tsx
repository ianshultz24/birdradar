'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchDriveTime, formatDriveTime, type LatLng } from '@/lib/drive-time';
import { driveTimeTokens, getTheme } from '@/lib/theme';
import { CarIcon } from '@/components/Icons';

/**
 * Colour-coded drive-time chip for one sighting location.
 *
 * Self-contained on purpose: it owns its own ref, its own IntersectionObserver
 * and its own fetch, exactly like ChasePanel's `lazy` mode
 * (components/ChasePanel.tsx). That is what lets it drop into ObsCard's meta row
 * without threading observer plumbing through the card's layout.
 *
 * ─── Why it fetches rather than being handed a value ─────────────────────────
 *
 * app/page.tsx also holds a `driveTimes` map, for the "reachable only" filter.
 * These two do not need wiring together, because both go through the
 * module-level cache in lib/drive-time.ts:
 *
 *   • filter off — badges fetch lazily as cards scroll into view; the page's map
 *     stays empty and the map's marker list is passed through by identity.
 *   • filter on  — the page fetches the whole result set eagerly, and every badge
 *     below it then resolves from that same cache with no second request.
 *
 * So there is no callback to plumb and no state to keep in sync. Adding either
 * would give the same numbers a second source of truth.
 */

interface Props {
  /** Where the user is driving *from* — the GPS fix, not the search centre. */
  origin: LatLng;
  /** Location key from lib/markers.ts. Drive time is per location, not per
   *  observation, so several species at one pin share one lookup. */
  locKey: string;
  coords: LatLng;
  lightMode: boolean;
  /** Defer the fetch until scrolled into view. On for the sidebar list; off for
   *  the detail panel, which shows one location at a time. */
  lazy?: boolean;
}

export default function DriveTimeBadge({ origin, locKey, coords, lightMode, lazy = false }: Props) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [inView, setInView] = useState(() => !lazy || typeof IntersectionObserver === 'undefined');
  const rootRef = useRef<HTMLSpanElement>(null);
  const t = getTheme(lightMode);

  useEffect(() => {
    if (inView) return;
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '150px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  const [originLat, originLng] = origin;
  const [lat, lng] = coords;

  useEffect(() => {
    if (!inView) return;
    let live = true;
    // Never rejects — every failure resolves to null, which renders as no badge.
    fetchDriveTime([originLat, originLng], { locKey, coords: [lat, lng] }).then((s) => {
      if (live) setSeconds(s);
    });
    return () => {
      live = false;
    };
    // Primitives only, so a re-render with a fresh tuple can't refire the fetch.
  }, [inView, originLat, originLng, locKey, lat, lng]);

  if (seconds === null) {
    // Unknown drive time renders as nothing — the specified failure mode. While
    // still lazy there has to be *something* for the observer to watch, so an
    // empty inline sentinel stands in until the fetch is triggered.
    return inView ? null : <span ref={rootRef} aria-hidden style={{ display: 'inline-block' }} />;
  }

  const c = driveTimeTokens(seconds, lightMode);

  return (
    <span
      ref={rootRef}
      title={`About ${formatDriveTime(seconds)} by car from your location`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '1px 6px', borderRadius: 4,
        background: c.bg, border: `1px solid ${c.border}`, color: c.color,
        fontFamily: t.mono, fontSize: 10.5, fontWeight: 600,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      <CarIcon size={10} />
      {formatDriveTime(seconds)}
    </span>
  );
}

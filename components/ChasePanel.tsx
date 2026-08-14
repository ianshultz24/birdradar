'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchChaseStats, SPARK_DAYS, type ChaseStats } from '@/lib/chase';
import type { Observation } from '@/lib/ebird';
import { getTheme, oddsLabel, oddsColor } from '@/lib/theme';
import { ClockIcon } from '@/components/Icons';

interface Props {
  speciesCode: string;
  /** Center the history query on the sighting so its local reports are captured */
  lat: number;
  lng: number;
  /** eBird API max is 50; 25 km around the sighting captures its stakeout */
  distKm?: number;
  lightMode: boolean;
  /** Defer the fetch until scrolled into view — for list contexts (sidebar) where
   *  many panels mount at once and firing every fetch would trip the rate limit.
   *  The detail panel shows one card at a time and leaves this off (fetch eagerly). */
  lazy?: boolean;
  /** Observations the caller is already showing for this species. Folded into the
   *  fetched history so the graph can't contradict the last-seen text beside it.
   *  Must be a stable reference — it's an effect dependency. */
  seedObs?: Observation[];
}

/**
 * Sighting-odds readout for one species near one sighting. Fetches the species'
 * 30-day history (cached, ~1 call per interaction) and renders a prominent,
 * plain-language answer to "will it still be there?" — a likelihood, when it's
 * usually seen, and how often it's been reported lately.
 */
export default function ChasePanel({ speciesCode, lat, lng, distKm = 25, lightMode, lazy = false, seedObs }: Props) {
  const [stats, setStats] = useState<ChaseStats | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [inView, setInView] = useState(() => !lazy || typeof IntersectionObserver === 'undefined');
  const rootRef = useRef<HTMLDivElement>(null);
  const t = getTheme(lightMode);

  // Lazy panels wait until near the viewport before fetching.
  useEffect(() => {
    if (inView) return;
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); }
    }, { rootMargin: '150px' });
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView) return;
    let live = true;
    fetchChaseStats(speciesCode, lat, lng, distKm, seedObs)
      .then((s) => { if (live) { setStats(s); setState('ok'); } })
      .catch(() => { if (live) setState('error'); });
    return () => { live = false; };
  }, [inView, speciesCode, lat, lng, distKm, seedObs]);

  const shellStyle: React.CSSProperties = {
    marginTop: 8, padding: '11px 12px',
    background: t.bg1, border: `1px solid ${t.line2}`, borderRadius: 10,
  };

  if (state !== 'ok' || !stats) {
    return (
      <div ref={rootRef} style={shellStyle}>
        <span style={{ color: t.fg3, fontFamily: t.mono, fontSize: 11 }}>
          {state === 'error' ? 'Sighting odds unavailable' : 'Reading sighting odds…'}
        </span>
      </div>
    );
  }

  const label = oddsLabel(stats.score);
  const odds = oddsColor(stats.score, lightMode);
  const descriptor = stats.descriptor.charAt(0).toUpperCase() + stats.descriptor.slice(1);

  return (
    <div ref={rootRef} style={shellStyle}>
      {/* ── Odds hero ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 10,
        background: odds.bg, border: `1px solid ${odds.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, flexShrink: 0 }}>
          <span style={{ fontSize: 28, fontWeight: 700, fontFamily: t.display, color: odds.color, lineHeight: 1 }}>
            {stats.score}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: t.display, color: odds.color, lineHeight: 1 }}>
            %
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: odds.color, fontFamily: t.sans, lineHeight: 1.2 }}>
            {label}
          </div>
          <div style={{ fontSize: 11.5, color: t.fg2, fontFamily: t.sans, lineHeight: 1.3, marginTop: 1 }}>
            {descriptor}
          </div>
        </div>
      </div>

      {/* ── Best time of day (the "when to go" timing) ─────────── */}
      {stats.bestWindow && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, marginTop: 8,
          padding: '7px 10px', borderRadius: 8,
          background: t.bg2, border: `1px solid ${t.line2}`,
        }}>
          <ClockIcon size={13} color={odds.color} />
          <span style={{ fontSize: 11.5, color: t.fg2, fontFamily: t.sans }}>Usually seen</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: odds.color, fontFamily: t.mono, marginLeft: 'auto' }}>
            {stats.bestWindow}
          </span>
        </div>
      )}

      {/* ── Recent report history ─────────────────────────────── */}
      <div style={{ marginTop: 10 }}>
        <div style={{
          fontSize: 10.5, fontWeight: 600, color: t.fg2, fontFamily: t.sans,
          letterSpacing: '0.01em', marginBottom: 5,
        }}>
          {/* "at least": eBird's geo history returns only the most recent report per
              location, so quiet days here are unproven, not proven absent. */}
          {stats.daysWithReports14 === 0
            ? `No reports nearby in the last ${SPARK_DAYS} days`
            : `Reported on at least ${stats.daysWithReports14} of the last ${SPARK_DAYS} days nearby`}
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          {stats.daySpark.map((reported, i) => {
            const daysAgo = SPARK_DAYS - 1 - i;
            return (
              <div
                key={i}
                title={daysAgo === 0 ? 'today' : `${daysAgo}d ago`}
                style={{
                  flex: 1, height: 16, borderRadius: 2,
                  background: reported ? odds.color : t.bg3,
                  opacity: reported ? 0.6 + 0.4 * (i / (SPARK_DAYS - 1)) : 1,
                  // Outline "today" so the strip reads left→right as time, not time-of-day
                  outline: daysAgo === 0 ? `1.5px solid ${odds.color}` : 'none',
                  outlineOffset: -1.5,
                }}
              />
            );
          })}
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 3,
          fontSize: 8.5, fontFamily: t.mono, color: t.fg4, letterSpacing: '0.04em',
        }}>
          <span>{SPARK_DAYS} DAYS AGO</span>
          <span>TODAY</span>
        </div>
      </div>

      {/* ── De-emphasized meta ────────────────────────────────── */}
      {/* "nearby" is load-bearing: this covers the whole search radius, while the
          card's own timestamp is for one location. They can legitimately differ. */}
      {(stats.hoursSinceLast !== null || stats.checklists7 > 0) && (
        <div style={{ fontSize: 10, color: t.fg3, fontFamily: t.mono, marginTop: 8 }}>
          {stats.hoursSinceLast !== null && <span>last seen nearby {fmtAgo(stats.hoursSinceLast)}</span>}
          {stats.hoursSinceLast !== null && stats.checklists7 > 0 && <span> · </span>}
          {stats.checklists7 > 0 && (
            <span>{stats.checklists7} checklist{stats.checklists7 !== 1 ? 's' : ''}/wk</span>
          )}
        </div>
      )}
    </div>
  );
}

// Floors, exactly like timeAgo() in lib/ebird.ts. These two numbers now come from
// the same observations and sit inches apart in the detail panel — rounding one
// and flooring the other made a 17.6h-old sighting read as "17h ago" above and
// "18h ago" below.
function fmtAgo(hours: number): string {
  if (hours < 1) return '<1h ago';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

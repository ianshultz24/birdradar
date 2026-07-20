'use client';

import { useEffect, useState } from 'react';
import { fetchChaseStats, type ChaseStats } from '@/lib/chase';
import { getTheme, type Theme } from '@/lib/theme';

interface Props {
  speciesCode: string;
  /** Center the history query on the sighting so its local reports are captured */
  lat: number;
  lng: number;
  /** eBird API max is 50; 25 km around the sighting captures its stakeout */
  distKm?: number;
  lightMode: boolean;
}

/**
 * On-demand chaseability readout for one species near one sighting. Fetches the
 * species' 30-day history (cached, ~1 call per interaction) and renders a
 * compact "will it still be there?" verdict — the thing eBird never answers.
 */
export default function ChasePanel({ speciesCode, lat, lng, distKm = 25, lightMode }: Props) {
  const [stats, setStats] = useState<ChaseStats | null>(null);
  // Starts 'loading'; the panel mounts fresh each time it's expanded, so props
  // are stable for its lifetime and no in-effect reset to 'loading' is needed.
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const t = getTheme(lightMode);

  useEffect(() => {
    let live = true;
    fetchChaseStats(speciesCode, lat, lng, distKm)
      .then((s) => { if (live) { setStats(s); setState('ok'); } })
      .catch(() => { if (live) setState('error'); });
    return () => { live = false; };
  }, [speciesCode, lat, lng, distKm]);

  if (state === 'loading') {
    return <Shell t={t}><span style={{ color: t.fg3, fontFamily: t.mono, fontSize: 11 }}>Reading chase odds…</span></Shell>;
  }
  if (state === 'error' || !stats) {
    return <Shell t={t}><span style={{ color: t.fg3, fontFamily: t.mono, fontSize: 11 }}>Chase odds unavailable</span></Shell>;
  }

  const toneColor = stats.tone === 'hot' ? t.lifer : stats.tone === 'warm' ? t.target : t.fg3;
  const toneBg = stats.tone === 'hot' ? t.liferBg : stats.tone === 'warm' ? t.targetBg : t.seenBg;
  const toneBorder = stats.tone === 'hot' ? t.liferBorder : stats.tone === 'warm' ? t.targetBorder : t.seenBorder;

  return (
    <Shell t={t}>
      {/* Score + verdict row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minWidth: 46, padding: '4px 0',
          background: toneBg, border: `1px solid ${toneBorder}`, borderRadius: 8,
        }}>
          <span style={{ fontSize: 19, fontWeight: 700, fontFamily: t.display, color: toneColor, lineHeight: 1 }}>
            {stats.score}
          </span>
          <span style={{ fontSize: 8, fontFamily: t.mono, color: t.fg3, letterSpacing: '0.06em', marginTop: 2 }}>
            ODDS
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: toneColor, fontFamily: t.sans, lineHeight: 1.3 }}>
            {stats.verdict}
          </div>
          <div style={{ fontSize: 10.5, color: t.fg3, fontFamily: t.mono, marginTop: 2 }}>
            {stats.hoursSinceLast !== null && (
              <span>{fmtAgo(stats.hoursSinceLast)}</span>
            )}
            {stats.checklists7 > 0 && (
              <span> · {stats.checklists7} checklist{stats.checklists7 !== 1 ? 's' : ''}/wk</span>
            )}
          </div>
        </div>
      </div>

      {/* 14-day report sparkline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: stats.bestWindow ? 6 : 0 }}>
        <div style={{ display: 'flex', gap: 2, flex: 1 }}>
          {stats.daySpark.map((reported, i) => (
            <div
              key={i}
              title={`${13 - i}d ago`}
              style={{
                flex: 1, height: 14, borderRadius: 2,
                background: reported ? toneColor : t.bg3,
                opacity: reported ? 0.55 + 0.45 * (i / 13) : 1,
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: 9, fontFamily: t.mono, color: t.fg4, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
          14d
        </span>
      </div>

      {stats.bestWindow && (
        <div style={{ fontSize: 10.5, color: t.fg2, fontFamily: t.mono }}>
          Best window: <span style={{ color: toneColor, fontWeight: 600 }}>{stats.bestWindow}</span>
        </div>
      )}
    </Shell>
  );
}

function Shell({ t, children }: { t: Theme; children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 8, padding: '10px 11px',
      background: t.bg2, border: `1px solid ${t.line2}`, borderRadius: 8,
    }}>
      {children}
    </div>
  );
}

function fmtAgo(hours: number): string {
  if (hours < 1) return 'seen <1h ago';
  if (hours < 24) return `seen ${Math.round(hours)}h ago`;
  return `seen ${Math.round(hours / 24)}d ago`;
}

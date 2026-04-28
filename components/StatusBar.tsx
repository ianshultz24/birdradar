'use client';

import type { ClassifiedObservation } from '@/lib/ebird';
import { getTheme } from '@/lib/theme';

interface Props {
  observations: ClassifiedObservation[];
  loading: boolean;
  apiStatus: 'ok' | 'error' | 'loading';
  lastFetch: number;
  lightMode: boolean;
  yearListActive: boolean;
  isMobile?: boolean;
}

export default function StatusBar({ observations, loading, apiStatus, lastFetch, lightMode, yearListActive, isMobile }: Props) {
  const t = getTheme(lightMode);

  const total = observations.length;
  const uniqueSpecies = new Set(observations.map(o => o.speciesCode)).size;
  const liferOps = observations.filter(o => o.tier === 'lifer' || o.tier === 'lifer-rare').length;

  const lastFetchStr = lastFetch > 0
    ? new Date(lastFetch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

  const statusColor = loading
    ? t.accent
    : apiStatus === 'ok' ? t.accent
    : apiStatus === 'error' ? '#EF4444'
    : t.fg4;

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    top: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    background: t.cardBg,
    border: `1px solid ${t.line2}`,
    borderRadius: 8,
    backdropFilter: 'blur(8px)',
    boxShadow: t.shadowLg,
    fontFamily: t.mono,
    whiteSpace: 'nowrap',
  };

  if (isMobile) {
    return (
      <div style={{ ...containerStyle, padding: '5px 10px', fontSize: 11, gap: 6 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: statusColor,
          display: 'inline-block', flexShrink: 0,
        }}/>
        <span style={{ color: t.fg2 }}>
          <span style={{ color: t.accent, fontWeight: 700 }}>{liferOps}</span>
          {' '}new · {uniqueSpecies} spp · {total} obs
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...containerStyle, padding: '5px 14px', fontSize: 12 }}>
      <StatPill label="Sightings" value={total} t={t}/>
      <Divider t={t}/>
      <StatPill label="Species" value={uniqueSpecies} t={t}/>
      <Divider t={t}/>
      <StatPill
        label={yearListActive ? 'Year New' : 'Lifers'}
        value={liferOps}
        t={t}
        accent
      />
      <Divider t={t}/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: statusColor,
          display: 'inline-block', flexShrink: 0,
        }}/>
        <span style={{ color: t.fg3, fontSize: 11 }}>
          {loading ? 'Fetching…' : lastFetch > 0 ? lastFetchStr : 'Ready'}
        </span>
      </div>
    </div>
  );
}

function StatPill({ label, value, t, accent }: {
  label: string;
  value: number;
  t: ReturnType<typeof getTheme>;
  accent?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, padding: '0 8px' }}>
      <span style={{ color: t.fg3, fontSize: 10, letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ color: accent ? t.accent : t.fg0, fontWeight: 700, fontSize: 14 }}>{value}</span>
    </div>
  );
}

function Divider({ t }: { t: ReturnType<typeof getTheme> }) {
  return (
    <div style={{ width: 1, height: 14, background: t.line3, flexShrink: 0 }}/>
  );
}

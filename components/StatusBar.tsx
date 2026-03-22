'use client';

import type { ClassifiedObservation } from '@/lib/ebird';

interface Props {
  observations: ClassifiedObservation[];
  loading: boolean;
  apiStatus: 'ok' | 'error' | 'loading';
  lastFetch: number;
  lightMode: boolean;
  yearListActive: boolean;
}

export default function StatusBar({ observations, loading, apiStatus, lastFetch, lightMode, yearListActive }: Props) {
  const total = observations.length;
  const uniqueSpecies = new Set(observations.map((o) => o.speciesCode)).size;
  const liferOps = observations.filter(
    (o) => o.tier === 'lifer' || o.tier === 'lifer-rare'
  ).length;

  const lastFetchStr =
    lastFetch > 0
      ? new Date(lastFetch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '—';

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: lightMode ? 'rgba(240,244,248,0.92)' : 'rgba(10,14,20,0.88)',
        border: lightMode ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        backdropFilter: 'blur(8px)',
        padding: '5px 14px',
        fontFamily: 'var(--font-jb-mono, monospace)',
        fontSize: 12,
        whiteSpace: 'nowrap',
        boxShadow: '0 2px 16px rgba(0,0,0,0.5)',
      }}
    >
      <Stat label="SIGHTINGS" value={total} color="#aabbcc" />
      <Divider />
      <Stat label="SPECIES" value={uniqueSpecies} color="#aabbcc" />
      <Divider />
      <Stat label={yearListActive ? 'YEAR NEW' : 'LIFERS'} value={liferOps} color="#f5a623" />
      <Divider />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background:
              loading
                ? '#f5a623'
                : apiStatus === 'ok'
                ? '#3ecfb4'
                : apiStatus === 'error'
                ? '#ef4444'
                : '#4b5563',
            display: 'inline-block',
            boxShadow:
              apiStatus === 'ok' && !loading
                ? '0 0 4px #3ecfb4'
                : undefined,
          }}
        />
        <span style={{ color: '#556677', fontSize: 11 }}>
          {loading ? 'FETCHING…' : lastFetch > 0 ? lastFetchStr : 'READY'}
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, padding: '0 8px' }}>
      <span style={{ color: '#445566', fontSize: 10, letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ color, fontWeight: 700, fontSize: 14 }}>{value}</span>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        height: 16,
        background: 'rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}
    />
  );
}

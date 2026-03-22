'use client';

import { useEffect, useState } from 'react';
import type { Hotspot, Observation } from '@/lib/ebird';
import { timeAgo } from '@/lib/ebird';

interface Props {
  hotspot: Hotspot;
  lifeList: string[];
  onClose: () => void;
  onAddToLifeList: (code: string, name: string) => void;
  lightMode: boolean;
}

export default function HotspotPanel({
  hotspot,
  lifeList,
  onClose,
  onAddToLifeList,
  lightMode,
}: Props) {
  const [obs, setObs] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const lifeSet = new Set(lifeList);

  // Style tokens
  const bg = lightMode ? '#f4f6f8' : '#0d1520';
  const cardBg = lightMode ? '#ffffff' : '#111820';
  const border = lightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
  const textPrimary = lightMode ? '#1a2332' : '#ddeeff';
  const textSecondary = lightMode ? '#4a5568' : '#8899aa';
  const textMuted = lightMode ? '#718096' : '#445566';
  const headerBg = lightMode ? '#edf2f7' : 'rgba(255,255,255,0.02)';

  useEffect(() => {
    setLoading(true);
    setError(false);
    setObs([]);

    fetch(`/api/ebird/hotspot-obs?locId=${encodeURIComponent(hotspot.locId)}`)
      .then((r) => {
        if (!r.ok) throw new Error('API error');
        return r.json();
      })
      .then((data: Observation[]) => {
        if (!Array.isArray(data)) throw new Error('bad data');
        // Deduplicate by speciesCode, keep most recent
        const seen = new Map<string, Observation>();
        for (const o of data) {
          const existing = seen.get(o.speciesCode);
          if (!existing || new Date(o.obsDt) > new Date(existing.obsDt)) {
            seen.set(o.speciesCode, o);
          }
        }
        setObs(Array.from(seen.values()).sort(
          (a, b) => new Date(b.obsDt).getTime() - new Date(a.obsDt).getTime()
        ));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [hotspot.locId]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: bg,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 14px 10px',
          borderBottom: `1px solid ${border}`,
          background: headerBg,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: textSecondary,
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: '0 4px',
              flexShrink: 0,
              marginTop: 1,
            }}
            title="Back"
          >
            ←
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: textPrimary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {hotspot.locName}
            </div>
            <div
              style={{
                fontSize: 11,
                color: textMuted,
                fontFamily: 'var(--font-jb-mono, monospace)',
                marginTop: 2,
              }}
            >
              {hotspot.numSpeciesAllTime > 0
                ? `${hotspot.numSpeciesAllTime} spp all time`
                : hotspot.locId}
              {hotspot.latestObsDt && (
                <span style={{ marginLeft: 8 }}>· last obs {timeAgo(hotspot.latestObsDt)}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Section label */}
      <div
        style={{
          padding: '8px 14px 6px',
          fontSize: 10,
          letterSpacing: '0.1em',
          color: textMuted,
          fontFamily: 'var(--font-jb-mono, monospace)',
          textTransform: 'uppercase',
          borderBottom: `1px solid ${border}`,
          background: headerBg,
          flexShrink: 0,
        }}
      >
        Recent Species (last 14 days)
        {!loading && !error && (
          <span style={{ float: 'right', color: '#5b9cf5' }}>{obs.length}</span>
        )}
      </div>

      {/* Species list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: textMuted,
              fontSize: 12,
              fontFamily: 'var(--font-jb-mono, monospace)',
              letterSpacing: '0.08em',
            }}
          >
            LOADING…
          </div>
        )}
        {error && (
          <div style={{ padding: 20, textAlign: 'center', color: '#ef4444', fontSize: 12 }}>
            Failed to load observations.
          </div>
        )}
        {!loading && !error && obs.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: textMuted, fontSize: 12 }}>
            No recent observations found.
          </div>
        )}
        {!loading &&
          !error &&
          obs.map((o) => {
            const onList = lifeSet.has(o.speciesCode);
            return (
              <div
                key={o.speciesCode}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderBottom: `1px solid ${border}`,
                  gap: 8,
                  background: cardBg,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: onList ? '#4b5563' : '#f5a623',
                    flexShrink: 0,
                    boxShadow: onList ? undefined : '0 0 4px #f5a62366',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: textPrimary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {o.comName}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: textSecondary,
                      fontStyle: 'italic',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {o.sciName}
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 3,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: textMuted,
                      fontFamily: 'var(--font-jb-mono, monospace)',
                    }}
                  >
                    {timeAgo(o.obsDt)}
                  </span>
                  {o.howMany && (
                    <span
                      style={{
                        fontSize: 10,
                        color: textMuted,
                        fontFamily: 'var(--font-jb-mono, monospace)',
                      }}
                    >
                      ×{o.howMany}
                    </span>
                  )}
                  {!onList ? (
                    <button
                      onClick={() => onAddToLifeList(o.speciesCode, o.comName)}
                      style={{
                        fontSize: 9,
                        padding: '2px 6px',
                        background: 'rgba(245,166,35,0.12)',
                        border: '1px solid rgba(245,166,35,0.35)',
                        borderRadius: 3,
                        color: '#f5a623',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-jb-mono, monospace)',
                        letterSpacing: '0.04em',
                        fontWeight: 700,
                      }}
                    >
                      + ADD
                    </button>
                  ) : (
                    <span
                      style={{
                        fontSize: 9,
                        color: textMuted,
                        fontFamily: 'var(--font-jb-mono, monospace)',
                      }}
                    >
                      ✓ SEEN
                    </span>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

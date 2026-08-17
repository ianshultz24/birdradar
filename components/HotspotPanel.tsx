'use client';

import { useEffect, useState } from 'react';
import type { Hotspot, Observation } from '@/lib/ebird';
import { timeAgo, parseObsDt } from '@/lib/ebird';
import { getTheme } from '@/lib/theme';
import { hotspotDirectionsUrl } from '@/lib/location-privacy';
import { CheckIcon, NavigationIcon } from '@/components/Icons';

interface Props {
  hotspot: Hotspot;
  lifeList: string[];
  onClose: () => void;
  onAddToLifeList: (code: string, name: string, sciName?: string) => void;
  lightMode: boolean;
}

export default function HotspotPanel({ hotspot, lifeList, onClose, onAddToLifeList, lightMode }: Props) {
  const [obs, setObs] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [shownLocId, setShownLocId] = useState(hotspot.locId);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [hoveredAddCode, setHoveredAddCode] = useState<string | null>(null);
  const [backHov, setBackHov] = useState(false);
  const t = getTheme(lightMode);
  const lifeSet = new Set(lifeList);

  // Reset display state synchronously during render when the hotspot changes
  // (React-blessed "adjust state on prop change" pattern — avoids set-state-in-effect).
  if (shownLocId !== hotspot.locId) {
    setShownLocId(hotspot.locId);
    setObs([]);
    setLoading(true);
    setError(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/ebird/hotspot-obs?locId=${encodeURIComponent(hotspot.locId)}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: Observation[]) => {
        if (!Array.isArray(data)) throw new Error();
        const seen = new Map<string, Observation>();
        for (const o of data) {
          const existing = seen.get(o.speciesCode);
          if (!existing || parseObsDt(o.obsDt) > parseObsDt(existing.obsDt)) seen.set(o.speciesCode, o);
        }
        setObs(Array.from(seen.values()).sort((a, b) => parseObsDt(b.obsDt).getTime() - parseObsDt(a.obsDt).getTime()));
      })
      .catch((e: unknown) => { if ((e as { name?: string }).name !== 'AbortError') setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [hotspot.locId]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: t.bg1, display: 'flex', flexDirection: 'column', zIndex: 10 }}>

      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${t.line2}`, background: t.bg2, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <button
            onClick={onClose}
            onMouseEnter={() => setBackHov(true)}
            onMouseLeave={() => setBackHov(false)}
            style={{
              background: backHov ? t.bg3 : 'transparent', border: `1px solid ${t.line2}`,
              color: t.fg2, cursor: 'pointer', fontSize: 14, lineHeight: 1,
              padding: '5px 8px', borderRadius: 6, flexShrink: 0,
              transition: 'background 0.12s',
            }}>←</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.fg0, fontFamily: t.display, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hotspot.locName}
            </div>
            <div style={{ fontSize: 11, color: t.fg3, fontFamily: t.mono, marginTop: 2 }}>
              {hotspot.numSpeciesAllTime > 0 ? `${hotspot.numSpeciesAllTime} spp all time` : hotspot.locId}
              {hotspot.latestObsDt && <span style={{ marginLeft: 8 }}>· last obs {timeAgo(hotspot.latestObsDt)}</span>}
            </div>
          </div>
          {/* Hotspots are public by definition and carry no locationPrivate
              field — hence hotspotDirectionsUrl rather than the observation
              variant, which fails closed on a missing flag. */}
          <a
            href={hotspotDirectionsUrl(hotspot)}
            target="_blank"
            rel="noopener noreferrer"
            title="Directions to this hotspot"
            style={{
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              padding: '5px 9px', borderRadius: 6,
              background: t.accentBg, border: `1px solid ${t.accentBorder}`,
              color: t.accent, fontSize: 11, fontWeight: 600,
              textDecoration: 'none', fontFamily: t.sans,
            }}
          >
            <NavigationIcon size={11} />
            Directions
          </a>
        </div>
      </div>

      {/* Section label */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px', background: t.bg2, borderBottom: `1px solid ${t.line1}`,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: t.fg1, fontFamily: t.sans, letterSpacing: '0.03em' }}>
          Recent Species (14 days)
        </span>
        {!loading && !error && (
          <span style={{ fontSize: 11, fontFamily: t.mono, color: t.accent, fontWeight: 600 }}>{obs.length}</span>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: 28, textAlign: 'center', color: t.fg3, fontSize: 12, fontFamily: t.mono }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ padding: 24, textAlign: 'center', color: '#EF4444', fontSize: 13, fontFamily: t.sans }}>
            Failed to load observations.
          </div>
        )}
        {!loading && !error && obs.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: t.fg3, fontSize: 13, fontFamily: t.sans }}>
            No recent observations found.
          </div>
        )}
        {!loading && !error && obs.map(o => {
          const onList = lifeSet.has(o.speciesCode);
          return (
            <div
              key={o.speciesCode}
              onMouseEnter={() => setHoveredCode(o.speciesCode)}
              onMouseLeave={() => setHoveredCode(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 16px', borderBottom: `1px solid ${t.line1}`,
                background: hoveredCode === o.speciesCode ? t.bg2 : t.bg1,
                transition: 'background 0.12s',
              }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: onList ? t.seen : t.accent, flexShrink: 0, opacity: 0.8 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: t.fg0, fontFamily: t.display, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.comName}
                </div>
                <div style={{ fontSize: 11, color: t.fg2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.sciName}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 10.5, color: t.fg3, fontFamily: t.mono }}>{timeAgo(o.obsDt)}</span>
                {o.howMany && <span style={{ fontSize: 10, color: t.fg3, fontFamily: t.mono }}>×{o.howMany}</span>}
                {!onList ? (
                  <button
                    onClick={() => onAddToLifeList(o.speciesCode, o.comName, o.sciName)}
                    onMouseEnter={() => setHoveredAddCode(o.speciesCode)}
                    onMouseLeave={() => setHoveredAddCode(null)}
                    style={{
                      fontSize: 10, padding: '3px 8px',
                      background: hoveredAddCode === o.speciesCode ? t.accentBorder : t.accentBg,
                      border: `1px solid ${t.accentBorder}`,
                      borderRadius: 5, color: t.accent, cursor: 'pointer',
                      fontFamily: t.mono, fontWeight: 600, transition: 'background 0.12s',
                    }}>+ Add</button>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: t.lifer, fontFamily: t.mono }}>
                    <CheckIcon size={10}/> Seen
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

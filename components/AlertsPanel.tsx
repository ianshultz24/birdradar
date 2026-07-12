'use client';

import { useState } from 'react';
import type { ClassifiedObservation, TargetSpecies } from '@/lib/ebird';
import { timeAgo, fmtDist, parseObsDt } from '@/lib/ebird';
import { getTheme, tierTokens, tierLabel, type Theme } from '@/lib/theme';
import { SearchIcon, XIcon, MapPinIcon, TargetIcon } from '@/components/Icons';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface Props {
  observations: ClassifiedObservation[];
  targetSpecies: TargetSpecies[];
  yearListActive: boolean;
  lightMode: boolean;
  useMetric?: boolean;
  userCenter: [number, number];
  focusedSpecies: { code: string; name: string } | null;
  onFlyTo: (lat: number, lng: number) => void;
  onFocusSpecies: (code: string, name: string) => void;
}

export default function AlertsPanel({
  observations, targetSpecies, yearListActive, lightMode, useMetric = true,
  userCenter, focusedSpecies, onFlyTo, onFocusSpecies,
}: Props) {
  const [sortBy, setSortBy] = useState<'recent' | 'closest'>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredSort, setHoveredSort] = useState<'recent' | 'closest' | null>(null);
  const t = getTheme(lightMode);

  function sortObs(arr: ClassifiedObservation[]): ClassifiedObservation[] {
    if (sortBy === 'closest') {
      // Precompute distances once instead of inside the comparator (O(n) vs O(n log n) haversines)
      return arr
        .map((obs) => ({ obs, d: haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng) }))
        .sort((a, b) => a.d - b.d)
        .map(({ obs }) => obs);
    }
    return [...arr].sort((a, b) => parseObsDt(b.obsDt).getTime() - parseObsDt(a.obsDt).getTime());
  }

  const liferAll = sortObs(observations.filter(o => o.tier === 'lifer-rare' || o.tier === 'lifer'));
  const rare = sortObs(observations.filter(o => o.tier === 'rare'));
  const seen = sortObs(observations.filter(o => o.tier === 'seen'));

  function flyToTarget(speciesCode: string) {
    const matches = observations.filter(o => o.speciesCode === speciesCode);
    if (!matches.length) return;
    const best = matches.reduce((a, b) =>
      parseObsDt(a.obsDt).getTime() >= parseObsDt(b.obsDt).getTime() ? a : b
    );
    onFlyTo(best.lat, best.lng);
  }

  const liferSectionTitle = yearListActive ? 'Year Opportunities' : 'Lifer Opportunities';

  const searchActive = searchQuery.trim().length > 0;
  const searchResults = searchActive
    ? [...observations]
        .filter(o => {
          const q = searchQuery.trim().toLowerCase();
          return o.comName.toLowerCase().includes(q) || o.sciName.toLowerCase().includes(q);
        })
        .sort((a, b) => parseObsDt(b.obsDt).getTime() - parseObsDt(a.obsDt).getTime())
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: t.bg1 }}>

      {/* Search + sort controls */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${t.line1}`,
        flexShrink: 0,
        position: 'sticky', top: 0, zIndex: 2,
        background: t.bg1,
      }}>
        <div style={{ position: 'relative', marginBottom: searchActive ? 0 : 10 }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: t.fg3 }}/>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search species nearby…"
            style={{
              width: '100%', padding: '9px 32px 9px 32px',
              fontSize: 13, fontFamily: t.sans,
              background: t.bg2,
              border: `1px solid ${searchActive ? t.accentBorder : t.line2}`,
              borderRadius: 8, outline: 'none', color: t.fg0,
              boxSizing: 'border-box', transition: 'border-color 0.15s',
            }}
          />
          {searchActive && (
            <button onClick={() => setSearchQuery('')} style={{
              position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: t.fg3, padding: '0 2px',
            }}>
              <XIcon size={14}/>
            </button>
          )}
        </div>

        {!searchActive && (
          <div style={{
            display: 'flex', border: `1px solid ${t.line2}`,
            borderRadius: 8, overflow: 'hidden',
          }}>
            {(['recent', 'closest'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                onMouseEnter={() => setHoveredSort(s)}
                onMouseLeave={() => setHoveredSort(null)}
                style={{
                  flex: 1, padding: '7px 0',
                  background: sortBy === s ? t.accentBg : hoveredSort === s ? t.bg2 : 'transparent',
                  border: 'none',
                  color: sortBy === s ? t.accent : t.fg2,
                  fontSize: 12, fontWeight: sortBy === s ? 600 : 400,
                  cursor: 'pointer', fontFamily: t.sans,
                  transition: 'all 0.12s',
                }}>
                {s === 'recent' ? 'Most Recent' : 'Closest'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Focus banner */}
      {focusedSpecies && !searchActive && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px',
          background: t.accentBg, borderBottom: `1px solid ${t.accentBorder}`, flexShrink: 0,
        }}>
          <TargetIcon size={13} style={{ color: t.accent, flexShrink: 0 }}/>
          <span style={{
            flex: 1, fontSize: 12, fontWeight: 600, color: t.accent,
            fontFamily: t.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{focusedSpecies.name}</span>
          <button onClick={() => onFocusSpecies(focusedSpecies.code, focusedSpecies.name)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: t.fg3, padding: '0 2px', lineHeight: 1,
          }}>
            <XIcon size={13}/>
          </button>
        </div>
      )}

      {/* Search results */}
      {searchActive ? (
        <div>
          <SectionHeader title={`${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`} count={-1} t={t}/>
          {searchResults.length === 0 ? (
            <EmptyState text={`No species matching "${searchQuery.trim()}"`} t={t}/>
          ) : (
            searchResults.map(obs => (
              <ObsCard
                key={`s-${obs.speciesCode}-${obs.locId ?? obs.locName}`}
                obs={obs} t={t} yearListActive={yearListActive}
                focusedCode={focusedSpecies?.code ?? null}
                onFlyTo={onFlyTo} onFocusSpecies={onFocusSpecies}
                distKm={haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng)}
                useMetric={useMetric}
              />
            ))
          )}
        </div>
      ) : (
        <>
          {targetSpecies.length > 0 && (
            <>
              <SectionHeader title="Target Species" count={targetSpecies.length} t={t} dotColor={t.target}/>
              {targetSpecies.slice(0, 10).map(sp => (
                <TargetCard key={sp.speciesCode} sp={sp} t={t}
                  isFocused={focusedSpecies?.code === sp.speciesCode}
                  isDimmed={!!focusedSpecies && focusedSpecies.code !== sp.speciesCode}
                  onFlyTo={() => flyToTarget(sp.speciesCode)}
                  onFocusSpecies={onFocusSpecies}
                />
              ))}
            </>
          )}

          <SectionHeader title={liferSectionTitle} count={liferAll.length} t={t} dotColor={t.lifer}/>
          {liferAll.length === 0
            ? <EmptyState text={yearListActive ? 'No new species this year nearby' : 'No lifers nearby'} t={t}/>
            : liferAll.map(obs => (
              <ObsCard key={`${obs.speciesCode}|${obs.locId ?? obs.locName}`}
                obs={obs} t={t} yearListActive={yearListActive}
                focusedCode={focusedSpecies?.code ?? null}
                onFlyTo={onFlyTo} onFocusSpecies={onFocusSpecies}
                distKm={sortBy === 'closest' ? haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng) : undefined}
                useMetric={useMetric}
              />
            ))}

          <SectionHeader title="Rare — Already Seen" count={rare.length} t={t} dotColor={t.rare}/>
          {rare.length === 0
            ? <EmptyState text="No rare species nearby" t={t}/>
            : rare.map(obs => (
              <ObsCard key={`${obs.speciesCode}|${obs.locId ?? obs.locName}`}
                obs={obs} t={t} yearListActive={yearListActive}
                focusedCode={focusedSpecies?.code ?? null}
                onFlyTo={onFlyTo} onFocusSpecies={onFocusSpecies}
                distKm={sortBy === 'closest' ? haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng) : undefined}
                useMetric={useMetric}
              />
            ))}

          <SectionHeader title="Seen Nearby" count={seen.length} t={t} dotColor={t.seen}/>
          {seen.length === 0
            ? <EmptyState text="No previously seen species nearby" t={t}/>
            : seen.map(obs => (
              <ObsCard key={`${obs.speciesCode}|${obs.locId ?? obs.locName}`}
                obs={obs} t={t} yearListActive={yearListActive}
                focusedCode={focusedSpecies?.code ?? null}
                onFlyTo={onFlyTo} onFocusSpecies={onFocusSpecies}
                distKm={sortBy === 'closest' ? haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng) : undefined}
                useMetric={useMetric}
              />
            ))}
        </>
      )}
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ title, count, t, dotColor }: { title: string; count: number; t: Theme; dotColor?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '10px 16px',
      background: t.bg2, borderBottom: `1px solid ${t.line1}`,
      borderTop: `1px solid ${t.line1}`,
    }}>
      {dotColor && (
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, marginRight: 9, flexShrink: 0, opacity: 0.85 }}/>
      )}
      <span style={{ fontSize: 11, fontWeight: 600, color: t.fg1, letterSpacing: '0.03em', flex: 1, fontFamily: t.sans }}>
        {title}
      </span>
      {count >= 0 && (
        <span style={{ fontSize: 11, fontFamily: t.mono, color: dotColor ?? t.fg3, fontWeight: 600 }}>{count}</span>
      )}
    </div>
  );
}

function EmptyState({ text, t }: { text: string; t: Theme }) {
  return (
    <div style={{ padding: '14px 16px', fontSize: 12, color: t.fg3, fontStyle: 'italic', fontFamily: t.sans }}>
      {text}
    </div>
  );
}

// ─── Observation card ────────────────────────────────────────────────────────

function ObsCard({ obs, t, yearListActive, focusedCode, onFlyTo, onFocusSpecies, distKm, useMetric }: {
  obs: ClassifiedObservation;
  t: Theme;
  yearListActive: boolean;
  focusedCode: string | null;
  onFlyTo: (lat: number, lng: number) => void;
  onFocusSpecies: (code: string, name: string) => void;
  distKm?: number;
  useMetric?: boolean;
}) {
  const [hov, setHov] = useState(false);
  const tc = tierTokens(obs.tier, t);
  const label = tierLabel(obs.tier, yearListActive);
  const focused = focusedCode === obs.speciesCode;
  const dimmed = focusedCode !== null && !focused;

  return (
    <button
      onClick={() => { onFlyTo(obs.lat, obs.lng); onFocusSpecies(obs.speciesCode, obs.comName); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: '100%', textAlign: 'left',
        background: focused ? tc.bg : hov ? t.bg2 : 'transparent',
        border: 'none', borderBottom: `1px solid ${t.line1}`,
        padding: '13px 16px', cursor: 'pointer',
        opacity: dimmed ? 0.28 : 1,
        transition: 'all 0.12s', fontFamily: t.sans, display: 'block',
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
        {/* Left indicator bar */}
        <div style={{
          width: 2, minHeight: 44, borderRadius: 1,
          background: focused ? tc.color : t.line3,
          flexShrink: 0, marginTop: 1,
        }}/>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name + badge row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
            <span style={{
              fontSize: 13, fontWeight: 600, color: t.fg0,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              fontFamily: t.display,
            }}>{obs.comName}</span>
            <span style={{
              fontSize: 9.5, fontWeight: 600, fontFamily: t.mono,
              color: tc.color, background: tc.bg,
              padding: '2px 6px', borderRadius: 4, border: `1px solid ${tc.border}`,
              letterSpacing: '0.02em', flexShrink: 0, whiteSpace: 'nowrap',
            }}>{label}</span>
          </div>

          {/* Scientific name */}
          <div style={{ fontSize: 11.5, color: t.fg2, fontStyle: 'italic', marginBottom: 7 }}>
            {obs.sciName}
          </div>

          {/* Meta row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: t.fg2, flexWrap: 'wrap' }}>
            <MapPinIcon size={11} style={{ color: t.fg4, flexShrink: 0 }}/>
            <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {obs.locName}
            </span>
            {distKm !== undefined && (
              <>
                <span style={{ color: t.fg4, margin: '0 2px' }}>·</span>
                <span style={{ fontFamily: t.mono, fontSize: 10.5, color: t.fg3 }}>{fmtDist(distKm, useMetric)}</span>
              </>
            )}
            <span style={{ color: t.fg4, margin: '0 2px' }}>·</span>
            <span style={{ fontFamily: t.mono, fontSize: 10.5, color: t.fg3 }}>{timeAgo(obs.obsDt)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Target species card ─────────────────────────────────────────────────────

function TargetCard({ sp, t, isFocused, isDimmed, onFlyTo, onFocusSpecies }: {
  sp: TargetSpecies;
  t: Theme;
  isFocused: boolean;
  isDimmed: boolean;
  onFlyTo: () => void;
  onFocusSpecies: (code: string, name: string) => void;
}) {
  const [hov, setHov] = useState(false);

  return (
    <button
      onClick={() => { onFlyTo(); onFocusSpecies(sp.speciesCode, sp.comName); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: '100%', textAlign: 'left',
        background: isFocused ? t.targetBg : hov ? t.bg2 : 'transparent',
        border: 'none', borderBottom: `1px solid ${t.line1}`,
        padding: '12px 16px', cursor: 'pointer',
        opacity: isDimmed ? 0.28 : 1, transition: 'all 0.12s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <TargetIcon size={13} style={{ color: t.target, flexShrink: 0 }}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: t.fg0, fontFamily: t.display }}>
            {sp.comName}
          </div>
          <div style={{ fontSize: 11.5, color: t.fg2, fontStyle: 'italic' }}>{sp.sciName}</div>
        </div>
        <span style={{
          fontSize: 10, fontFamily: t.mono, fontWeight: 600,
          padding: '3px 8px', borderRadius: 4,
          color: sp.nearbyCount > 0 ? t.target : t.fg3,
          background: sp.nearbyCount > 0 ? t.targetBg : 'transparent',
          border: `1px solid ${sp.nearbyCount > 0 ? t.targetBorder : t.line2}`,
          flexShrink: 0,
        }}>
          {sp.nearbyCount > 0 ? `${sp.nearbyCount} nearby` : 'Expected'}
        </span>
      </div>
    </button>
  );
}

'use client';

import { useState } from 'react';
import type { ClassifiedObservation, TargetSpecies } from '@/lib/ebird';
import { timeAgo } from '@/lib/ebird';
import { getTierColor, getTierLabel } from '@/lib/classify';

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
  userCenter: [number, number];
  focusedSpecies: { code: string; name: string } | null;
  onFlyTo: (lat: number, lng: number) => void;
  onFocusSpecies: (code: string, name: string) => void;
}

export default function AlertsPanel({
  observations,
  targetSpecies,
  yearListActive,
  lightMode,
  userCenter,
  focusedSpecies,
  onFlyTo,
  onFocusSpecies,
}: Props) {
  const [sortBy, setSortBy] = useState<'recent' | 'closest'>('recent');
  const [searchQuery, setSearchQuery] = useState('');

  function sortObs(arr: ClassifiedObservation[]): ClassifiedObservation[] {
    if (sortBy === 'closest') {
      return [...arr].sort((a, b) => {
        const da = haversineKm(userCenter[0], userCenter[1], a.lat, a.lng);
        const db = haversineKm(userCenter[0], userCenter[1], b.lat, b.lng);
        return da - db;
      });
    }
    return [...arr].sort((a, b) => new Date(b.obsDt).getTime() - new Date(a.obsDt).getTime());
  }

  // Merge lifer-rare and lifer, sorted
  const liferAll = sortObs(observations.filter((o) => o.tier === 'lifer-rare' || o.tier === 'lifer'));
  const rare = sortObs(observations.filter((o) => o.tier === 'rare'));
  const recent = sortObs(observations.filter((o) => o.tier === 'seen'));

  // Fly to the most recent observation matching a target species code
  function flyToTarget(speciesCode: string) {
    const matches = observations.filter((o) => o.speciesCode === speciesCode);
    if (matches.length === 0) return;
    const best = matches.reduce((a, b) =>
      new Date(a.obsDt).getTime() >= new Date(b.obsDt).getTime() ? a : b
    );
    onFlyTo(best.lat, best.lng);
  }

  const liferSectionTitle = yearListActive ? 'Year Opportunities' : 'Lifer Opportunities';

  const tabInactive = lightMode ? '#718096' : '#445566';
  const tabActive = '#f5a623';
  const focusBannerBg = lightMode ? 'rgba(62,207,180,0.1)' : 'rgba(62,207,180,0.08)';
  const focusBannerBorder = lightMode ? 'rgba(62,207,180,0.3)' : 'rgba(62,207,180,0.2)';
  const focusTextPrimary = lightMode ? '#1a2332' : '#ddeeff';

  // ─── Species search ─────────────────────────────────────────────────────────
  const searchActive = searchQuery.trim().length > 0;
  const searchResults = searchActive
    ? [...observations]
        .filter((o) => {
          const q = searchQuery.trim().toLowerCase();
          return o.comName.toLowerCase().includes(q) || o.sciName.toLowerCase().includes(q);
        })
        .sort((a, b) => new Date(b.obsDt).getTime() - new Date(a.obsDt).getTime())
    : [];

  const inputBg = lightMode ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
  const inputBorder = lightMode ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
  const inputText = lightMode ? '#1a2332' : '#ccddef';
  const placeholderStyle = lightMode ? '#94a3b8' : '#445566';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%', overflowY: 'auto' }}>

      {/* Species search bar */}
      <div style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${lightMode ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)'}`,
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 2,
        background: lightMode ? '#f4f6f8' : '#0a0e14',
      }}>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
            fontSize: 13, color: placeholderStyle, pointerEvents: 'none',
          }}>🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search species nearby…"
            style={{
              width: '100%',
              background: inputBg,
              border: `1px solid ${searchActive ? '#60a5fa66' : inputBorder}`,
              borderRadius: 5,
              padding: '6px 30px 6px 28px',
              color: inputText,
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'var(--font-dm-sans, sans-serif)',
              transition: 'border-color 0.15s',
            }}
          />
          {searchActive && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: placeholderStyle, fontSize: 14, lineHeight: 1, padding: '0 2px',
              }}
              aria-label="Clear search"
            >✕</button>
          )}
        </div>
      </div>

      {/* Search results view */}
      {searchActive && (
        <div>
          {searchResults.length === 0 ? (
            <div style={{
              padding: '20px 14px',
              fontSize: 12,
              color: lightMode ? '#94a3b8' : '#334455',
              fontStyle: 'italic',
              textAlign: 'center',
            }}>
              No species matching "{searchQuery.trim()}" in current radius
            </div>
          ) : (
            <>
              <div style={{
                padding: '6px 14px 4px',
                fontSize: 10,
                fontFamily: 'var(--font-jb-mono, monospace)',
                letterSpacing: '0.1em',
                color: lightMode ? '#718096' : '#445566',
                fontWeight: 700,
                textTransform: 'uppercase',
              }}>
                {searchResults.length} sighting{searchResults.length !== 1 ? 's' : ''} · most recent first
              </div>
              {searchResults.map((obs) => (
                <AlertCard
                  key={`search|${obs.speciesCode}|${obs.locId || obs.locName}`}
                  obs={obs}
                  yearListActive={yearListActive}
                  isFocused={focusedSpecies?.code === obs.speciesCode}
                  isDimmed={false}
                  onFlyTo={onFlyTo}
                  onFocusSpecies={onFocusSpecies}
                  lightMode={lightMode}
                  distKm={haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Normal content — hidden when search is active */}
      {!searchActive && <>

      {/* Species focus banner */}
      {focusedSpecies && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            background: focusBannerBg,
            borderBottom: `1px solid ${focusBannerBorder}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 14 }}>🎯</span>
          <span
            style={{
              flex: 1,
              fontSize: 12,
              fontWeight: 700,
              color: '#3ecfb4',
              fontFamily: 'var(--font-jb-mono, monospace)',
              letterSpacing: '0.04em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {focusedSpecies.name}
          </span>
          <button
            onClick={() => onFocusSpecies(focusedSpecies.code, focusedSpecies.name)}
            style={{
              background: 'transparent',
              border: 'none',
              color: focusTextPrimary,
              cursor: 'pointer',
              fontSize: 13,
              opacity: 0.6,
              padding: '0 2px',
              flexShrink: 0,
            }}
            aria-label="Clear focus"
          >
            ✕
          </button>
        </div>
      )}

      {/* Sort toggle */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${lightMode ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)'}`, flexShrink: 0 }}>
        {(['recent', 'closest'] as const).map((opt) => {
          const active = sortBy === opt;
          return (
            <button
              key={opt}
              onClick={() => setSortBy(opt)}
              style={{
                flex: 1,
                padding: '7px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? tabActive : 'transparent'}`,
                color: active ? tabActive : tabInactive,
                fontSize: 11,
                fontWeight: active ? 700 : 400,
                cursor: 'pointer',
                letterSpacing: '0.06em',
                fontFamily: 'var(--font-jb-mono, monospace)',
                transition: 'color 0.15s',
              }}
            >
              {opt === 'recent' ? '⏱ MOST RECENT' : '📍 CLOSEST'}
            </button>
          );
        })}
      </div>

      {/* Target Species */}
      {targetSpecies.length > 0 && (
        <Section
          title="Target Species"
          count={targetSpecies.length}
          accent="#3ecfb4"
          empty=""
          lightMode={lightMode}
        >
          {targetSpecies.slice(0, 10).map((sp) => (
            <TargetCard
              key={sp.speciesCode}
              sp={sp}
              isFocused={focusedSpecies?.code === sp.speciesCode}
              isDimmed={!!focusedSpecies && focusedSpecies.code !== sp.speciesCode}
              onFlyTo={() => flyToTarget(sp.speciesCode)}
              onFocusSpecies={onFocusSpecies}
              lightMode={lightMode}
            />
          ))}
        </Section>
      )}

      {/* Lifer / Year Opportunities */}
      <Section
        title={liferSectionTitle}
        count={liferAll.length}
        accent="#60a5fa"
        empty={yearListActive ? 'No new species this year nearby' : 'No lifers nearby'}
        lightMode={lightMode}
      >
        {liferAll.map((obs) => (
          <AlertCard
            key={`${obs.speciesCode}|${obs.locId || obs.locName}`}
            obs={obs}
            yearListActive={yearListActive}
            isFocused={focusedSpecies?.code === obs.speciesCode}
            isDimmed={!!focusedSpecies && focusedSpecies.code !== obs.speciesCode}
            onFlyTo={onFlyTo}
            onFocusSpecies={onFocusSpecies}
            lightMode={lightMode}
            distKm={sortBy === 'closest' ? haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng) : undefined}
          />
        ))}
      </Section>

      {/* Rare Seen Nearby */}
      <Section
        title="Rare Seen Nearby"
        count={rare.length}
        accent="#94a3b8"
        empty="No rare species nearby"
        lightMode={lightMode}
      >
        {rare.map((obs) => (
          <AlertCard
            key={`${obs.speciesCode}|${obs.locId || obs.locName}`}
            obs={obs}
            yearListActive={yearListActive}
            isFocused={focusedSpecies?.code === obs.speciesCode}
            isDimmed={!!focusedSpecies && focusedSpecies.code !== obs.speciesCode}
            onFlyTo={onFlyTo}
            onFocusSpecies={onFocusSpecies}
            lightMode={lightMode}
            distKm={sortBy === 'closest' ? haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng) : undefined}
          />
        ))}
      </Section>

      {/* Already Seen Nearby */}
      <Section
        title="Already Seen Nearby"
        count={recent.length}
        accent="#6b7280"
        empty="No previously seen species nearby"
        lightMode={lightMode}
      >
        {recent.map((obs) => (
          <AlertCard
            key={`${obs.speciesCode}|${obs.locId || obs.locName}`}
            obs={obs}
            yearListActive={yearListActive}
            isFocused={focusedSpecies?.code === obs.speciesCode}
            isDimmed={!!focusedSpecies && focusedSpecies.code !== obs.speciesCode}
            onFlyTo={onFlyTo}
            onFocusSpecies={onFocusSpecies}
            lightMode={lightMode}
            distKm={sortBy === 'closest' ? haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng) : undefined}
          />
        ))}
      </Section>

      {/* End of normal (non-search) content */}
      </>}
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

function Section({
  title,
  count,
  accent,
  empty,
  lightMode,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  empty: string;
  lightMode: boolean;
  children: React.ReactNode;
}) {
  const border = lightMode ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
  const headerBg = lightMode ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)';
  const labelColor = lightMode ? '#4a5568' : '#8899aa';
  const emptyColor = lightMode ? '#a0aec0' : '#334455';

  return (
    <div style={{ borderBottom: `1px solid ${border}` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px 8px',
          background: headerBg,
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        <div style={{ width: 3, height: 14, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: labelColor,
            fontFamily: 'var(--font-jb-mono, monospace)',
            textTransform: 'uppercase',
          }}
        >
          {title}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: accent,
            fontFamily: 'var(--font-jb-mono, monospace)',
            fontWeight: 700,
          }}
        >
          {count}
        </span>
      </div>
      <div>
        {count === 0 ? (
          <div
            style={{
              padding: '12px 14px',
              fontSize: 12,
              color: emptyColor,
              fontStyle: 'italic',
            }}
          >
            {empty}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// ─── Target Species Card ─────────────────────────────────────────────────────

function TargetCard({
  sp,
  isFocused,
  isDimmed,
  onFlyTo,
  onFocusSpecies,
  lightMode,
}: {
  sp: TargetSpecies;
  isFocused: boolean;
  isDimmed: boolean;
  onFlyTo: () => void;
  onFocusSpecies: (code: string, name: string) => void;
  lightMode: boolean;
}) {
  const accent = '#3ecfb4';
  const textPrimary = lightMode ? '#1a2332' : '#ddeeff';
  const textSecondary = lightMode ? '#4a5568' : '#556677';
  const border = lightMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
  const focusedBg = isFocused ? `${accent}15` : 'transparent';

  return (
    <button
      onClick={() => {
        onFlyTo();
        onFocusSpecies(sp.speciesCode, sp.comName);
      }}
      style={{
        width: '100%',
        textAlign: 'left',
        background: focusedBg,
        border: 'none',
        borderLeft: `3px solid ${isFocused ? accent : `${accent}55`}`,
        padding: '9px 12px',
        cursor: sp.nearbyCount > 0 ? 'pointer' : 'default',
        borderBottom: `1px solid ${border}`,
        transition: 'background 0.15s, opacity 0.15s',
        opacity: isDimmed ? 0.35 : 1,
      }}
      onMouseEnter={(e) => {
        if (sp.nearbyCount > 0 && !isFocused) (e.currentTarget as HTMLElement).style.background = `${accent}0d`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = focusedBg;
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: textPrimary,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 1,
            }}
          >
            {sp.comName}
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
            {sp.sciName}
          </div>
        </div>
        <span
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-jb-mono, monospace)',
            background: `${accent}1a`,
            color: accent,
            border: `1px solid ${accent}33`,
            borderRadius: 3,
            padding: '1px 5px',
            letterSpacing: '0.07em',
            fontWeight: 700,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {sp.nearbyCount > 0 ? `${sp.nearbyCount} nearby` : 'EXPECTED'}
        </span>
      </div>
    </button>
  );
}

// ─── Alert Card ──────────────────────────────────────────────────────────────

function AlertCard({
  obs,
  yearListActive,
  isFocused,
  isDimmed,
  onFlyTo,
  onFocusSpecies,
  lightMode,
  distKm,
}: {
  obs: ClassifiedObservation;
  yearListActive: boolean;
  isFocused: boolean;
  isDimmed: boolean;
  onFlyTo: (lat: number, lng: number) => void;
  onFocusSpecies: (code: string, name: string) => void;
  lightMode: boolean;
  distKm?: number;
}) {
  const color = getTierColor(obs.tier);
  const baseLabel = getTierLabel(obs.tier);
  // In year list mode, relabel "LIFER" tiers to "YEAR NEW"
  const label = yearListActive && obs.tier === 'lifer'
    ? 'YEAR NEW'
    : yearListActive && obs.tier === 'lifer-rare'
    ? 'YEAR + RARE'
    : yearListActive && obs.tier === 'rare'
    ? 'RARE SEEN'
    : baseLabel;

  const textPrimary = lightMode ? '#1a2332' : '#ddeeff';
  const textSecondary = lightMode ? '#4a5568' : '#556677';
  const textMuted = lightMode ? '#718096' : '#445566';
  const border = lightMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
  const focusedBg = isFocused ? `${color}12` : 'transparent';

  return (
    <button
      onClick={() => {
        onFlyTo(obs.lat, obs.lng);
        onFocusSpecies(obs.speciesCode, obs.comName);
      }}
      style={{
        width: '100%',
        textAlign: 'left',
        background: focusedBg,
        border: 'none',
        borderLeft: `3px solid ${isFocused ? color : `${color}66`}`,
        padding: '9px 12px 9px 12px',
        cursor: 'pointer',
        borderBottom: `1px solid ${border}`,
        transition: 'background 0.15s, opacity 0.15s',
        opacity: isDimmed ? 0.35 : 1,
      }}
      onMouseEnter={(e) => {
        if (!isFocused) (e.currentTarget as HTMLElement).style.background = `${color}0d`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = focusedBg;
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: textPrimary,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 1,
            }}
          >
            {obs.comName}
          </div>
          <div
            style={{
              fontSize: 11,
              color: textSecondary,
              fontStyle: 'italic',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 4,
            }}
          >
            {obs.sciName}
          </div>
          <div
            style={{
              fontSize: 11,
              color: textMuted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            📍 {obs.locName}
          </div>
          {obs.reportCount && obs.reportCount > 1 && (
            <div style={{ fontSize: 10, color: textMuted, fontFamily: 'var(--font-jb-mono, monospace)', marginTop: 2, opacity: 0.8 }}>
              {obs.reportCount}× this week
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 9,
              fontFamily: 'var(--font-jb-mono, monospace)',
              background: `${color}1a`,
              color: color,
              border: `1px solid ${color}33`,
              borderRadius: 3,
              padding: '1px 5px',
              letterSpacing: '0.07em',
              fontWeight: 700,
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontSize: 11,
              color: textMuted,
              fontFamily: 'var(--font-jb-mono, monospace)',
            }}
          >
            {distKm !== undefined
              ? distKm < 1
                ? `${Math.round(distKm * 1000)}m`
                : `${distKm.toFixed(1)}km`
              : timeAgo(obs.obsDt)}
          </span>
        </div>
      </div>
    </button>
  );
}

'use client';

import { useEffect, useState } from 'react';
import type { ClassifiedObservation, TargetSpecies } from '@/lib/ebird';
import { timeAgo, fmtDist, parseObsDt } from '@/lib/ebird';
import { getTheme, tierTokens, tierLabel, type Theme } from '@/lib/theme';
import { fetchChaseStats } from '@/lib/chase';
import { haversineKm } from '@/lib/geo';
import type { ArrivingSpecies } from '@/lib/forecast';
import ChasePanel from '@/components/ChasePanel';
import { SearchIcon, XIcon, MapPinIcon, TargetIcon } from '@/components/Icons';

type SortMode = 'recent' | 'closest' | 'chase';

function formatArrival(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (isNaN(m) || isNaN(d)) return dateStr;
  return `${months[m]} ${d}`;
}

interface Props {
  observations: ClassifiedObservation[];
  targetSpecies: TargetSpecies[];
  arrivingSpecies: ArrivingSpecies[];
  yearListActive: boolean;
  lightMode: boolean;
  useMetric?: boolean;
  userCenter: [number, number];
  focusedSpecies: { code: string; name: string } | null;
  onFlyTo: (lat: number, lng: number) => void;
  onFocusSpecies: (code: string, name: string) => void;
}

export default function AlertsPanel({
  observations, targetSpecies, arrivingSpecies, yearListActive, lightMode, useMetric = true,
  userCenter, focusedSpecies, onFlyTo, onFocusSpecies,
}: Props) {
  const [sortBy, setSortBy] = useState<SortMode>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredSort, setHoveredSort] = useState<SortMode | null>(null);
  const [chaseScores, setChaseScores] = useState<Map<string, number>>(new Map());
  const [chaseScoring, setChaseScoring] = useState(false);
  const t = getTheme(lightMode);

  function byRecency(a: ClassifiedObservation, b: ClassifiedObservation): number {
    return parseObsDt(b.obsDt).getTime() - parseObsDt(a.obsDt).getTime();
  }

  function sortObs(arr: ClassifiedObservation[], allowChase = false): ClassifiedObservation[] {
    if (sortBy === 'closest') {
      // Precompute distances once instead of inside the comparator (O(n) vs O(n log n) haversines)
      return arr
        .map((obs) => ({ obs, d: haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng) }))
        .sort((a, b) => a.d - b.d)
        .map(({ obs }) => obs);
    }
    if (sortBy === 'chase' && allowChase) {
      // Scored species first (highest odds), the rest in recency order below.
      // Scores are fetched lazily for the lifer section only (see effect).
      return [...arr].sort((a, b) => {
        const sa = chaseScores.get(a.speciesCode);
        const sb = chaseScores.get(b.speciesCode);
        if (sa !== undefined && sb !== undefined) return sb - sa;
        if (sa !== undefined) return -1;
        if (sb !== undefined) return 1;
        return byRecency(a, b);
      });
    }
    return [...arr].sort(byRecency);
  }

  const liferAll = sortObs(observations.filter(o => o.tier === 'lifer-rare' || o.tier === 'lifer'), true);
  const rare = sortObs(observations.filter(o => o.tier === 'rare'));
  const seen = sortObs(observations.filter(o => o.tier === 'seen'));

  // Stable signature of the lifer species set — drives the chase-scoring effect
  const liferCodesSig = Array.from(
    new Set(
      observations
        .filter(o => o.tier === 'lifer' || o.tier === 'lifer-rare')
        .map(o => o.speciesCode)
    )
  ).sort().join(',');

  // Lazily score the lifer section when "Chase odds" sort is active. Bounded to
  // the most-recent unique species and fetched with small concurrency so we
  // never trip the per-IP rate limit.
  useEffect(() => {
    if (sortBy !== 'chase') return;
    let cancelled = false;

    const repByCode = new Map<string, ClassifiedObservation>();
    for (const o of observations) {
      if (o.tier !== 'lifer' && o.tier !== 'lifer-rare') continue;
      const cur = repByCode.get(o.speciesCode);
      if (!cur || parseObsDt(o.obsDt) > parseObsDt(cur.obsDt)) repByCode.set(o.speciesCode, o);
    }
    const reps = Array.from(repByCode.values()).slice(0, 20); // bound request count
    if (reps.length === 0) return;

    setChaseScoring(true);
    const scores = new Map(chaseScores);
    let idx = 0;

    async function worker() {
      while (!cancelled && idx < reps.length) {
        const obs = reps[idx++];
        if (scores.has(obs.speciesCode)) continue;
        try {
          const stats = await fetchChaseStats(obs.speciesCode, obs.lat, obs.lng, 25);
          if (cancelled) return;
          scores.set(obs.speciesCode, stats.score);
          setChaseScores(new Map(scores));
        } catch {
          // leave unscored — it sorts below scored species
        }
      }
    }

    const CONCURRENCY = 4;
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, reps.length) }, worker))
      .finally(() => { if (!cancelled) setChaseScoring(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, liferCodesSig]);

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
            {(['recent', 'closest', 'chase'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                onMouseEnter={() => setHoveredSort(s)}
                onMouseLeave={() => setHoveredSort(null)}
                title={s === 'chase' ? 'Rank lifers by how likely the bird is still there' : undefined}
                style={{
                  flex: 1, padding: '7px 0',
                  background: sortBy === s ? t.accentBg : hoveredSort === s ? t.bg2 : 'transparent',
                  border: 'none',
                  color: sortBy === s ? t.accent : t.fg2,
                  fontSize: 11.5, fontWeight: sortBy === s ? 600 : 400,
                  cursor: 'pointer', fontFamily: t.sans,
                  transition: 'all 0.12s',
                }}>
                {s === 'recent' ? 'Recent' : s === 'closest' ? 'Closest' : 'Chase Odds'}
              </button>
            ))}
          </div>
        )}

        {!searchActive && sortBy === 'chase' && (
          <div style={{ marginTop: 6, fontSize: 10.5, color: t.fg3, fontFamily: t.mono, textAlign: 'center' }}>
            {chaseScoring ? 'Scoring lifers by chase odds…' : 'Lifers ranked by chase odds'}
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
                obs={obs} t={t} lightMode={lightMode} yearListActive={yearListActive}
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

          {arrivingSpecies.length > 0 && (
            <>
              <SectionHeader title="Arriving Soon" count={arrivingSpecies.length} t={t} dotColor={t.target}/>
              <div style={{ padding: '8px 16px 4px', fontSize: 10.5, color: t.fg3, fontFamily: t.mono, lineHeight: 1.5 }}>
                Expected in your region within weeks — not being seen locally yet.{' '}
                <a
                  href="https://birdcast.info/migration-tools/live-bird-migration-maps/"
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: t.target, textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  Migration tonight (BirdCast) →
                </a>
              </div>
              {arrivingSpecies.map(sp => (
                <ArrivingCard key={sp.speciesCode} sp={sp} t={t} />
              ))}
            </>
          )}

          <SectionHeader title={liferSectionTitle} count={liferAll.length} t={t} dotColor={t.lifer}/>
          {liferAll.length === 0
            ? <EmptyState text={yearListActive ? 'No new species this year nearby' : 'No lifers nearby'} t={t}/>
            : liferAll.map(obs => (
              <ObsCard key={`${obs.speciesCode}|${obs.locId ?? obs.locName}`}
                obs={obs} t={t} lightMode={lightMode} yearListActive={yearListActive}
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
                obs={obs} t={t} lightMode={lightMode} yearListActive={yearListActive}
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
                obs={obs} t={t} lightMode={lightMode} yearListActive={yearListActive}
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

function ObsCard({ obs, t, lightMode, yearListActive, focusedCode, onFlyTo, onFocusSpecies, distKm, useMetric }: {
  obs: ClassifiedObservation;
  t: Theme;
  lightMode: boolean;
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
  // Chase odds are meaningful for anything you'd drive out for; a bird already
  // on your list (seen tier) isn't a chase target.
  const showChase = obs.tier !== 'seen';

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: focused ? tc.bg : hov ? t.bg2 : 'transparent',
        borderBottom: `1px solid ${t.line1}`,
        opacity: dimmed ? 0.28 : 1,
        transition: 'all 0.12s', fontFamily: t.sans,
      }}>
      <button
        onClick={() => { onFlyTo(obs.lat, obs.lng); onFocusSpecies(obs.speciesCode, obs.comName); }}
        style={{
          width: '100%', textAlign: 'left', background: 'transparent',
          border: 'none', padding: '13px 16px 6px', cursor: 'pointer',
          fontFamily: t.sans, display: 'block',
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

      {showChase && (
        <div style={{ padding: '0 16px 12px 29px' }}>
          <div style={{
            fontSize: 9.5, fontWeight: 700, fontFamily: t.mono, color: t.fg3,
            letterSpacing: '0.06em',
          }}>
            SIGHTING ODDS
          </div>
          <ChasePanel speciesCode={obs.speciesCode} lat={obs.lat} lng={obs.lng} lightMode={lightMode} lazy />
        </div>
      )}
    </div>
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

// ─── Arriving-soon card (temporal forecast) ──────────────────────────────────

function ArrivingCard({ sp, t }: { sp: ArrivingSpecies; t: Theme }) {
  // frequency → a coarse confidence read
  const confidence = sp.frequency >= 0.75 ? 'Reliable' : sp.frequency >= 0.5 ? 'Likely' : 'Possible';

  return (
    <div style={{
      display: 'block', width: '100%', textAlign: 'left',
      borderBottom: `1px solid ${t.line1}`, padding: '12px 16px',
      fontFamily: t.sans,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: t.fg0, fontFamily: t.display,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sp.comName}
            </span>
            {sp.isLifer && (
              <span style={{
                fontSize: 9, fontWeight: 700, fontFamily: t.mono, flexShrink: 0,
                color: t.lifer, background: t.liferBg, border: `1px solid ${t.liferBorder}`,
                borderRadius: 4, padding: '1px 5px', letterSpacing: '0.03em',
              }}>LIFER</span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: t.fg2, fontStyle: 'italic' }}>{sp.sciName}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontFamily: t.mono, color: t.target, fontWeight: 600 }}>
            ~{formatArrival(sp.arrivalDate)}
          </div>
          <div style={{ fontSize: 9.5, fontFamily: t.mono, color: t.fg3, marginTop: 1 }}>
            {confidence}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ClassifiedObservation, TargetSpecies } from '@/lib/ebird';
import { timeAgo, fmtDist, parseObsDt } from '@/lib/ebird';
import { getTheme, tierTokens, tierLabel, oddsColor, oddsLabel, type Theme } from '@/lib/theme';
import { fetchChaseStats } from '@/lib/chase';
import { haversineKm } from '@/lib/geo';
import {
  sortObservations,
  sectionSortMode,
  tierHasChaseOdds,
  SORT_MODES,
  SORT_LABELS,
  type SortMode,
} from '@/lib/alerts-sort';
import type { ArrivingSpecies } from '@/lib/forecast';
import { isPrivateLocation, PRIVATE_LOCATION_LABEL } from '@/lib/location-privacy';
import { locKeyOf } from '@/lib/markers';
import {
  getDriveTimeConfigured,
  subscribeDriveTimeConfigured,
  type LatLng,
} from '@/lib/drive-time';
import ChasePanel from '@/components/ChasePanel';
import DriveTimeBadge from '@/components/DriveTimeBadge';
import { SearchIcon, XIcon, MapPinIcon, TargetIcon, LockIcon, CarIcon } from '@/components/Icons';

/** Drive-time tolerances offered by the "reachable only" filter, in minutes.
 *  30 is the default (DEFAULT_SETTINGS.driveTimeMaxMin); the rest bracket it. */
const DRIVE_TIME_TOLERANCES = [15, 30, 45, 60, 90] as const;

/**
 * Unique species scored per pass of the chase-odds effect.
 *
 * Was 20 and lifers-only. Widening the sort to the `rare` section widened the
 * set that needs a score, so this went to 30 — chosen against the *upstream*
 * budget, not the UI: each entry is one `/api/ebird/species` call sharing the
 * eBird proxy's per-minute allowance with the three-endpoint search fetch.
 * Raising it further trades sortable rows for 503s on the map.
 */
const CHASE_SCORE_CAP = 30;

/**
 * Slots held back for the "Rare — Already Seen" section.
 *
 * A plain lifers-first priority order does **not** work, and this was measured
 * rather than reasoned about: on a normal day the default search area returns
 * 85+ unscored lifer species, which swallows all 30 slots, and the rare section
 * gets zero scores — so it falls back to recency and is byte-identical to
 * "Recent". That is the original bug wearing a different hat.
 *
 * Rarities are, definitionally, few. Eight is comfortably above what the section
 * holds in practice (5 in the reproduction), so reserving them costs a quarter
 * of the budget on paper and far less in practice — any unclaimed reserve is
 * handed straight back to the lifers below.
 */
const RARE_SCORE_RESERVE = 8;

/**
 * Which species get scored, and in what order, when the cap bites.
 *
 * **The rare reserve goes first in the queue, not last.** Ordering the queue
 * lifers-first is the intuitive choice and it was measured to be wrong: the
 * workers score sequentially at four at a time, so with 26 lifers ahead of them
 * the four rarities did not resolve for ~35 seconds, and for that whole window
 * the Rare section sat in recency order — indistinguishable from the bug. The
 * reserve is small by construction, so putting it in front delays the lifer
 * section by a handful of requests and makes the guarantee immediate instead of
 * eventual.
 */
function selectChaseReps(reps: ClassifiedObservation[]): ClassifiedObservation[] {
  const lifers = reps.filter((o) => o.tier === 'lifer' || o.tier === 'lifer-rare');
  const rares = reps.filter((o) => o.tier === 'rare');

  const rareTake = rares.slice(0, RARE_SCORE_RESERVE);
  const liferTake = lifers.slice(0, CHASE_SCORE_CAP - rareTake.length);
  // Hand back whatever the lifers didn't use — a quiet day must not leave the
  // reserve capped at 8 when there is budget going spare.
  const spare = CHASE_SCORE_CAP - rareTake.length - liferTake.length;
  const rareExtra = spare > 0 ? rares.slice(rareTake.length, rareTake.length + spare) : [];

  return [...rareTake, ...rareExtra, ...liferTake];
}

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
  /** The user's GPS fix. `null` when geolocation was denied — badges are omitted
   *  and the filter is disabled, since there is nothing to measure from. */
  driveOrigin: LatLng | null;
  driveTimeReachableOnly: boolean;
  driveTimeMaxMin: number;
  /** Sort mode and search text are owned by Sidebar, not by this panel.
   *  Sidebar renders `{activeTab === 'alerts' && <AlertsPanel/>}`, so a tab
   *  switch unmounts this component — local state here silently reverted the
   *  user's choice to "Recent", which is one half of the Phase E1 sort bug. */
  sortBy: SortMode;
  onSortByChange: (mode: SortMode) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onFlyTo: (lat: number, lng: number) => void;
  onFocusSpecies: (code: string, name: string) => void;
  onDriveTimeFilterChange: (reachableOnly: boolean, maxMin: number) => void;
}

export default function AlertsPanel({
  observations, targetSpecies, arrivingSpecies, yearListActive, lightMode, useMetric = true,
  userCenter, focusedSpecies, driveOrigin, driveTimeReachableOnly, driveTimeMaxMin,
  sortBy, onSortByChange, searchQuery, onSearchQueryChange,
  onFlyTo, onFocusSpecies, onDriveTimeFilterChange,
}: Props) {
  const [hoveredSort, setHoveredSort] = useState<SortMode | null>(null);
  const [chaseScores, setChaseScores] = useState<Map<string, number>>(new Map());
  const [chaseScoring, setChaseScoring] = useState(false);
  const t = getTheme(lightMode);

  /** Whether the server can answer drive-time questions at all. `null` until the
   *  first response — the server snapshot, so SSR renders the neutral state. */
  const driveTimeConfigured = useSyncExternalStore(
    subscribeDriveTimeConfigured,
    getDriveTimeConfigured,
    () => null,
  );

  // One context, every list. Building it here rather than at each call site is
  // what stops the sections from drifting apart again.
  const sortCtx = { center: userCenter, scores: chaseScores };

  const liferAll = sortObservations(
    observations.filter(o => o.tier === 'lifer-rare' || o.tier === 'lifer'),
    sectionSortMode(sortBy, 'lifer'),
    sortCtx,
  );
  const rare = sortObservations(
    observations.filter(o => o.tier === 'rare'),
    sectionSortMode(sortBy, 'rare'),
    sortCtx,
  );
  const seen = sortObservations(
    observations.filter(o => o.tier === 'seen'),
    sectionSortMode(sortBy, 'seen'),
    sortCtx,
  );

  // Stable signature of the species set that needs a score — drives the effect.
  // Covers every tier that shows odds, which is every tier the chase sort now
  // reorders; scoring a narrower set than the sort consumes is what made "Chase
  // Odds" identical to "Recent" in two of the three sections.
  const chaseCodesSig = Array.from(
    new Set(observations.filter(o => tierHasChaseOdds(o.tier)).map(o => o.speciesCode))
  ).sort().join(',');

  // Lazily score the chaseable sections when "Chase odds" sort is active.
  // Bounded to the most-recent unique species and fetched with small concurrency
  // so we never trip the per-IP rate limit.
  useEffect(() => {
    if (sortBy !== 'chase') return;
    let cancelled = false;

    const repByCode = new Map<string, ClassifiedObservation>();
    for (const o of observations) {
      if (!tierHasChaseOdds(o.tier)) continue;
      const cur = repByCode.get(o.speciesCode);
      if (!cur || parseObsDt(o.obsDt) > parseObsDt(cur.obsDt)) repByCode.set(o.speciesCode, o);
    }
    const reps = selectChaseReps(Array.from(repByCode.values()));
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
  }, [sortBy, chaseCodesSig]);

  /** Whether this species' odds are known, still being fetched, or unavailable.
   *  Chase mode must never render a score it does not have — an unscored card
   *  that looks scored is exactly how "Chase Odds" passed for "Recent". */
  function chaseState(code: string): { score: number } | 'pending' | 'unavailable' {
    const score = chaseScores.get(code);
    if (score !== undefined) return { score };
    return chaseScoring ? 'pending' : 'unavailable';
  }

  /**
   * The metric the active sort actually ordered by, handed to the card.
   *
   * Distance used to be the only one shown, and only in "Closest" — so in the
   * other two modes nothing on screen said whether a sort had run at all. That
   * is what made two broken sort modes survive four phases.
   */
  function sortMetricProps(obs: ClassifiedObservation, mode: SortMode) {
    return {
      distKm: mode === 'closest'
        ? haversineKm(userCenter[0], userCenter[1], obs.lat, obs.lng)
        : undefined,
      chase: mode === 'chase' ? chaseState(obs.speciesCode) : undefined,
    };
  }

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
  // Search results obey the selected sort like every other list. They used to be
  // hardcoded to recency *and* the sort control was hidden while searching, so a
  // query silently pinned the whole panel to "Recent" with nothing on screen
  // saying so — a third way the sort appeared not to work.
  const searchResults = searchActive
    ? sortObservations(
        observations.filter(o => {
          const q = searchQuery.trim().toLowerCase();
          return o.comName.toLowerCase().includes(q) || o.sciName.toLowerCase().includes(q);
        }),
        sortBy,
        sortCtx,
      )
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
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: t.fg3 }}/>
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchQueryChange(e.target.value)}
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
            <button onClick={() => onSearchQueryChange('')} style={{
              position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: t.fg3, padding: '0 2px',
            }}>
              <XIcon size={14}/>
            </button>
          )}
        </div>

        {/* Deliberately NOT hidden while searching. Hiding it left the results
            recency-ordered with no control visible to explain why. */}
        <div style={{
          display: 'flex', border: `1px solid ${t.line2}`,
          borderRadius: 8, overflow: 'hidden',
        }}>
          {/* The active pill is a soft `accentBg` tint — NOT a solid fill, which
              is what this briefly was.

              The tint alone cannot carry the signal, and that is the whole
              reason for the underline. In light mode `accentBg` is
              rgba(27,67,50,0.05) over white (~#F2F4F3), sitting next to a hover
              state of `bg2` (#F1F3F5): a difference of about one value step.
              "Did my click register?" was not answerable from the screen, and
              that ambiguity is why a working sort read as a broken one for a
              whole phase.

              The underline is a *shape* cue rather than another colour, so it
              survives the two backgrounds being near-identical. Every pill
              carries `2px solid transparent`, so making one accent-coloured
              changes no heights and shifts nothing in the row. */}
          {SORT_MODES.map(s => {
            const active = sortBy === s;
            return (
              <button
                key={s}
                onClick={() => onSortByChange(s)}
                onMouseEnter={() => setHoveredSort(s)}
                onMouseLeave={() => setHoveredSort(null)}
                aria-pressed={active}
                title={s === 'chase' ? 'Rank by how likely the bird is still there' : undefined}
                style={{
                  flex: 1, padding: '7px 0',
                  background: active ? t.accentBg : hoveredSort === s ? t.bg2 : 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${active ? t.accent : 'transparent'}`,
                  color: active ? t.accent : t.fg2,
                  fontSize: 11.5, fontWeight: active ? 600 : 400,
                  cursor: 'pointer', fontFamily: t.sans,
                  transition: 'all 0.12s',
                }}>
                {SORT_LABELS[s]}
              </button>
            );
          })}
        </div>

        {/* States the active ordering in words.
            This used to read "Orders the sightings below, not Target or
            Arriving" — a sentence that existed solely to explain why the top of
            the panel did not move when the sort changed. The sorted sections now
            sit directly beneath this control, so that explanation is not just
            unnecessary, it is false. A stale explanation is worse than none. */}
        <div style={{ marginTop: 6, fontSize: 10.5, color: t.fg3, fontFamily: t.mono, textAlign: 'center', lineHeight: 1.4 }}>
          {sortBy === 'chase'
            ? (chaseScoring ? 'Scoring by chase odds…' : 'Ranked by chase odds')
            : sortBy === 'closest'
              ? 'Nearest sightings first'
              : 'Newest sightings first'}
        </div>

        {!searchActive && (
          <DriveTimeFilter
            t={t}
            enabled={driveOrigin !== null}
            configured={driveTimeConfigured}
            reachableOnly={driveTimeReachableOnly}
            maxMin={driveTimeMaxMin}
            onChange={onDriveTimeFilterChange}
          />
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
            // No `distKm` override below. One used to sit AFTER the
            // `sortMetricProps` spread and win, so search results showed a
            // distance in all three modes — contradicting the rule that each
            // mode renders its own sort key, and making the control look inert
            // while a search was active.
            searchResults.map(obs => (
              <ObsCard
                key={`s-${obs.speciesCode}-${obs.locId ?? obs.locName}`}
                obs={obs} t={t} lightMode={lightMode} yearListActive={yearListActive}
                focusedCode={focusedSpecies?.code ?? null}
                onFlyTo={onFlyTo} onFocusSpecies={onFocusSpecies}
                {...sortMetricProps(obs, sortBy)}
                useMetric={useMetric}
                driveOrigin={driveOrigin}
              />
            ))
          )}
        </div>
      ) : (
        <>
          {/* ── The sorted sections come FIRST, directly under the sort control ──
              This ordering is the fix for "changing categories does nothing", and
              it replaces a scroll effect that used to jump the panel down past
              the two sections below.

              Target Species and Arriving Soon genuinely cannot be ordered by this
              control — a TargetSpecies has a `nearbyCount` and an ArrivingSpecies
              has an arrival date, so there is no recency, distance or chase score
              on either (lib/ebird.ts, lib/forecast.ts). While they led the panel
              they were 22 cards and ~1681 px of sort-invariant content standing
              between the control and the first card it touches, so clicking
              Recent / Closest / Chase Odds changed nothing a user could see.

              **Anything added above this point re-creates that bug.** New
              sections belong below the sorted three, or below Arriving Soon. */}
          <SectionHeader title={liferSectionTitle} count={liferAll.length} t={t} dotColor={t.lifer}/>
          {liferAll.length === 0
            ? <EmptyState text={yearListActive ? 'No new species this year nearby' : 'No lifers nearby'} t={t}/>
            : liferAll.map(obs => (
              <ObsCard key={`${obs.speciesCode}|${obs.locId ?? obs.locName}`}
                obs={obs} t={t} lightMode={lightMode} yearListActive={yearListActive}
                focusedCode={focusedSpecies?.code ?? null}
                onFlyTo={onFlyTo} onFocusSpecies={onFocusSpecies}
                {...sortMetricProps(obs, sectionSortMode(sortBy, 'lifer'))}
                useMetric={useMetric}
                driveOrigin={driveOrigin}
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
                {...sortMetricProps(obs, sectionSortMode(sortBy, 'rare'))}
                useMetric={useMetric}
                driveOrigin={driveOrigin}
              />
            ))}

          <SectionHeader
            title="Seen Nearby"
            count={seen.length}
            t={t}
            dotColor={t.seen}
            // Says why this one section ignores the chase sort, rather than
            // letting it look like the sort simply failed here.
            note={sortBy === 'chase' ? 'by recency — no chase odds for seen birds' : undefined}
          />
          {seen.length === 0
            ? <EmptyState text="No previously seen species nearby" t={t}/>
            : seen.map(obs => (
              <ObsCard key={`${obs.speciesCode}|${obs.locId ?? obs.locName}`}
                obs={obs} t={t} lightMode={lightMode} yearListActive={yearListActive}
                focusedCode={focusedSpecies?.code ?? null}
                onFlyTo={onFlyTo} onFocusSpecies={onFocusSpecies}
                {...sortMetricProps(obs, sectionSortMode(sortBy, 'seen'))}
                useMetric={useMetric}
                driveOrigin={driveOrigin}
              />
            ))}

          {/* ── Below the sort's reach ──────────────────────────────────────
              Neither of these is ordered by the control above, and neither can
              be. They are here rather than at the top for exactly that reason —
              see the note on the lifer header. They are still the answer to
              "what should I go looking for", so they are kept in full, not
              demoted to a link or a collapsed accordion. */}
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
        </>
      )}
    </div>
  );
}

// ─── Drive-time filter ───────────────────────────────────────────────────────
// Two controls, one concern: a switch that turns the filter on, and the tolerance
// it filters at. The tolerance stays visible while off so the switch's label can
// say what it will do before it does it.
//
// This is NOT the "Chase Odds" sort a few pixels above it. That ranks by whether
// the bird is still there (lib/chase.ts); this hides birds that are too far to
// drive to. Keeping the two visually distinct is why this sits in its own row
// with its own glyph rather than becoming a fourth sort button.

function DriveTimeFilter({ t, enabled: hasOrigin, configured, reachableOnly, maxMin, onChange }: {
  t: Theme;
  /** There is a GPS fix to measure from. */
  enabled: boolean;
  /** The server has a routing key. `null` until the first answer — treated as
   *  usable, because assuming a misconfiguration before asking would disable a
   *  working control on every cold load. */
  configured: boolean | null;
  reachableOnly: boolean;
  maxMin: number;
  onChange: (reachableOnly: boolean, maxMin: number) => void;
}) {
  // Two distinct reasons this control cannot work, and they need distinct copy:
  // no origin is the user's to fix from the browser, no routing key is the
  // operator's to fix in the environment. Collapsing them into one disabled
  // state sends the user hunting for a permission prompt that will never help.
  const unconfigured = configured === false;
  const enabled = hasOrigin && !unconfigured;
  const on = enabled && reachableOnly;

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => onChange(!reachableOnly, maxMin)}
        disabled={!enabled}
        aria-pressed={on}
        title={
          unconfigured
            ? 'Routing is not configured on the server'
            : hasOrigin ? undefined : 'Needs your location'
        }
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 7,
          padding: '7px 9px', borderRadius: 8,
          background: on ? t.accentBg : 'transparent',
          border: `1px solid ${on ? t.accentBorder : t.line2}`,
          color: !enabled ? t.fg4 : on ? t.accent : t.fg2,
          fontSize: 11.5, fontWeight: on ? 600 : 400,
          fontFamily: t.sans, cursor: enabled ? 'pointer' : 'default',
          transition: 'all 0.12s',
        }}
      >
        <CarIcon size={13} />
        <span style={{ flex: 1, textAlign: 'left' }}>
          Reachable only — within {maxMin} min
        </span>
        <span
          aria-hidden
          style={{
            width: 26, height: 15, borderRadius: 8, flexShrink: 0,
            background: on ? t.accent : t.line3,
            position: 'relative', transition: 'background 0.15s',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: on ? 13 : 2,
            width: 11, height: 11, borderRadius: '50%',
            background: t.bg1, transition: 'left 0.15s',
          }}/>
        </span>
      </button>

      {/* A silently missing control reads as a bug; say it was a decision.
          Same reasoning as PRIVATE_LOCATION_HINT in lib/location-privacy.ts.
          The unconfigured case says who can fix it — the previous behaviour was
          an enabled switch that filtered nothing, which is strictly worse than
          an honest disabled one. */}
      {!enabled && (
        <div style={{
          marginTop: 5, fontSize: 10, color: t.fg3, fontFamily: t.mono,
          lineHeight: 1.4, textAlign: 'center',
        }}>
          {unconfigured
            ? 'Drive times unavailable — routing key not configured'
            : 'Drive times need your location'}
        </div>
      )}

      {on && (
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {DRIVE_TIME_TOLERANCES.map((m) => {
            const active = m === maxMin;
            return (
              <button
                key={m}
                onClick={() => onChange(reachableOnly, m)}
                style={{
                  flex: 1, padding: '5px 0', borderRadius: 6,
                  background: active ? t.accentBg : 'transparent',
                  border: `1px solid ${active ? t.accentBorder : t.line2}`,
                  color: active ? t.accent : t.fg3,
                  fontSize: 10.5, fontWeight: active ? 700 : 400,
                  fontFamily: t.mono, cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                {m}m
              </button>
            );
          })}
        </div>
      )}

      {on && (
        <div style={{
          marginTop: 5, fontSize: 10, color: t.fg3, fontFamily: t.mono,
          lineHeight: 1.4, textAlign: 'center',
        }}>
          Sightings with no known drive time stay visible
        </div>
      )}
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ title, count, t, dotColor, note }: {
  title: string;
  count: number;
  t: Theme;
  dotColor?: string;
  /** Second line explaining a section that does not follow the active sort. */
  note?: string;
}) {
  return (
    <div style={{
      padding: '10px 16px',
      background: t.bg2, borderBottom: `1px solid ${t.line1}`,
      borderTop: `1px solid ${t.line1}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
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
      {note && (
        <div style={{
          fontSize: 10, color: t.fg3, fontFamily: t.mono, marginTop: 3,
          marginLeft: dotColor ? 16 : 0, lineHeight: 1.35,
        }}>
          {note}
        </div>
      )}
    </div>
  );
}

// ─── Chase-odds chip ─────────────────────────────────────────────────────────
// The sort key, rendered where the sort's other keys live (distance, timeAgo).
//
// It has three states and only one of them shows a number. An unscored species
// must never borrow the look of a scored one: "Chase Odds looks the same as
// Recent" was the reported bug, and before scores land that is exactly what a
// chase-sorted list *is* — the chip is what makes that a visibly pending state
// rather than an indistinguishable one.
//
// Colours come from `oddsColor()`, never `tierTokens()` — PhaseC_rationale.md
// §11 records that tier red encodes "eBird notable" and is load-bearing.

type ChaseState = { score: number } | 'pending' | 'unavailable';

function ChaseOddsChip({ state, t, lightMode }: { state: ChaseState; t: Theme; lightMode: boolean }) {
  if (state === 'pending' || state === 'unavailable') {
    return (
      <span style={{
        fontFamily: t.mono, fontSize: 10, color: t.fg4,
        fontStyle: 'italic', whiteSpace: 'nowrap',
      }}>
        {state === 'pending' ? 'scoring…' : 'odds unknown'}
      </span>
    );
  }
  const odds = oddsColor(state.score, lightMode);
  return (
    <span
      title={oddsLabel(state.score)}
      style={{
        fontFamily: t.mono, fontSize: 10, fontWeight: 700,
        color: odds.color, background: odds.bg,
        border: `1px solid ${odds.border}`,
        borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
      }}
    >
      {state.score}% odds
    </span>
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

function ObsCard({ obs, t, lightMode, yearListActive, focusedCode, onFlyTo, onFocusSpecies, distKm, chase, useMetric, driveOrigin }: {
  obs: ClassifiedObservation;
  t: Theme;
  lightMode: boolean;
  yearListActive: boolean;
  focusedCode: string | null;
  onFlyTo: (lat: number, lng: number) => void;
  onFocusSpecies: (code: string, name: string) => void;
  distKm?: number;
  /** Present only while the chase sort is what ordered this card. */
  chase?: ChaseState;
  useMetric?: boolean;
  driveOrigin: LatLng | null;
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
              {/* A lock instead of a pin flags a personal location before the
                  user taps in and finds no directions. `onFlyTo` below is map
                  navigation, not routing, so it stays available for both. */}
              {isPrivateLocation(obs)
                ? <LockIcon size={11} style={{ color: t.fg4, flexShrink: 0 }}/>
                : <MapPinIcon size={11} style={{ color: t.fg4, flexShrink: 0 }}/>}
              <span
                title={isPrivateLocation(obs) ? PRIVATE_LOCATION_LABEL : undefined}
                style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {obs.locName}
              </span>
              {distKm !== undefined && (
                <>
                  <span style={{ color: t.fg4, margin: '0 2px' }}>·</span>
                  <span style={{ fontFamily: t.mono, fontSize: 10.5, color: t.fg3 }}>{fmtDist(distKm, useMetric)}</span>
                </>
              )}
              {chase !== undefined && (
                <>
                  <span style={{ color: t.fg4, margin: '0 2px' }}>·</span>
                  <ChaseOddsChip state={chase} t={t} lightMode={lightMode} />
                </>
              )}
              <span style={{ color: t.fg4, margin: '0 2px' }}>·</span>
              <span style={{ fontFamily: t.mono, fontSize: 10.5, color: t.fg3 }}>{timeAgo(obs.obsDt)}</span>
              {/* Lazy: dozens of these mount at once in this list. The observer
                  lives inside the badge, and lib/drive-time.ts coalesces a whole
                  scroll burst into one request. */}
              {driveOrigin && (
                <DriveTimeBadge
                  origin={driveOrigin}
                  locKey={locKeyOf(obs)}
                  coords={[obs.lat, obs.lng]}
                  lightMode={lightMode}
                  lazy
                />
              )}
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

'use client';

import { useEffect, useState } from 'react';
import type { Hotspot, Observation } from '@/lib/ebird';
import { timeAgo, parseObsDt } from '@/lib/ebird';
import { getTheme, text } from '@/lib/theme';
import { hotspotDirectionsUrl } from '@/lib/location-privacy';
import { CheckIcon, NavigationIcon, XIcon } from '@/components/Icons';
import { DETAIL_PANEL_WIDTH } from '@/components/SpeciesDetailPanel';

/**
 * Hotspot detail — a right-hand panel over the map, not a sidebar overlay.
 *
 * It used to render inside Sidebar at `position: absolute; inset: 0`, covering
 * the Alerts list. Clicking a bird pin and clicking a hotspot diamond are the
 * same gesture on the same map, and they landed in two different places — and
 * the one the hotspot took over is where *observations* live. phaseB_rationale.md
 * §3.3 put it there because this component already existed in the sidebar; §3.4
 * and §3.6 of the same document established the right-hand panel as the pattern
 * for "clicked a map object". This now follows it.
 *
 * The shell is deliberately identical to SpeciesDetailPanel's — same width
 * constant, same z-index, same mobile bottom sheet, same slide-in, same Escape
 * handler. Two panels that occupy the same slot must not drift apart.
 *
 * The parent keys this on `locId`, so switching hotspots remounts it and resets
 * the fetch state.
 */

interface Props {
  hotspot: Hotspot;
  lifeList: string[];
  onClose: () => void;
  onAddToLifeList: (code: string, name: string, sciName?: string) => void;
  lightMode: boolean;
  isMobile: boolean;
  /** Low battery / reduced motion — drops the slide-in, matching the map controls. */
  reduceMotion: boolean;
}

export default function HotspotPanel({
  hotspot, lifeList, onClose, onAddToLifeList, lightMode, isMobile, reduceMotion,
}: Props) {
  const [obs, setObs] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [hoveredAddCode, setHoveredAddCode] = useState<string | null>(null);
  const t = getTheme(lightMode);
  const lifeSet = new Set(lifeList);

  // No adjust-state-on-prop-change block for a changed `locId`. The parent keys
  // this component on it, so a different hotspot is a remount and `obs`,
  // `loading` and `error` reset for free — phaseB_rationale.md §3.4's reasoning
  // for SpeciesDetailPanel. Two mechanisms resetting the same state is how one
  // of them gets a case wrong.

  // Slide in on mount. Reduced motion skips straight to the resting position.
  const [entered, setEntered] = useState(reduceMotion);
  useEffect(() => {
    if (reduceMotion) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [reduceMotion]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

  // Same two branches as SpeciesDetailPanel.tsx, down to the constants. On
  // desktop MapControls steps left by exactly DETAIL_PANEL_WIDTH + 10, so a
  // second width here would put the controls under this panel.
  const shellStyle: React.CSSProperties = isMobile
    ? {
        position: 'fixed', left: 0, right: 0,
        // Clears the mobile tab bar. The sidebar drawer and the species sheet sit
        // at the same offset and all three are mutually exclusive — see
        // openDrawer / handleHotspotDetail / handleSelectSighting in app/page.tsx.
        bottom: 56,
        maxHeight: '60vh',
        borderTop: `1px solid ${t.line2}`,
        borderRadius: '12px 12px 0 0',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.16)',
        transform: entered ? 'translateY(0)' : 'translateY(100%)',
        zIndex: 1199,
      }
    : {
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: DETAIL_PANEL_WIDTH,
        borderLeft: `1px solid ${t.line2}`,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.10)',
        transform: entered ? 'translateX(0)' : `translateX(${DETAIL_PANEL_WIDTH}px)`,
        // Above the map controls (1001), which shift left to make room.
        zIndex: 1002,
      };

  return (
    <div
      role="dialog"
      aria-label={`${hotspot.locName} hotspot details`}
      style={{
        ...shellStyle,
        background: t.bg1,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: t.sans,
        transition: reduceMotion ? undefined : 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      {isMobile && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, flexShrink: 0 }}>
          <div style={{ width: 32, height: 3, borderRadius: 2, background: t.line3 }} />
        </div>
      )}

      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${t.line2}`, background: t.bg2, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* 14, not the role's 17: this is a place name, and place names are
                long. At 17 the ellipsis eats most of them in a 340px column. */}
            <div style={{ ...text.panelTitle(t), fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hotspot.locName}
            </div>
            <div style={{ ...text.metaChip(t), marginTop: 2 }}>
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
              ...text.control(t), fontSize: 11,
              color: t.accent, textDecoration: 'none',
            }}
          >
            <NavigationIcon size={11} />
            Directions
          </a>
          {/* ✕, not the ← this used to be. A back arrow implied a stack to pop
              inside the sidebar; this panel sits over the map and there is
              nothing behind it to go back to. Matches SpeciesDetailPanel. */}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: `1px solid ${t.line2}`,
              borderRadius: 6, color: t.fg2, cursor: 'pointer',
              padding: 6, display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {/* Section label */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px', background: t.bg2, borderBottom: `1px solid ${t.line1}`,
        flexShrink: 0,
      }}>
        <span style={text.sectionLabel(t)}>
          Recent Species (14 days)
        </span>
        {/* fg3 via the role, not t.accent. AlertsPanel's section counts are
            fg3 unless the section has a tier dot to borrow a colour from
            (AlertsPanel.tsx SectionHeader); this one has no dot. */}
        {!loading && !error && (
          <span style={text.sectionCount(t)}>{obs.length}</span>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ ...text.emptyState(t), padding: 28, textAlign: 'center' }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ ...text.emptyState(t), padding: 24, textAlign: 'center', color: '#EF4444' }}>
            Failed to load observations.
          </div>
        )}
        {!loading && !error && obs.length === 0 && (
          <div style={{ ...text.emptyState(t), padding: 24, textAlign: 'center' }}>
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
                {/* Was weight 500 while AlertsPanel's identical row was 600.
                    Space Grotesk is a variable font, so both weights are real
                    and the gap reads as two different typefaces at 13px — the
                    reported symptom. The role owns the weight now. */}
                <div style={{ ...text.rowTitle(t), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.comName}
                </div>
                <div style={{ ...text.rowSub(t), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.sciName}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <span style={text.metaChip(t)}>{timeAgo(o.obsDt)}</span>
                {o.howMany && <span style={{ ...text.metaChip(t), fontSize: 10 }}>×{o.howMany}</span>}
                {!onList ? (
                  <button
                    onClick={() => onAddToLifeList(o.speciesCode, o.comName, o.sciName)}
                    onMouseEnter={() => setHoveredAddCode(o.speciesCode)}
                    onMouseLeave={() => setHoveredAddCode(null)}
                    style={{
                      ...text.actionPill(t), padding: '3px 8px',
                      background: hoveredAddCode === o.speciesCode ? t.accentBorder : t.accentBg,
                      border: `1px solid ${t.accentBorder}`,
                      color: t.accent, cursor: 'pointer',
                      transition: 'background 0.12s',
                    }}>+ Add</button>
                ) : (
                  <span style={{ ...text.metaChip(t), fontSize: 10, color: t.lifer, display: 'flex', alignItems: 'center', gap: 3 }}>
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

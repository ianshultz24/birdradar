'use client';

import { memo, useCallback, useEffect, useState } from 'react';

import {
  LEGEND_GLYPH_SLOT,
  LEGEND_SECTION_LABELS,
  legendRows,
  sightingGlyph,
  type LegendRow,
  type LegendSection,
  type MarkerGlyph,
} from '@/lib/marker-style';
import type { Theme } from '@/lib/theme';
import { ChevronDownIcon, ChevronRightIcon } from '@/components/Icons';

/**
 * Marker legend — an always-visible chip on the map that expands into the full
 * key.
 *
 * It used to live in Settings → Marker Legend, three taps from the map, drawing
 * its own copies of the marker SVGs. Both problems are fixed here: the chip is
 * on the map, and every swatch comes from `lib/marker-style.ts`, the same module
 * that produces the real icons. Settings now renders these same rows.
 *
 * ─── Why this component owns its open state ──────────────────────────────────
 *
 * Same reason `MapControls` owns its hover state (see the comment above it in
 * Map.tsx): if `open` lived in `BirdMap`, expanding the legend would re-render
 * every one of ~400 markers. The props below are primitives plus `theme`, which
 * `getTheme()` returns as a module-level singleton — so `memo` actually holds.
 *
 * It also renders as a **sibling of `<MapContainer>`**, not inside it, so Leaflet
 * never sees its clicks or wheel events and no `stopPropagation` plumbing is
 * needed.
 */

interface Props {
  theme: Theme;
  lightMode: boolean;
  isMobile: boolean;
  /** Low battery / reduced motion — drops blur and transitions, as MapControls does. */
  lowFi: boolean;
  /** Species detail panel is open. On mobile its sheet covers this corner. */
  detailOpen: boolean;
  /** Mirrors `settings.liferPulse` — the "pulse" badges are a lie when it's off. */
  pulseEnabled: boolean;
}

export default memo(function MapLegend({
  theme: t,
  lightMode,
  isMobile,
  lowFi,
  detailOpen,
  pulseEnabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // The mobile detail sheet covers this corner entirely; leaving the chip mounted
  // underneath just leaves a tab stop nobody can see.
  if (isMobile && detailOpen) return null;

  const rows = legendRows(lightMode);
  const sections: LegendSection[] = ['sightings', 'locations', 'map'];

  return (
    <div
      style={{
        position: 'absolute',
        // Matches MapControls, which clears the mobile tab bar at the same offset.
        bottom: isMobile ? 86 : 30,
        left: 10,
        zIndex: 1001,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 6,
        fontFamily: t.sans,
      }}
    >
      {open && (
        <div
          id="marker-legend-panel"
          role="group"
          aria-label="Marker legend"
          style={{
            // Capped so the expanded card stays a chip rather than a panel — a
            // legend that fills the map is competing with the map. (This cap was
            // originally justified as keeping clear of Leaflet's corner
            // attribution; that control is gone as of PhaseC_fixes and the credits
            // now live in Settings → Credits, so the reason is plain layout.)
            width: isMobile ? 'min(78vw, 268px)' : 268,
            maxHeight: isMobile ? '48vh' : 420,
            overflowY: 'auto',
            background: t.cardBg,
            border: `1px solid ${t.line2}`,
            borderRadius: 10,
            boxShadow: t.shadowLg,
            backdropFilter: lowFi ? undefined : 'blur(8px)',
            padding: '10px 12px 12px',
          }}
        >
          {sections.map((section) => {
            const inSection = rows.filter((r) => r.section === section);
            if (inSection.length === 0) return null;
            return (
              <div key={section} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    fontFamily: t.mono,
                    color: t.fg3,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}
                >
                  {LEGEND_SECTION_LABELS[section]}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {inSection.map((row) => (
                    <LegendEntry key={row.id} row={row} t={t} pulseEnabled={pulseEnabled} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="marker-legend-panel"
        title={open ? 'Hide marker legend' : 'Show marker legend'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '6px 10px 6px 8px',
          borderRadius: 8,
          background: t.cardBg,
          border: `1px solid ${t.line2}`,
          color: t.fg1,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: t.sans,
          cursor: 'pointer',
          boxShadow: t.shadowLg,
          backdropFilter: lowFi ? undefined : 'blur(8px)',
        }}
      >
        <ChipPreview lightMode={lightMode} />
        Legend
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </button>
    </div>
  );
});

// ─── Rows ─────────────────────────────────────────────────────────────────────

/** Exported so Settings → Marker Legend renders the identical row, not a copy. */
export function LegendEntry({ row, t, pulseEnabled }: { row: LegendRow; t: Theme; pulseEnabled: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <MarkerSwatch glyph={row.glyph} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: t.fg1, fontWeight: 500, lineHeight: 1.25 }}>
          {row.label}
        </div>
        {row.detail && (
          <div style={{ fontSize: 10.5, color: t.fg3, lineHeight: 1.3, marginTop: 1 }}>
            {row.detail}
          </div>
        )}
      </div>
      {row.pulse && pulseEnabled && (
        <span
          style={{
            fontSize: 9,
            fontFamily: t.mono,
            color: t.accent,
            background: t.accentBg,
            border: `1px solid ${t.accentBorder}`,
            borderRadius: 4,
            padding: '1px 5px',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          pulse
        </span>
      )}
    </div>
  );
}

/**
 * A swatch is the marker, at its real size.
 *
 * Rendered in a fixed-width gutter so the labels line up, but *not* scaled to a
 * uniform size — the tier size ladder is one of the two cues that survive a
 * colour-vision deficiency, so flattening it here would make the legend
 * contradict the map.
 *
 * `dangerouslySetInnerHTML` is safe: the markup is generated entirely from
 * constants in lib/marker-style.ts and no user or API data reaches it. It is the
 * same string Leaflet gets, which is the point — the swatch cannot drift from
 * the icon.
 */
export function MarkerSwatch({ glyph }: { glyph: MarkerGlyph }) {
  return (
    <span
      style={{
        width: LEGEND_GLYPH_SLOT,
        height: LEGEND_GLYPH_SLOT,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width={glyph.box}
        height={glyph.box}
        viewBox={`0 0 ${glyph.box} ${glyph.box}`}
        style={{ overflow: 'visible', display: 'block' }}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: glyph.svg }}
      />
    </span>
  );
}

/** Three shrunk tier dots on the collapsed chip — enough to read as "colour key". */
function ChipPreview({ lightMode }: { lightMode: boolean }) {
  const tiers = ['lifer-rare', 'lifer', 'seen'] as const;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      {tiers.map((tier) => {
        const glyph = sightingGlyph(tier, { lightMode, focused: false, isPrivate: false });
        return (
          <svg
            key={tier}
            width={11}
            height={11}
            viewBox={`0 0 ${glyph.box} ${glyph.box}`}
            style={{ display: 'block' }}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: glyph.svg }}
          />
        );
      })}
    </span>
  );
}

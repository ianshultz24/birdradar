import type { PriorityTier } from './ebird';

/**
 * Marker artwork — the single definition of what every map marker looks like.
 *
 * Phase C. Previously the artwork lived as HTML strings inside components/Map.tsx
 * and the Settings legend redrew it by hand from copied SVG paths and hex codes.
 * They had already drifted (the legend showed light-mode greens in dark mode and
 * had no entry for the drop-pin or the user dot). One definition, three consumers:
 *
 *   lib/marker-style.ts ──┬──► components/Map.tsx        (L.divIcon html)
 *                         ├──► components/MapLegend.tsx  (map chip)
 *                         └──► components/SettingsPanel  (Settings → Marker Legend)
 *
 * Glyphs are emitted as **SVG markup strings**, not React elements. Leaflet needs a
 * string for `L.divIcon({ html })`, and going the other way — authoring React and
 * serialising it — would drag `react-dom/server` into the client bundle. The legend
 * feeds the same string to `dangerouslySetInnerHTML`, which is safe here because
 * every byte of it is generated from the constants in this file; no user or API
 * data reaches it.
 *
 * ─── The taxonomy ───────────────────────────────────────────────────────────
 *
 * Four marker *kinds*, each a different shape, identifiable without colour:
 *
 *   sighting   ● circle      (tier by size + ring style)
 *   hotspot    ◇ diamond outline
 *   pin search ⊕ crosshair
 *   user       ● blue dot + accuracy halo (the halo is a Leaflet Circle, not a glyph)
 *
 * Within sightings, colour is the *last* cue and never the only one. `lifer-rare`
 * and `rare` are both red — deliberately, red means "eBird notable" — so they are
 * separated by size and by ring style instead:
 *
 *   lifer-rare  ◎  18px  disc + core + separate outer ring   (two concentric marks)
 *   lifer       ◉  16px  disc + core                          (one donut)
 *   rare        ◌  14px  dashed hollow ring                   (no fill)
 *   seen        ·  10px  flat disc                            (no ring, no core)
 */

// ─── Colors ───────────────────────────────────────────────────────────────────
// Moved verbatim from components/Map.tsx. CSS variables can't be used inside a
// divIcon html string, so these stay as literals.

export const TIER_COLORS_LIGHT = {
  'lifer-rare': '#DC2626',  // red — lifer + eBird notable (highest urgency)
  'lifer':      '#059669',  // green — new species
  'rare':       '#DC2626',  // red — eBird notable, already seen
  'seen':       '#9CA3AF',  // gray — previously seen
} as const;

export const TIER_COLORS_DARK = {
  'lifer-rare': '#F87171',  // red
  'lifer':      '#34D399',  // green
  'rare':       '#F87171',  // red
  'seen':       '#71717A',  // gray
} as const;

// Per-tier glow colors injected as CSS variables into the DivIcon HTML
const TIER_GLOW_LO_LIGHT: Record<string, string> = {
  'lifer-rare': '0 2px 4px rgba(220,38,38,0.28)',
  'lifer':      '0 2px 4px rgba(5,150,105,0.28)',
  'rare':       '0 2px 4px rgba(220,38,38,0.22)',
  'seen':       '0 2px 3px rgba(0,0,0,0)',
};
const TIER_GLOW_HI_LIGHT: Record<string, string> = {
  'lifer-rare': '0 4px 10px rgba(220,38,38,0.50)',
  'lifer':      '0 4px 10px rgba(5,150,105,0.50)',
  'rare':       '0 4px 10px rgba(220,38,38,0.40)',
  'seen':       '0 4px 8px rgba(0,0,0,0)',
};
const TIER_GLOW_LO_DARK: Record<string, string> = {
  'lifer-rare': '0 2px 4px rgba(248,113,113,0.35)',
  'lifer':      '0 2px 4px rgba(52,211,153,0.35)',
  'rare':       '0 2px 4px rgba(248,113,113,0.28)',
  'seen':       '0 2px 3px rgba(0,0,0,0)',
};
const TIER_GLOW_HI_DARK: Record<string, string> = {
  'lifer-rare': '0 4px 12px rgba(248,113,113,0.55)',
  'lifer':      '0 4px 12px rgba(52,211,153,0.55)',
  'rare':       '0 4px 12px rgba(248,113,113,0.46)',
  'seen':       '0 4px 8px rgba(0,0,0,0)',
};

export const PIN_SEARCH_COLOR = '#F59E0B';
export const USER_DOT_COLOR = '#3b82f6';

type TierKey = keyof typeof TIER_COLORS_LIGHT;

export function tierMarkerColor(tier: PriorityTier | string, lightMode: boolean): string {
  const table = lightMode ? TIER_COLORS_LIGHT : TIER_COLORS_DARK;
  return table[tier as TierKey] ?? table.seen;
}

// ─── Hotspot heat gradient ────────────────────────────────────────────────────

function lerpColor(a: string, b: string, t: number): string {
  const ah = a.replace('#', '');
  const bh = b.replace('#', '');
  const ar = parseInt(ah.slice(0, 2), 16);
  const ag = parseInt(ah.slice(2, 4), 16);
  const ab = parseInt(ah.slice(4, 6), 16);
  const br = parseInt(bh.slice(0, 2), 16);
  const bg = parseInt(bh.slice(2, 4), 16);
  const bb = parseInt(bh.slice(4, 6), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

export function hotspotHeatColor(ratio: number): string {
  if (ratio < 0.33) return lerpColor('#556677', '#f5a623', ratio / 0.33);
  if (ratio < 0.66) return lerpColor('#f5a623', '#ff7043', (ratio - 0.33) / 0.33);
  return lerpColor('#ff7043', '#ef4444', (ratio - 0.66) / 0.34);
}

// ─── Glyphs ───────────────────────────────────────────────────────────────────

export interface MarkerGlyph {
  /**
   * Width and height of the square icon box, in px. Doubles as the SVG viewBox
   * extent, as `iconSize`, and — halved — as `iconAnchor`.
   *
   * Every marker in this file is **centre-anchored**: the observation's latlng
   * sits at the middle of the box, not at a pin tip. `useTooltipEdgeFlip()` in
   * Map.tsx derives its offsets from `iconSize`/`iconAnchor`, so a glyph only
   * has to report an honest box and its tooltip spacing follows.
   */
  box: number;
  /** Inner markup for an `<svg viewBox="0 0 box box">` root. */
  svg: string;
}

/** Visual diameter of the sighting disc, per tier. The size ladder is a cue in
 *  its own right — it survives any colour-vision deficiency. */
const SIGHTING_DOT: Record<string, number> = {
  'lifer-rare': 18,
  'lifer':      16,
  'rare':       14,
  'seen':       10,
};

/** How far the tier's core artwork reaches from the centre, before the optional
 *  focus and private rings are added. `lifer-rare` carries a detached outer ring. */
function coreExtent(tier: string): number {
  const r = (SIGHTING_DOT[tier] ?? SIGHTING_DOT.seen) / 2;
  return tier === 'lifer-rare' ? r + 3.2 : r;
}

/** Radius of the dotted "approximate location" ring, when one is drawn. */
function privateRingRadius(tier: string): number {
  return coreExtent(tier) + 2.5;
}

/**
 * Box size for a sighting glyph.
 *
 * Depends on tier and privacy but deliberately **not** on `focused`: the focus
 * ring is allowed to overflow (every marker SVG sets `overflow="visible"`), so
 * focusing a species in the sidebar doesn't resize hundreds of marker boxes —
 * and, because the tooltip offsets are derived from the box, doesn't make the
 * tooltip gap twitch as focus moves.
 */
export function sightingBox(tier: PriorityTier | string, isPrivate: boolean): number {
  const extent = isPrivate ? privateRingRadius(tier) + 0.65 : coreExtent(tier);
  return 2 * Math.ceil(extent + 1);
}

export interface SightingGlyphOptions {
  lightMode: boolean;
  focused: boolean;
  isPrivate: boolean;
}

export function sightingGlyph(
  tier: PriorityTier | string,
  { lightMode, focused, isPrivate }: SightingGlyphOptions,
): MarkerGlyph {
  const color = tierMarkerColor(tier, lightMode);
  const coreBg = lightMode ? '#FFFFFF' : '#111113';
  const box = sightingBox(tier, isPrivate);
  const c = box / 2;
  const r = (SIGHTING_DOT[tier] ?? SIGHTING_DOT.seen) / 2;

  let body: string;
  switch (tier) {
    case 'lifer-rare':
      // Two concentric marks: a filled disc with a core, plus a detached ring.
      body =
        `<circle cx="${c}" cy="${c}" r="${r + 2.3}" fill="none" stroke="${color}" stroke-width="1.8" opacity="0.9"/>` +
        `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}" opacity="0.95"/>` +
        `<circle cx="${c}" cy="${c}" r="${r * 0.36}" fill="${coreBg}" opacity="0.92"/>`;
      break;
    case 'lifer':
      // One donut.
      body =
        `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}" opacity="0.92"/>` +
        `<circle cx="${c}" cy="${c}" r="${r * 0.36}" fill="${coreBg}" opacity="0.92"/>`;
      break;
    case 'rare':
      // Hollow and dashed — reads as "notable, but you've already got it".
      body =
        `<circle cx="${c}" cy="${c}" r="${r - 1}" fill="${color}" fill-opacity="0.14"` +
        ` stroke="${color}" stroke-width="2" stroke-dasharray="3 2.6" stroke-linecap="round" opacity="0.95"/>`;
      break;
    default:
      // Flat dot. No ring, no core — the quietest thing on the map.
      body = `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}" opacity="0.8"/>`;
  }

  // Drawn outside the core artwork; allowed to overflow the box (see sightingBox).
  const focusRing = focused
    ? `<circle cx="${c}" cy="${c}" r="${coreExtent(tier) + 2}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.45"/>`
    : '';

  // Dotted = "we don't know exactly where this is, and you can't navigate to it".
  const privateRing = isPrivate
    ? `<circle cx="${c}" cy="${c}" r="${privateRingRadius(tier)}" fill="none" stroke="${color}"` +
      ` stroke-width="1.3" stroke-dasharray="1.5 2.5" stroke-linecap="round" opacity="0.6"/>`
    : '';

  return { box, svg: `${privateRing}${focusRing}${body}` };
}

/** CSS custom properties carrying the pulse glow for a tier — consumed by
 *  `@keyframes pinRingPulse` in globals.css. */
export function pulseGlowVars(tier: PriorityTier | string, lightMode: boolean): string {
  const lo = (lightMode ? TIER_GLOW_LO_LIGHT : TIER_GLOW_LO_DARK)[tier] ??
    (lightMode ? TIER_GLOW_LO_LIGHT : TIER_GLOW_LO_DARK).seen;
  const hi = (lightMode ? TIER_GLOW_HI_LIGHT : TIER_GLOW_HI_DARK)[tier] ??
    (lightMode ? TIER_GLOW_HI_LIGHT : TIER_GLOW_HI_DARK).seen;
  return `--pin-glow-lo:${lo};--pin-glow-hi:${hi}`;
}

/** Only the two lifer tiers ever pulse — see Map.tsx `birdPinIcon`. */
export function tierCanPulse(tier: PriorityTier | string): boolean {
  return tier === 'lifer-rare' || tier === 'lifer';
}

// ─── Hotspot: diamond outline ─────────────────────────────────────────────────
// A different *shape*, not a different colour, so it can never be mistaken for a
// sighting at a glance — which was the whole complaint about the old 10px dot.

const HOTSPOT_BOX = 18;
const HOTSPOT_HALF = 6;

export function hotspotGlyph(heatColor: string): MarkerGlyph {
  const c = HOTSPOT_BOX / 2;
  const h = HOTSPOT_HALF;
  const path = `M ${c} ${c - h} L ${c + h} ${c} L ${c} ${c + h} L ${c - h} ${c} Z`;
  return {
    box: HOTSPOT_BOX,
    svg:
      // White under-stroke keeps the outline legible over dark tiles and over
      // the heat gradient's own mid-tones.
      `<path d="${path}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="3.4" stroke-linejoin="round"/>` +
      `<path d="${path}" fill="${heatColor}" fill-opacity="0.22" stroke="${heatColor}" stroke-width="1.9" stroke-linejoin="round"/>`,
  };
}

// ─── Custom Pin Search: crosshair ─────────────────────────────────────────────

const PIN_SEARCH_BOX = 30;

export function pinSearchGlyph(): MarkerGlyph {
  const c = PIN_SEARCH_BOX / 2;
  const r = 9.5;
  const tick = 4;
  const ticks = [
    `M ${c} ${c - r - tick} L ${c} ${c - r + tick}`,
    `M ${c} ${c + r - tick} L ${c} ${c + r + tick}`,
    `M ${c - r - tick} ${c} L ${c - r + tick} ${c}`,
    `M ${c + r - tick} ${c} L ${c + r + tick} ${c}`,
  ].join(' ');
  return {
    box: PIN_SEARCH_BOX,
    svg:
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="4.5"/>` +
      `<path d="${ticks}" stroke="rgba(255,255,255,0.6)" stroke-width="4.5" stroke-linecap="round"/>` +
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${PIN_SEARCH_COLOR}" stroke-width="2.2"/>` +
      `<path d="${ticks}" stroke="${PIN_SEARCH_COLOR}" stroke-width="2.2" stroke-linecap="round"/>` +
      `<circle cx="${c}" cy="${c}" r="2.6" fill="${PIN_SEARCH_COLOR}"/>`,
  };
}

// ─── User location: blue dot ──────────────────────────────────────────────────
// The accuracy halo is a Leaflet <Circle> in ground units, not part of this glyph
// — a halo drawn in pixels would lie about accuracy at every zoom but one.

const USER_DOT_BOX = 20;

export function userDotGlyph(): MarkerGlyph {
  const c = USER_DOT_BOX / 2;
  return {
    box: USER_DOT_BOX,
    svg:
      `<circle cx="${c}" cy="${c}" r="8" fill="${USER_DOT_COLOR}" fill-opacity="0.22"/>` +
      `<circle cx="${c}" cy="${c}" r="5" fill="${USER_DOT_COLOR}" stroke="#ffffff" stroke-width="3"/>`,
  };
}

// ─── Legend rows ──────────────────────────────────────────────────────────────
// Consumed by both components/MapLegend.tsx and the Settings → Marker Legend
// group. Adding a marker kind means adding it here and nowhere else.

export type LegendSection = 'sightings' | 'locations' | 'map';

export interface LegendRow {
  id: string;
  section: LegendSection;
  label: string;
  /** Second line, when the glyph alone doesn't carry the meaning. */
  detail?: string;
  glyph: MarkerGlyph;
  /** Renders the "pulse" badge — matches `settings.liferPulse`. */
  pulse?: boolean;
}

export const LEGEND_SECTION_LABELS: Record<LegendSection, string> = {
  sightings: 'Sightings',
  locations: 'Location type',
  map: 'Map',
};

export function legendRows(lightMode: boolean): LegendRow[] {
  const g = (tier: PriorityTier, isPrivate = false) =>
    sightingGlyph(tier, { lightMode, focused: false, isPrivate });

  return [
    {
      id: 'lifer-rare',
      section: 'sightings',
      label: 'Lifer + Rare',
      detail: 'New species, flagged notable by eBird',
      glyph: g('lifer-rare'),
      pulse: true,
    },
    {
      id: 'lifer',
      section: 'sightings',
      label: 'Lifer',
      detail: 'New species for your list',
      glyph: g('lifer'),
      pulse: true,
    },
    {
      id: 'rare',
      section: 'sightings',
      label: 'Rare',
      detail: 'Notable, but already on your list',
      glyph: g('rare'),
    },
    {
      id: 'seen',
      section: 'sightings',
      label: 'Previously seen',
      glyph: g('seen'),
    },
    {
      id: 'private',
      section: 'locations',
      label: 'Personal location (approximate)',
      detail: 'Dotted ring · directions unavailable',
      glyph: g('lifer', true),
    },
    {
      id: 'hotspot',
      section: 'map',
      label: 'Hotspot',
      detail: 'Shaded by species count',
      glyph: hotspotGlyph(hotspotHeatColor(0.7)),
    },
    {
      id: 'pin-search',
      section: 'map',
      label: 'Custom search location',
      glyph: pinSearchGlyph(),
    },
    {
      id: 'user',
      section: 'map',
      label: 'You are here',
      detail: 'Shaded halo shows GPS accuracy',
      glyph: userDotGlyph(),
    },
  ];
}

/** Widest box any legend row can produce — lets the legend reserve one gutter
 *  width so the labels line up without measuring anything. */
export const LEGEND_GLYPH_SLOT = PIN_SEARCH_BOX;

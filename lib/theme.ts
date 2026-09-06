// Option B "Observatory" — clean productivity/finance + nature

import { driveTimeBand, type DriveTimeBand } from './drive-time';

export interface Theme {
  bg0: string; bg1: string; bg2: string; bg3: string;
  fg0: string; fg1: string; fg2: string; fg3: string; fg4: string;
  line1: string; line2: string; line3: string;
  accent: string; accentSoft: string; accentFg: string;
  accentBg: string; accentBorder: string;
  lifer: string; liferBg: string; liferBorder: string;
  rare: string; rareBg: string; rareBorder: string;
  seen: string; seenBg: string; seenBorder: string;
  target: string; targetBg: string; targetBorder: string;
  shadow: string; shadowLg: string;
  mapBg: string; cardBg: string;
  display: string; sans: string; mono: string;
}

const light: Theme = {
  bg0: '#F8F9FA', bg1: '#FFFFFF', bg2: '#F1F3F5', bg3: '#E9ECEF',
  fg0: '#111827', fg1: '#374151', fg2: '#6B7280', fg3: '#9CA3AF', fg4: '#D1D5DB',
  line1: '#F1F3F5', line2: '#E5E7EB', line3: '#D1D5DB',
  accent: '#1B4332', accentSoft: '#2D6A4F', accentFg: '#FFFFFF',
  accentBg: 'rgba(27,67,50,0.05)', accentBorder: 'rgba(27,67,50,0.14)',
  lifer: '#065F46', liferBg: 'rgba(6,95,70,0.06)', liferBorder: 'rgba(6,95,70,0.18)',
  rare: '#7C2D12', rareBg: 'rgba(124,45,18,0.06)', rareBorder: 'rgba(124,45,18,0.16)',
  seen: '#6B7280', seenBg: 'rgba(107,114,128,0.06)', seenBorder: 'rgba(107,114,128,0.12)',
  target: '#115E59', targetBg: 'rgba(17,94,89,0.05)', targetBorder: 'rgba(17,94,89,0.14)',
  shadow: '0 1px 2px rgba(0,0,0,0.06)',
  shadowLg: '0 4px 12px rgba(0,0,0,0.10)',
  mapBg: '#F1F3F5', cardBg: '#FFFFFF',
  display: "var(--font-display, 'Space Grotesk', sans-serif)",
  sans: "var(--font-dm-sans, 'Plus Jakarta Sans', sans-serif)",
  mono: "var(--font-jb-mono, 'IBM Plex Mono', monospace)",
};

const dark: Theme = {
  bg0: '#09090B', bg1: '#111113', bg2: '#18181B', bg3: '#27272A',
  fg0: '#FAFAFA', fg1: '#D4D4D8', fg2: '#A1A1AA', fg3: '#71717A', fg4: '#3F3F46',
  line1: '#18181B', line2: '#27272A', line3: '#3F3F46',
  accent: '#74C69D', accentSoft: '#52B788', accentFg: '#09090B',
  accentBg: 'rgba(116,198,157,0.08)', accentBorder: 'rgba(116,198,157,0.20)',
  lifer: '#6EE7B7', liferBg: 'rgba(110,231,183,0.07)', liferBorder: 'rgba(110,231,183,0.18)',
  rare: '#FCA560', rareBg: 'rgba(252,165,96,0.07)', rareBorder: 'rgba(252,165,96,0.16)',
  seen: '#71717A', seenBg: 'rgba(113,113,122,0.07)', seenBorder: 'rgba(113,113,122,0.12)',
  target: '#5EEAD4', targetBg: 'rgba(94,234,212,0.06)', targetBorder: 'rgba(94,234,212,0.16)',
  shadow: '0 1px 2px rgba(0,0,0,0.35)',
  shadowLg: '0 4px 16px rgba(0,0,0,0.50)',
  mapBg: '#0C0C0E', cardBg: '#111113',
  display: "var(--font-display, 'Space Grotesk', sans-serif)",
  sans: "var(--font-dm-sans, 'Plus Jakarta Sans', sans-serif)",
  mono: "var(--font-jb-mono, 'IBM Plex Mono', monospace)",
};

export function getTheme(lightMode: boolean): Theme {
  return lightMode ? light : dark;
}

// ─── Typography roles ─────────────────────────────────────────────────────────
// `display` / `sans` / `mono` above are *fonts*, not decisions. Before this layer
// existed, every text node in the app picked one by hand — 161 inline
// `fontFamily:` assignments across 15 components, each also hard-coding a size, a
// weight and sometimes a tracking value. Nothing kept two panels agreeing, and
// they stopped agreeing: the same species name rendered at weight 600 in
// AlertsPanel and 500 in HotspotPanel and LifeListPanel, and LifeListPanel set a
// prose date-and-place string in monospace. Both read as "a different font".
//
// A role is the decision. Spread it and override only what genuinely differs at
// the call site:
//
//   <div style={{ ...text.rowTitle(t), overflow: 'hidden' }}>
//   <div style={{ ...text.panelTitle(t), fontSize: 14 }}>
//
// Named `text`, not `type`: `import { type } from './theme'` sits one character
// away from TypeScript's `import { type Foo }` type-only modifier, and that is
// not a thing to leave lying around in a file every component imports.
//
// Every value below is lifted from AlertsPanel or Sidebar *as they rendered
// before this layer was added*, because that is the look the user asked every
// other panel to match. **If AlertsPanel's appearance is ever intentionally
// changed, these values must be re-derived from it** — otherwise the reference
// and the roles disagree and the drift starts again from the other end.
//
// ── On the mono weights ──
// app/layout.tsx:25-30 loads IBM Plex Mono with a *discrete* weight set,
// ['400','500','700']. CSS font matching resolves a requested 600 upward to 700,
// so every `fontWeight: 600` written on `t.mono` in this codebase has always
// rendered as 700. The roles below say 700 so the source matches the screen; this
// is a zero-pixel change. Do not "restore" 600, and do not add '600' to the font
// load to make it real — that would make every mono chip in the app lighter than
// it is today.
//
// Space Grotesk (layout.tsx:10-14) and Plus Jakarta Sans (:18-22) load with no
// weight array, so they are full variable ranges and their 500/600/700 are all
// genuine. That asymmetry is why the display-weight drift was visible and the
// mono-weight one never was.

export const text = {
  /** Right-hand panel headline — a species name at the top of a detail panel. */
  panelTitle: (t: Theme) => ({
    fontFamily: t.display, fontSize: 17, fontWeight: 700,
    letterSpacing: '-0.02em', lineHeight: 1.2, color: t.fg0,
  }),

  /** The name on a list row. The single most-repeated element in the app. */
  rowTitle: (t: Theme) => ({
    fontFamily: t.display, fontSize: 13, fontWeight: 600, color: t.fg0,
  }),

  /** Line 2 of a list row when it is a scientific name. */
  rowSub: (t: Theme) => ({
    fontFamily: t.sans, fontSize: 11.5, fontWeight: 400,
    fontStyle: 'italic' as const, color: t.fg2,
  }),

  /** Line 2 of a list row when it is prose — a place, a date, a sentence. */
  rowMeta: (t: Theme) => ({
    fontFamily: t.sans, fontSize: 11.5, fontWeight: 400, color: t.fg2,
  }),

  /** Heading inside a bordered card, e.g. the location block. */
  cardTitle: (t: Theme) => ({
    fontFamily: t.sans, fontSize: 12.5, fontWeight: 600,
    lineHeight: 1.35, color: t.fg1,
  }),

  /** Sticky section divider label — "Lifer Opportunities", "Recent Species". */
  sectionLabel: (t: Theme) => ({
    fontFamily: t.sans, fontSize: 11, fontWeight: 600,
    letterSpacing: '0.03em', color: t.fg1,
  }),

  /** The count on the right of a section divider. */
  sectionCount: (t: Theme) => ({
    fontFamily: t.mono, fontSize: 11, fontWeight: 700, color: t.fg3,
  }),

  /** Short numeric readout in a meta row — a distance, a time, a ×count. */
  metaChip: (t: Theme) => ({
    fontFamily: t.mono, fontSize: 10.5, fontWeight: 400, color: t.fg3,
  }),

  /** Bordered numeric/action chip — the odds chip, the "+ Add" button. */
  actionPill: (t: Theme) => ({
    fontFamily: t.mono, fontSize: 10, fontWeight: 700,
    borderRadius: 4, padding: '1px 5px',
  }),

  /** Tier badge — LIFER / RARE / SEEN. Colours come from tierTokens(). */
  tierPill: (t: Theme) => ({
    fontFamily: t.mono, fontSize: 9.5, fontWeight: 700,
    letterSpacing: '0.02em', borderRadius: 4, padding: '2px 6px',
  }),

  /**
   * All-caps micro label, e.g. SIGHTING ODDS. The caps are written into the
   * string rather than applied with textTransform — see the note on statLabel.
   */
  microCaps: (t: Theme) => ({
    fontFamily: t.mono, fontSize: 9.5, fontWeight: 700,
    letterSpacing: '0.06em', color: t.fg3,
  }),

  /** Centred explanatory line under a control, e.g. "Newest sightings first". */
  caption: (t: Theme) => ({
    fontFamily: t.mono, fontSize: 10.5, fontWeight: 400,
    color: t.fg3, lineHeight: 1.4,
  }),

  /**
   * Label above a big number in a stat tile. This is the one place
   * `textTransform: 'uppercase'` is correct, because the label is data-driven
   * ("Year New" / "Lifers") and cannot be pre-capitalised in the string.
   */
  statLabel: (t: Theme) => ({
    fontFamily: t.mono, fontSize: 10, fontWeight: 400,
    letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: t.fg3,
  }),

  /** The big number in a stat tile. Colour is set by the call site. */
  statValue: (t: Theme) => ({
    fontFamily: t.display, fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em',
  }),

  /** Body copy and text inputs. */
  body: (t: Theme) => ({
    fontFamily: t.sans, fontSize: 13, fontWeight: 400, color: t.fg1,
  }),

  /**
   * Button and link labels. Does NOT set fontWeight where the weight carries a
   * state signal — the sort pills and tab bars keep their own
   * `fontWeight: active ? 600 : 400`.
   */
  control: (t: Theme) => ({
    fontFamily: t.sans, fontSize: 12, fontWeight: 600,
  }),

  /** "No recent observations found.", "Loading…", and friends. */
  emptyState: (t: Theme) => ({
    fontFamily: t.sans, fontSize: 12, fontWeight: 400,
    fontStyle: 'italic' as const, color: t.fg3,
  }),
};

export function tierTokens(tier: string, t: Theme) {
  if (tier === 'lifer') return { color: t.lifer, bg: t.liferBg, border: t.liferBorder };
  if (tier === 'lifer-rare' || tier === 'rare') return { color: t.rare, bg: t.rareBg, border: t.rareBorder };
  return { color: t.seen, bg: t.seenBg, border: t.seenBorder };
}

// ─── Sighting-odds presentation ───────────────────────────────────────────────
// A 0–100 chaseability score is shown to birders as a plain-language likelihood.
// The label is the primary signal; the percent is secondary.

export function oddsLabel(score: number): string {
  if (score >= 90) return 'Almost Certain';
  if (score >= 70) return 'Very Likely';
  if (score >= 40) return 'Likely';
  if (score >= 15) return 'Possible';
  if (score >= 5) return 'Unlikely';
  return 'Very Rare';
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const lerp = (a: number, b: number, f: number) => Math.round(a + (b - a) * f);

/**
 * Continuous color for an odds score: a true-green → gold → gray gradient.
 * High odds = green ("go"), mid = gold ("maybe"), low = gray ("don't bother").
 * `color` is text-legible; `bg`/`border` are soft tints, matching tierTokens()'s shape.
 */
export function oddsColor(score: number, lightMode: boolean): { color: string; bg: string; border: string } {
  const s = Math.max(0, Math.min(100, score)) / 100;
  const anchors = lightMode
    ? { high: '#15803D', mid: '#CA8A04', low: '#9CA3AF' }
    : { high: '#4ADE80', mid: '#FACC15', low: '#71717A' };
  const [hr, hg, hb] = hexToRgb(anchors.high);
  const [mr, mg, mb] = hexToRgb(anchors.mid);
  const [lr, lg, lb] = hexToRgb(anchors.low);
  let r: number, g: number, b: number;
  if (s >= 0.5) {
    const f = (s - 0.5) / 0.5; // gold → green
    r = lerp(mr, hr, f); g = lerp(mg, hg, f); b = lerp(mb, hb, f);
  } else {
    const f = s / 0.5; // gray → gold
    r = lerp(lr, mr, f); g = lerp(lg, mg, f); b = lerp(lb, mb, f);
  }
  return {
    color: `rgb(${r}, ${g}, ${b})`,
    bg: `rgba(${r}, ${g}, ${b}, 0.10)`,
    border: `rgba(${r}, ${g}, ${b}, 0.22)`,
  };
}

// ─── Drive-time presentation ──────────────────────────────────────────────────
// A deliberately separate palette from both of the above. Two reasons, and both
// are the kind of thing that gets "tidied" away:
//
//   1. Not oddsColor(). That is a continuous green→gold→gray ramp encoding
//      *likelihood*. Drive time is a different quantity on a different scale;
//      sharing a colour language would make the detail panel unreadable, since
//      the two sit inches apart.
//   2. Not tierTokens(). PhaseC_rationale.md §11 records that red there encodes
//      "eBird notable" and is load-bearing. A red drive-time badge must read as a
//      different kind of object: it lives in the meta row with a car glyph, never
//      in the tier-badge position.
//
// Bands come from driveTimeBand() in lib/drive-time.ts, which owns the
// thresholds. This function owns only the colours.

const driveTimeLight: Record<DriveTimeBand, string> = {
  green: '#15803D',
  yellow: '#A16207',
  orange: '#C2410C',
  red: '#B91C1C',
};

const driveTimeDark: Record<DriveTimeBand, string> = {
  green: '#4ADE80',
  yellow: '#FACC15',
  orange: '#FB923C',
  red: '#F87171',
};

/** `{ color, bg, border }`, matching the shape of tierTokens() and oddsColor(). */
export function driveTimeTokens(
  seconds: number,
  lightMode: boolean
): { color: string; bg: string; border: string } {
  const hex = (lightMode ? driveTimeLight : driveTimeDark)[driveTimeBand(seconds)];
  const [r, g, b] = hexToRgb(hex);
  return {
    color: hex,
    bg: `rgba(${r}, ${g}, ${b}, 0.10)`,
    border: `rgba(${r}, ${g}, ${b}, 0.22)`,
  };
}

export function tierLabel(tier: string, yearListActive = false): string {
  if (yearListActive) {
    if (tier === 'lifer-rare') return 'Year · Rare';
    if (tier === 'lifer') return 'Year New';
    if (tier === 'rare') return 'Rare';
    return 'Seen';
  }
  if (tier === 'lifer-rare') return 'Lifer · Rare';
  if (tier === 'lifer') return 'Lifer';
  if (tier === 'rare') return 'Rare';
  return 'Seen';
}

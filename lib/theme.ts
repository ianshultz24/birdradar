// Option B "Observatory" — clean productivity/finance + nature

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

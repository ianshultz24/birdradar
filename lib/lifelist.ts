import type { AppSettings } from './ebird';
import { DEFAULT_SETTINGS } from './ebird';

const LIFELIST_KEY = 'birdradar_lifelist';
const YEARLIST_KEY = 'birdradar_yearlist';
const META_KEY = 'birdradar_lifelist_meta';
const SETTINGS_KEY = 'birdradar_settings';

export interface SpeciesMeta {
  comName: string;
  sciName: string;
  firstDate: string;      // YYYY-MM-DD
  firstLocation: string;
  totalCount: number;     // number of checklists containing this species
}

export function getLifeList(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(LIFELIST_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveLifeList(list: string[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LIFELIST_KEY, JSON.stringify(list));
}

export function addToLifeList(current: string[], speciesCode: string): string[] {
  if (current.includes(speciesCode)) return current;
  const next = [...current, speciesCode];
  saveLifeList(next);
  return next;
}

export function removeFromLifeList(current: string[], speciesCode: string): string[] {
  const next = current.filter((c) => c !== speciesCode);
  saveLifeList(next);
  return next;
}

export function bulkAddToLifeList(current: string[], codes: string[]): string[] {
  const existing = new Set(current);
  const next = [...current, ...codes.filter((c) => !existing.has(c))];
  saveLifeList(next);
  return next;
}

export function clearLifeList(): void {
  saveLifeList([]);
  saveLifeListMeta({});
}

// ─── Year List ───────────────────────────────────────────────────────────────

export function getYearList(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(YEARLIST_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveYearList(list: string[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(YEARLIST_KEY, JSON.stringify(list));
}

export function addToYearList(current: string[], speciesCode: string): string[] {
  if (current.includes(speciesCode)) return current;
  const next = [...current, speciesCode];
  saveYearList(next);
  return next;
}

export function removeFromYearList(current: string[], speciesCode: string): string[] {
  const next = current.filter((c) => c !== speciesCode);
  saveYearList(next);
  return next;
}

export function bulkAddToYearList(current: string[], codes: string[]): string[] {
  const existing = new Set(current);
  const next = [...current, ...codes.filter((c) => !existing.has(c))];
  saveYearList(next);
  return next;
}

export function clearYearList(): void {
  saveYearList([]);
}

// ─── Metadata ────────────────────────────────────────────────────────────────

export function getLifeListMeta(): Record<string, SpeciesMeta> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(META_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function saveLifeListMeta(meta: Record<string, SpeciesMeta>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function getSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

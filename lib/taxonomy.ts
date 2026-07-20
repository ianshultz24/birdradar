import type { SpeciesMeta } from './lifelist';
import { getLifeList, saveLifeList, getYearList, saveYearList, getLifeListMeta, saveLifeListMeta } from './lifelist';

/**
 * Full eBird species taxonomy (~11k species), lazily fetched from
 * /api/ebird/taxonomy and cached in IndexedDB for 30 days. Nothing in the
 * startup path should await this — it loads on first search / import /
 * migration, then is effectively free.
 */

export interface SpeciesEntry {
  speciesCode: string;
  comName: string;
  sciName: string;
  /** Banding codes, e.g. ["AMRO"] for American Robin — birders search by these */
  bandingCodes?: string[];
}

const IDB_NAME = 'birdradar';
const IDB_STORE = 'kv';
const TAXONOMY_KEY = 'taxonomy-v1';
const TAXONOMY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Minimal IndexedDB key-value helpers ─────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined; // private browsing or blocked storage — degrade to network
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort cache; a failed write just means a refetch next session
  }
}

// ─── Taxonomy loading ────────────────────────────────────────────────────────

interface StoredTaxonomy {
  fetchedAt: number;
  entries: SpeciesEntry[];
}

let taxonomyPromise: Promise<SpeciesEntry[]> | null = null;

export function loadTaxonomy(): Promise<SpeciesEntry[]> {
  if (!taxonomyPromise) {
    taxonomyPromise = doLoadTaxonomy().catch((err) => {
      taxonomyPromise = null; // allow retry after a failed load
      throw err;
    });
  }
  return taxonomyPromise;
}

async function doLoadTaxonomy(): Promise<SpeciesEntry[]> {
  const stored = await idbGet<StoredTaxonomy>(TAXONOMY_KEY);
  if (stored && Array.isArray(stored.entries) && stored.entries.length > 0
      && Date.now() - stored.fetchedAt < TAXONOMY_MAX_AGE_MS) {
    return stored.entries;
  }

  const res = await fetch('/api/ebird/taxonomy');
  if (!res.ok) {
    // Network failed but an expired copy beats nothing
    if (stored && Array.isArray(stored.entries) && stored.entries.length > 0) return stored.entries;
    throw new Error(`Taxonomy fetch failed: ${res.status}`);
  }
  const entries: SpeciesEntry[] = await res.json();
  if (!Array.isArray(entries) || entries.length === 0) {
    if (stored && Array.isArray(stored.entries) && stored.entries.length > 0) return stored.entries;
    throw new Error('Empty taxonomy response');
  }

  void idbSet(TAXONOMY_KEY, { fetchedAt: Date.now(), entries } satisfies StoredTaxonomy);
  return entries;
}

// ─── Search ──────────────────────────────────────────────────────────────────

export function searchTaxonomy(entries: SpeciesEntry[], query: string, limit = 20): SpeciesEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qUpper = query.trim().toUpperCase();

  const prefix: SpeciesEntry[] = [];
  const contains: SpeciesEntry[] = [];

  for (const sp of entries) {
    const com = sp.comName.toLowerCase();
    // Banding code match ("AMRO" → American Robin) only kicks in for short
    // all-letter queries, where birders actually use codes
    if (qUpper.length >= 2 && qUpper.length <= 4 && /^[A-Z]+$/.test(qUpper)
        && sp.bandingCodes?.some((c) => c.startsWith(qUpper))) {
      prefix.push(sp);
    } else if (com.startsWith(q)) {
      prefix.push(sp);
    } else if (com.includes(q) || sp.sciName.toLowerCase().includes(q) || sp.speciesCode.toLowerCase().startsWith(q)) {
      contains.push(sp);
    }
    if (prefix.length >= limit) break;
  }

  return [...prefix, ...contains].slice(0, limit);
}

// ─── One-time stale-code migration ───────────────────────────────────────────

const MIGRATION_FLAG = 'birdradar_code_migration_v1';

/**
 * Earlier versions resolved CSV imports against a hardcoded PNW list whose
 * species codes could be stale (e.g. "bufhea" instead of "buffle"). Remap any
 * stored codes whose scientific name resolves to a different canonical code.
 * Runs once per device, then never again; call off the critical path.
 */
export async function migrateStaleCodesOnce(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem(MIGRATION_FLAG)) return false;
  } catch {
    return false;
  }

  const meta = getLifeListMeta();
  const hasAnyStoredData = getLifeList().length > 0 || Object.keys(meta).length > 0;
  if (!hasAnyStoredData) {
    // Nothing to migrate — set the flag without pulling the taxonomy
    try { localStorage.setItem(MIGRATION_FLAG, '1'); } catch { /* ignore */ }
    return false;
  }

  const entries = await loadTaxonomy();
  const bySciName = new Map<string, string>();
  for (const sp of entries) bySciName.set(sp.sciName.toLowerCase(), sp.speciesCode);
  const validCodes = new Set(entries.map((sp) => sp.speciesCode));

  const remap = new Map<string, string>();
  for (const [code, m] of Object.entries(meta)) {
    if (validCodes.has(code) || !m.sciName) continue;
    const correct = bySciName.get(m.sciName.toLowerCase());
    if (correct && correct !== code) remap.set(code, correct);
  }

  if (remap.size > 0) {
    const fix = (list: string[]) => {
      const next = list.map((c) => remap.get(c) ?? c);
      return Array.from(new Set(next));
    };
    saveLifeList(fix(getLifeList()));
    saveYearList(fix(getYearList()));

    const newMeta: Record<string, SpeciesMeta> = {};
    for (const [code, m] of Object.entries(meta)) {
      newMeta[remap.get(code) ?? code] = m;
    }
    saveLifeListMeta(newMeta);
  }

  try { localStorage.setItem(MIGRATION_FLAG, '1'); } catch { /* ignore */ }
  return remap.size > 0;
}

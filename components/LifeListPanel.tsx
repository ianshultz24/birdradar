'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClassifiedObservation } from '@/lib/ebird';
import { loadTaxonomy, searchTaxonomy, type SpeciesEntry } from '@/lib/taxonomy';
import type { SpeciesMeta } from '@/lib/lifelist';
import { getTheme } from '@/lib/theme';
import { SearchIcon, UploadIcon, DownloadIcon, XIcon, CheckIcon } from '@/components/Icons';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — larger files freeze the tab in the synchronous parse
const MAX_IMPORT_ENTRIES = 5_000; // caps localStorage growth from a hostile/corrupt backup file
const MAX_META_FIELD_LEN = 200;

function sanitizeImportCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 20)
    .slice(0, MAX_IMPORT_ENTRIES);
}

function sanitizeImportMeta(value: unknown): Record<string, SpeciesMeta> {
  const out: Record<string, SpeciesMeta> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_META_FIELD_LEN) : '');
  let count = 0;
  for (const [code, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_IMPORT_ENTRIES) break;
    if (!code || code.length > 20 || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const m = raw as Record<string, unknown>;
    out[code] = {
      comName: str(m.comName),
      sciName: str(m.sciName),
      firstDate: str(m.firstDate),
      firstLocation: str(m.firstLocation),
      totalCount:
        typeof m.totalCount === 'number' && Number.isFinite(m.totalCount) && m.totalCount > 0
          ? Math.floor(m.totalCount)
          : 1,
    };
    count++;
  }
  return out;
}

interface Props {
  lifeList: string[];
  yearList: string[];
  lifeListMeta: Record<string, SpeciesMeta>;
  yearListActive: boolean;
  observations: ClassifiedObservation[];
  onAdd: (speciesCode: string, comName: string, sciName?: string) => void;
  onRemove: (speciesCode: string) => void;
  onAddToYear: (speciesCode: string, comName: string, sciName?: string) => void;
  onRemoveFromYear: (speciesCode: string) => void;
  onToggleYearList: (active: boolean) => void;
  onBulkImport: (lifeCodes: string[], yearCodes: string[], meta: Record<string, SpeciesMeta>) => void;
  onClearLifeList: () => void;
  onClearYearList: () => void;
  lightMode: boolean;
}

function buildNameMap(observations: ClassifiedObservation[]): Map<string, { comName: string; sciName: string }> {
  const map = new Map<string, { comName: string; sciName: string }>();
  for (const obs of observations) map.set(obs.speciesCode, { comName: obs.comName, sciName: obs.sciName });
  return map;
}

function formatDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const year = parseInt(parts[0], 10);
  if (isNaN(month) || isNaN(day) || isNaN(year)) return dateStr;
  return `${months[month]} ${day}, ${year}`;
}

export default function LifeListPanel({
  lifeList, yearList, lifeListMeta, yearListActive, observations,
  onAdd, onRemove, onAddToYear, onRemoveFromYear, onToggleYearList,
  onBulkImport, onClearLifeList, onClearYearList, lightMode,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpeciesEntry[]>([]);
  const [taxonomy, setTaxonomy] = useState<SpeciesEntry[] | null>(null);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);
  const [importToast, setImportToast] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [hoveredResult, setHoveredResult] = useState<string | null>(null);
  const [importHov, setImportHov] = useState(false);
  const [exportHov, setExportHov] = useState(false);
  const [clearHov, setClearHov] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = getTheme(lightMode);

  const nameMap = buildNameMap(observations);
  const activeList = yearListActive ? yearList : lifeList;
  const addFn = yearListActive ? onAddToYear : onAdd;
  const removeFn = yearListActive ? onRemoveFromYear : onRemove;

  const liferOps = observations.filter(o => o.tier === 'lifer' || o.tier === 'lifer-rare');
  const uniqueLiferOps = new Set(liferOps.map(o => o.speciesCode)).size;

  function ensureTaxonomy() {
    if (taxonomy || taxonomyLoading) return;
    setTaxonomyLoading(true);
    loadTaxonomy()
      .then(setTaxonomy)
      .catch(() => showToast('Could not load species database — check your connection.'))
      .finally(() => setTaxonomyLoading(false));
  }

  function handleSearch(q: string) {
    setQuery(q);
    if (!taxonomy) {
      ensureTaxonomy();
      setResults([]);
      return;
    }
    setResults(q.trim() ? searchTaxonomy(taxonomy, q) : []);
  }

  // Taxonomy arriving after the user already typed — run their pending query
  useEffect(() => {
    if (taxonomy && query.trim()) setResults(searchTaxonomy(taxonomy, query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxonomy]);

  function showToast(msg: string, ms = 5000) {
    setImportToast(msg);
    setTimeout(() => setImportToast(null), ms);
  }

  // ─── Export (data-loss insurance for localStorage-only lists) ───────────────
  function handleExport() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      lifeList,
      yearList,
      lifeListMeta,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `birdradar-lists-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── JSON Import (round-trips the export format) ────────────────────────────
  function handleJSONImport(text: string) {
    try {
      const data: unknown = JSON.parse(text);
      const d = data as { lifeList?: unknown; yearList?: unknown; lifeListMeta?: unknown };
      const lifeCodes = sanitizeImportCodes(d.lifeList);
      const yearCodes = sanitizeImportCodes(d.yearList);
      const meta = sanitizeImportMeta(d.lifeListMeta);
      if (lifeCodes.length === 0 && yearCodes.length === 0) {
        showToast('No species found in JSON file.');
        return;
      }
      onBulkImport(lifeCodes, yearCodes, meta);
      showToast(`Imported ${lifeCodes.length} life species, ${yearCodes.length} year species from backup`, 6000);
    } catch {
      showToast('Could not read JSON file.');
    }
  }

  // ─── CSV / JSON Import ──────────────────────────────────────────────────────
  function handleCSVFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      showToast('File too large — imports are limited to 5 MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const isJSON = file.name.toLowerCase().endsWith('.json');

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      if (isJSON) {
        handleJSONImport(text);
        return;
      }

      // Name→code resolution needs the full taxonomy (eBird CSV exports carry
      // no species codes)
      let tax: SpeciesEntry[];
      try {
        tax = await loadTaxonomy();
      } catch {
        showToast('Could not load species database — check your connection and retry.');
        return;
      }

      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return;

      const header = parseCSVRow(lines[0]);
      const comNameIdx = header.findIndex(h => h.trim().toLowerCase() === 'common name');
      const sciNameIdx = header.findIndex(h => h.trim().toLowerCase() === 'scientific name');
      const taxonCodeIdx = header.findIndex(h => h.trim().toLowerCase() === 'taxon code' || h.trim().toLowerCase() === 'species code');
      const locationIdx = header.findIndex(h => h.trim().toLowerCase() === 'location');
      const dateIdx = header.findIndex(h => h.trim().toLowerCase() === 'date');
      const subIdIdx = header.findIndex(h => h.trim().toLowerCase() === 'submission id');

      if (comNameIdx === -1) {
        showToast('Could not find "Common Name" column in CSV.');
        return;
      }

      const byComName = new Map<string, SpeciesEntry>();
      const bySciName = new Map<string, SpeciesEntry>();
      for (const sp of tax) {
        byComName.set(sp.comName.toLowerCase(), sp);
        if (sp.sciName) bySciName.set(sp.sciName.toLowerCase(), sp);
      }

      const currentYear = new Date().getFullYear().toString();
      type RowData = { date: string; location: string; subId: string };
      const speciesRows = new Map<string, { comName: string; sciName: string; rows: RowData[] }>();
      const checklistIds = new Set<string>();

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        if (!row.length) continue;

        const comName = (row[comNameIdx] ?? '').trim();
        const sciName = sciNameIdx !== -1 ? (row[sciNameIdx] ?? '').trim() : '';
        const taxonCode = taxonCodeIdx !== -1 ? (row[taxonCodeIdx] ?? '').trim() : '';
        const location = locationIdx !== -1 ? (row[locationIdx] ?? '').trim() : '';
        const date = dateIdx !== -1 ? (row[dateIdx] ?? '').trim() : '';
        const subId = subIdIdx !== -1 ? (row[subIdIdx] ?? '').trim() : '';

        if (!comName) continue;
        if (subId) checklistIds.add(subId);

        let speciesCode: string, resolvedComName: string, resolvedSciName: string;
        if (taxonCode) {
          speciesCode = taxonCode; resolvedComName = comName; resolvedSciName = sciName;
        } else {
          const entry = byComName.get(comName.toLowerCase()) ?? bySciName.get(sciName.toLowerCase());
          if (!entry) continue;
          speciesCode = entry.speciesCode; resolvedComName = entry.comName; resolvedSciName = entry.sciName ?? '';
        }

        if (!speciesRows.has(speciesCode)) speciesRows.set(speciesCode, { comName: resolvedComName, sciName: resolvedSciName, rows: [] });
        speciesRows.get(speciesCode)!.rows.push({ date, location, subId });
      }

      const lifeCodes: string[] = [], yearCodes: string[] = [];
      const meta: Record<string, SpeciesMeta> = {};

      for (const [code, { comName: spComName, sciName: spSciName, rows }] of speciesRows) {
        lifeCodes.push(code);
        const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
        const firstRow = sortedRows[0];
        meta[code] = { comName: spComName, sciName: spSciName, firstDate: firstRow?.date ?? '', firstLocation: firstRow?.location ?? '', totalCount: rows.length };
        if (rows.some(r => r.date.startsWith(currentYear))) yearCodes.push(code);
      }

      onBulkImport(lifeCodes, yearCodes, meta);
      showToast(`Imported ${lifeCodes.length} life species, ${yearCodes.length} year species from ${checklistIds.size} checklists`, 6000);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const sortedActiveList = [...activeList].sort((a, b) => {
    const nameA = lifeListMeta[a]?.comName ?? nameMap.get(a)?.comName ?? a;
    const nameB = lifeListMeta[b]?.comName ?? nameMap.get(b)?.comName ?? b;
    return nameA.localeCompare(nameB);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: t.bg1 }}>

      {/* Mode toggle — Life / Year */}
      <div style={{ display: 'flex', gap: 4, padding: '10px 14px', borderBottom: `1px solid ${t.line2}`, background: t.bg0, flexShrink: 0 }}>
        {(['life', 'year'] as const).map(mode => {
          const active = mode === 'year' ? yearListActive : !yearListActive;
          return (
            <button key={mode} onClick={() => onToggleYearList(mode === 'year')} style={{
              flex: 1, padding: '8px 4px', borderRadius: 7,
              background: active ? t.bg1 : 'transparent',
              border: active ? `1px solid ${t.line2}` : '1px solid transparent',
              boxShadow: active ? t.shadow : 'none',
              color: active ? t.fg0 : t.fg3,
              fontSize: 12, fontWeight: active ? 600 : 400,
              cursor: 'pointer', fontFamily: t.sans, transition: 'all 0.12s',
            }}>
              {mode === 'life' ? 'Life List' : 'Year List'}
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${t.line2}`, flexShrink: 0 }}>
        <div style={{ flex: 1, padding: '14px 20px', borderRight: `1px solid ${t.line2}` }}>
          <div style={{ fontSize: 10, fontFamily: t.mono, color: t.fg3, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 3 }}>
            {yearListActive ? 'Year / Life' : 'Life Total'}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, fontFamily: t.display, color: t.accent, letterSpacing: '-0.03em' }}>
            {yearListActive ? `${yearList.length} / ${lifeList.length}` : lifeList.length}
          </div>
        </div>
        <div style={{ flex: 1, padding: '14px 20px' }}>
          <div style={{ fontSize: 10, fontFamily: t.mono, color: t.fg3, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 3 }}>
            Lifers Nearby
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, fontFamily: t.display, color: t.lifer, letterSpacing: '-0.03em' }}>
            {uniqueLiferOps}
          </div>
        </div>
      </div>

      {/* Search + import */}
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${t.line1}`, flexShrink: 0 }}>
        {/* Search input */}
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: t.fg3 }}/>
          <input
            type="text"
            placeholder="Search any species to add…"
            value={query}
            onFocus={ensureTaxonomy}
            onChange={e => handleSearch(e.target.value)}
            style={{
              width: '100%', padding: '9px 12px 9px 32px',
              fontSize: 13, fontFamily: t.sans,
              background: t.bg2, border: `1px solid ${query ? t.accentBorder : t.line2}`,
              borderRadius: 8, outline: 'none', color: t.fg0,
              boxSizing: 'border-box', transition: 'border-color 0.15s',
            }}
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); }} style={{
              position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', cursor: 'pointer', color: t.fg3, padding: '0 2px',
            }}>
              <XIcon size={13}/>
            </button>
          )}
        </div>

        {/* Species database loading hint */}
        {taxonomyLoading && query.trim() && (
          <div style={{
            marginTop: -4, marginBottom: 8, padding: '9px 12px',
            background: t.cardBg, border: `1px solid ${t.line2}`,
            borderRadius: 8, fontSize: 12, color: t.fg3, fontFamily: t.mono,
          }}>
            Loading species database…
          </div>
        )}

        {/* Search dropdown */}
        {results.length > 0 && (
          <div style={{
            marginTop: -4, marginBottom: 8,
            background: t.cardBg, border: `1px solid ${t.line2}`,
            borderRadius: 8, maxHeight: 200, overflowY: 'auto',
            boxShadow: t.shadowLg,
          }}>
            {results.map(sp => {
              const already = activeList.includes(sp.speciesCode);
              return (
                <button
                  key={sp.speciesCode}
                  onClick={() => { if (!already) addFn(sp.speciesCode, sp.comName, sp.sciName); setQuery(''); setResults([]); }}
                  onMouseEnter={() => !already && setHoveredResult(sp.speciesCode)}
                  onMouseLeave={() => setHoveredResult(null)}
                  disabled={already}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: hoveredResult === sp.speciesCode ? t.bg2 : 'transparent',
                    border: 'none',
                    padding: '9px 12px', cursor: already ? 'default' : 'pointer',
                    borderBottom: `1px solid ${t.line1}`, opacity: already ? 0.45 : 1,
                    fontFamily: t.sans, transition: 'background 0.12s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, color: t.fg0, fontWeight: 500 }}>{sp.comName}</span>
                    {already && <CheckIcon size={12} style={{ color: t.lifer }}/>}
                  </div>
                  <div style={{ fontSize: 11, color: t.fg2, fontStyle: 'italic' }}>{sp.sciName}</div>
                </button>
              );
            })}
          </div>
        )}

        {/* Import CSV/JSON + Export */}
        <input ref={fileInputRef} type="file" accept=".csv,.json" style={{ display: 'none' }} onChange={handleCSVFile}/>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            onMouseEnter={() => setImportHov(true)}
            onMouseLeave={() => setImportHov(false)}
            style={{
              flex: 1, padding: '8px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: importHov ? t.bg3 : t.bg2, border: `1px solid ${t.line2}`,
              borderRadius: 8, color: t.fg1, fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: t.sans, transition: 'all 0.15s',
            }}>
            <UploadIcon size={14}/> Import
          </button>
          <button
            onClick={handleExport}
            disabled={lifeList.length === 0 && yearList.length === 0}
            onMouseEnter={() => setExportHov(true)}
            onMouseLeave={() => setExportHov(false)}
            title="Download your lists as a JSON backup"
            style={{
              flex: 1, padding: '8px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: exportHov ? t.bg3 : t.bg2, border: `1px solid ${t.line2}`,
              borderRadius: 8, fontSize: 13, fontWeight: 500,
              color: lifeList.length === 0 && yearList.length === 0 ? t.fg4 : t.fg1,
              cursor: lifeList.length === 0 && yearList.length === 0 ? 'default' : 'pointer',
              fontFamily: t.sans, transition: 'all 0.15s',
            }}>
            <DownloadIcon size={14}/> Export
          </button>
        </div>

        {/* Import toast */}
        {importToast && (
          <div style={{
            marginTop: 8, padding: '8px 12px',
            background: t.liferBg, border: `1px solid ${t.liferBorder}`,
            borderRadius: 8, fontSize: 12, color: t.lifer,
            fontFamily: t.mono, lineHeight: 1.5,
          }}>{importToast}</div>
        )}

        {/* Clear list */}
        {!confirmClear ? (
          <button
            onClick={() => setConfirmClear(true)}
            disabled={activeList.length === 0}
            onMouseEnter={() => setClearHov(true)}
            onMouseLeave={() => setClearHov(false)}
            style={{
              width: '100%', marginTop: 6, padding: '7px 0',
              background: clearHov && activeList.length > 0 ? 'rgba(239,68,68,0.06)' : 'transparent',
              border: `1px solid ${activeList.length === 0 ? 'transparent' : 'rgba(239,68,68,0.22)'}`,
              borderRadius: 8, color: activeList.length === 0 ? t.fg4 : clearHov ? '#EF4444' : 'rgba(239,68,68,0.65)',
              fontSize: 12, fontWeight: 500, cursor: activeList.length === 0 ? 'default' : 'pointer',
              fontFamily: t.sans, transition: 'all 0.15s',
            }}>
            Clear {yearListActive ? 'Year' : 'Life'} List
          </button>
        ) : (
          <div style={{
            marginTop: 6, padding: '10px 12px',
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.22)',
            borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: '#EF4444', fontFamily: t.sans }}>
              Clear {activeList.length} species?
            </span>
            <button onClick={() => { if (yearListActive) onClearYearList(); else onClearLifeList(); setConfirmClear(false); }} style={{
              padding: '4px 12px', background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.35)', borderRadius: 6,
              color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: t.sans,
            }}>Yes</button>
            <button onClick={() => setConfirmClear(false)} style={{
              padding: '4px 12px', background: t.bg2,
              border: `1px solid ${t.line2}`, borderRadius: 6,
              color: t.fg2, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: t.sans,
            }}>No</button>
          </div>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeList.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: t.fg3, fontSize: 13, fontFamily: t.sans }}>
            <div style={{ marginBottom: 10 }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={t.fg4} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto' }}>
                <path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/>
              </svg>
            </div>
            {yearListActive ? 'Your year list is empty.' : 'Your life list is empty.'}
            <div style={{ fontSize: 12, color: t.fg4, marginTop: 6, lineHeight: 1.5 }}>
              Add species from map markers, search above, or import eBird CSV.
            </div>
          </div>
        ) : (
          sortedActiveList.map(code => {
            const meta = lifeListMeta[code];
            const info = nameMap.get(code);
            const name = meta?.comName ?? info?.comName ?? code;
            const subtitle = meta?.firstDate ? `${formatDate(meta.firstDate)} · ${meta.firstLocation}` : null;

            return (
              <div
                key={code}
                onMouseEnter={() => setHoveredCode(code)}
                onMouseLeave={() => setHoveredCode(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 16px', borderBottom: `1px solid ${t.line1}`,
                  background: hoveredCode === code ? t.bg2 : t.bg1,
                  transition: 'background 0.12s',
                }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.accent, flexShrink: 0, opacity: 0.8 }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: t.fg0, fontFamily: t.display, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </div>
                  {subtitle && (
                    <div style={{ fontSize: 10.5, color: t.fg3, marginTop: 1, fontFamily: t.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {subtitle}
                    </div>
                  )}
                </div>
                {meta?.totalCount && meta.totalCount > 1 && (
                  <span style={{ fontSize: 10.5, fontFamily: t.mono, color: t.fg3, flexShrink: 0 }}>×{meta.totalCount}</span>
                )}
                <button onClick={() => removeFn(code)} title={`Remove from ${yearListActive ? 'year' : 'life'} list`} style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: t.fg4, padding: '2px', borderRadius: 4, lineHeight: 1, flexShrink: 0,
                }}>
                  <XIcon size={13}/>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── CSV row parser ──────────────────────────────────────────────────────────

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else current += ch;
  }
  result.push(current);
  return result;
}

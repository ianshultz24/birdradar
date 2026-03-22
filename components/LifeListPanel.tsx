'use client';

import { useRef, useState } from 'react';
import type { ClassifiedObservation } from '@/lib/ebird';
import { searchSpecies, type SpeciesEntry } from '@/lib/species-data';
import { PNW_SPECIES } from '@/lib/species-data';
import type { SpeciesMeta } from '@/lib/lifelist';

interface Props {
  lifeList: string[];
  yearList: string[];
  lifeListMeta: Record<string, SpeciesMeta>;
  yearListActive: boolean;
  observations: ClassifiedObservation[];
  onAdd: (speciesCode: string, comName: string) => void;
  onRemove: (speciesCode: string) => void;
  onAddToYear: (speciesCode: string, comName: string) => void;
  onRemoveFromYear: (speciesCode: string) => void;
  onToggleYearList: (active: boolean) => void;
  onBulkImport: (lifeCodes: string[], yearCodes: string[], meta: Record<string, SpeciesMeta>) => void;
  onClearLifeList: () => void;
  onClearYearList: () => void;
  lightMode: boolean;
}

function buildNameMap(observations: ClassifiedObservation[]): Map<string, { comName: string; sciName: string }> {
  const map = new Map<string, { comName: string; sciName: string }>();
  for (const obs of observations) {
    map.set(obs.speciesCode, { comName: obs.comName, sciName: obs.sciName });
  }
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
  lifeList,
  yearList,
  lifeListMeta,
  yearListActive,
  observations,
  onAdd,
  onRemove,
  onAddToYear,
  onRemoveFromYear,
  onToggleYearList,
  onBulkImport,
  onClearLifeList,
  onClearYearList,
  lightMode,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpeciesEntry[]>([]);
  const [importToast, setImportToast] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nameMap = buildNameMap(observations);

  // Which list are we managing?
  const activeList = yearListActive ? yearList : lifeList;
  const addFn = yearListActive ? onAddToYear : onAdd;
  const removeFn = yearListActive ? onRemoveFromYear : onRemove;

  const liferOps = observations.filter(
    (o) => o.tier === 'lifer' || o.tier === 'lifer-rare'
  );
  const uniqueLiferOps = new Set(liferOps.map((o) => o.speciesCode)).size;

  function handleSearch(q: string) {
    setQuery(q);
    setResults(q.trim() ? searchSpecies(q) : []);
  }

  // ─── CSV Import ────────────────────────────────────────────────────────────
  function handleCSVFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return;

      // Parse header to find column indices
      const header = parseCSVRow(lines[0]);
      const comNameIdx = header.findIndex(
        (h) => h.trim().toLowerCase() === 'common name'
      );
      const sciNameIdx = header.findIndex(
        (h) => h.trim().toLowerCase() === 'scientific name'
      );
      const taxonCodeIdx = header.findIndex(
        (h) => h.trim().toLowerCase() === 'taxon code' || h.trim().toLowerCase() === 'species code'
      );
      const locationIdx = header.findIndex(
        (h) => h.trim().toLowerCase() === 'location'
      );
      const dateIdx = header.findIndex(
        (h) => h.trim().toLowerCase() === 'date'
      );
      const subIdIdx = header.findIndex(
        (h) => h.trim().toLowerCase() === 'submission id'
      );

      if (comNameIdx === -1) {
        setImportToast('Could not find "Common Name" column in CSV.');
        setTimeout(() => setImportToast(null), 5000);
        return;
      }

      // Build fallback lookup by comName/sciName for CSVs without a Taxon Code column
      const byComName = new Map<string, SpeciesEntry>();
      const bySciName = new Map<string, SpeciesEntry>();
      for (const sp of PNW_SPECIES) {
        byComName.set(sp.comName.toLowerCase(), sp);
        if (sp.sciName) bySciName.set(sp.sciName.toLowerCase(), sp);
      }

      const currentYear = new Date().getFullYear().toString();

      // Aggregate per species: track all rows
      type RowData = { date: string; location: string; subId: string };
      const speciesRows = new Map<string, { comName: string; sciName: string; rows: RowData[] }>();
      const checklistIds = new Set<string>();

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        if (row.length === 0) continue;

        const comName = (row[comNameIdx] ?? '').trim();
        const sciName = sciNameIdx !== -1 ? (row[sciNameIdx] ?? '').trim() : '';
        const taxonCode = taxonCodeIdx !== -1 ? (row[taxonCodeIdx] ?? '').trim() : '';
        const location = locationIdx !== -1 ? (row[locationIdx] ?? '').trim() : '';
        const date = dateIdx !== -1 ? (row[dateIdx] ?? '').trim() : '';
        const subId = subIdIdx !== -1 ? (row[subIdIdx] ?? '').trim() : '';

        if (!comName) continue;
        if (subId) checklistIds.add(subId);

        // Prefer the taxon code from the CSV (present in all eBird "My Data" exports).
        // Fall back to PNW_SPECIES lookup for CSVs that omit the code column.
        let speciesCode: string;
        let resolvedComName: string;
        let resolvedSciName: string;

        if (taxonCode) {
          speciesCode = taxonCode;
          resolvedComName = comName;
          resolvedSciName = sciName;
        } else {
          const entry =
            byComName.get(comName.toLowerCase()) ??
            bySciName.get(sciName.toLowerCase());
          if (!entry) continue;
          speciesCode = entry.speciesCode;
          resolvedComName = entry.comName;
          resolvedSciName = entry.sciName ?? '';
        }

        if (!speciesRows.has(speciesCode)) {
          speciesRows.set(speciesCode, { comName: resolvedComName, sciName: resolvedSciName, rows: [] });
        }
        speciesRows.get(speciesCode)!.rows.push({ date, location, subId });
      }

      // Build results
      const lifeCodes: string[] = [];
      const yearCodes: string[] = [];
      const meta: Record<string, SpeciesMeta> = {};

      for (const [code, { comName: spComName, sciName: spSciName, rows }] of speciesRows) {
        lifeCodes.push(code);

        // Find earliest date row
        const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
        const firstRow = sortedRows[0];

        meta[code] = {
          comName: spComName,
          sciName: spSciName,
          firstDate: firstRow?.date ?? '',
          firstLocation: firstRow?.location ?? '',
          totalCount: rows.length,
        };

        // Year list: any row with date in current year
        if (rows.some((r) => r.date.startsWith(currentYear))) {
          yearCodes.push(code);
        }
      }

      onBulkImport(lifeCodes, yearCodes, meta);

      setImportToast(
        `Imported ${lifeCodes.length} life species, ${yearCodes.length} year species from ${checklistIds.size} checklists`
      );
      setTimeout(() => setImportToast(null), 6000);
    };
    reader.readAsText(file);

    // Reset so same file can be re-imported
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Style tokens
  const bg = lightMode ? '#f4f6f8' : 'transparent';
  const cardBg = lightMode ? '#ffffff' : 'transparent';
  const border = lightMode ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)';
  const borderThin = lightMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
  const inputBg = lightMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)';
  const inputBorder = lightMode ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
  const textPrimary = lightMode ? '#1a2332' : '#ccddef';
  const textSecondary = lightMode ? '#4a5568' : '#8899aa';
  const textMuted = lightMode ? '#718096' : '#334455';
  const dropdownBg = lightMode ? '#ffffff' : '#111820';

  // Sorted life list entries: alphabetically by display name
  const sortedActiveList = [...activeList].sort((a, b) => {
    const nameA = lifeListMeta[a]?.comName ?? nameMap.get(a)?.comName ?? a;
    const nameB = lifeListMeta[b]?.comName ?? nameMap.get(b)?.comName ?? b;
    return nameA.localeCompare(nameB);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>

      {/* Life List / Year List toggle */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '10px 12px 8px',
          borderBottom: `1px solid ${border}`,
          flexShrink: 0,
        }}
      >
        {(['life', 'year'] as const).map((mode) => {
          const active = mode === 'year' ? yearListActive : !yearListActive;
          return (
            <button
              key={mode}
              onClick={() => onToggleYearList(mode === 'year')}
              style={{
                flex: 1,
                padding: '5px 0',
                background: active ? 'rgba(245,166,35,0.15)' : inputBg,
                border: `1px solid ${active ? 'rgba(245,166,35,0.45)' : inputBorder}`,
                borderRadius: 5,
                color: active ? '#f5a623' : textSecondary,
                fontSize: 11,
                fontWeight: active ? 700 : 400,
                cursor: 'pointer',
                letterSpacing: '0.06em',
                fontFamily: 'var(--font-jb-mono, monospace)',
                transition: 'all 0.15s',
              }}
            >
              {mode === 'life' ? 'LIFE LIST' : 'YEAR LIST'}
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: `1px solid ${border}`,
          flexShrink: 0,
        }}
      >
        <StatCell
          label={yearListActive ? 'YEAR LIST' : 'LIFE LIST'}
          value={yearListActive ? `${yearList.length} / ${lifeList.length}` : String(lifeList.length)}
          color="#f5a623"
          lightMode={lightMode}
        />
        <div style={{ width: 1, background: border }} />
        <StatCell
          label="LIFERS NEARBY"
          value={String(uniqueLiferOps)}
          color="#3ecfb4"
          lightMode={lightMode}
        />
      </div>

      {/* Search + CSV import */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${borderThin}`,
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          placeholder="Search PNW species to add…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          style={{
            width: '100%',
            background: inputBg,
            border: `1px solid ${inputBorder}`,
            borderRadius: 5,
            padding: '7px 10px',
            color: textPrimary,
            fontSize: 13,
            outline: 'none',
            boxSizing: 'border-box',
            fontFamily: 'var(--font-dm-sans, sans-serif)',
          }}
        />
        {results.length > 0 && (
          <div
            style={{
              marginTop: 4,
              background: dropdownBg,
              border: `1px solid ${inputBorder}`,
              borderRadius: 5,
              maxHeight: 200,
              overflowY: 'auto',
            }}
          >
            {results.map((sp) => {
              const already = activeList.includes(sp.speciesCode);
              return (
                <button
                  key={sp.speciesCode}
                  onClick={() => {
                    if (!already) addFn(sp.speciesCode, sp.comName);
                    setQuery('');
                    setResults([]);
                  }}
                  disabled={already}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    padding: '7px 10px',
                    cursor: already ? 'default' : 'pointer',
                    borderBottom: `1px solid ${borderThin}`,
                    opacity: already ? 0.4 : 1,
                  }}
                >
                  <div style={{ fontSize: 13, color: textPrimary, fontWeight: 500 }}>
                    {sp.comName}
                    {already && (
                      <span style={{ fontSize: 10, color: textMuted, marginLeft: 6 }}>✓ added</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: textSecondary, fontStyle: 'italic' }}>
                    {sp.sciName}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* eBird CSV import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={handleCSVFile}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: '100%',
            marginTop: 8,
            padding: '6px 0',
            background: inputBg,
            border: `1px solid ${inputBorder}`,
            borderRadius: 5,
            color: textSecondary,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.04em',
            fontFamily: 'var(--font-jb-mono, monospace)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(245,166,35,0.4)';
            (e.currentTarget as HTMLElement).style.color = '#f5a623';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = inputBorder;
            (e.currentTarget as HTMLElement).style.color = textSecondary;
          }}
        >
          ↑ Import eBird CSV
        </button>

        {/* Import toast */}
        {importToast && (
          <div
            style={{
              marginTop: 6,
              padding: '6px 10px',
              background: 'rgba(62,207,180,0.12)',
              border: '1px solid rgba(62,207,180,0.3)',
              borderRadius: 4,
              fontSize: 11,
              color: '#3ecfb4',
              fontFamily: 'var(--font-jb-mono, monospace)',
              lineHeight: 1.5,
            }}
          >
            {importToast}
          </div>
        )}

        {/* Clear list */}
        {!confirmClear ? (
          <button
            onClick={() => setConfirmClear(true)}
            disabled={activeList.length === 0}
            style={{
              width: '100%',
              marginTop: 6,
              padding: '6px 0',
              background: 'transparent',
              border: `1px solid ${activeList.length === 0 ? 'transparent' : 'rgba(239,68,68,0.2)'}`,
              borderRadius: 5,
              color: activeList.length === 0 ? textMuted : 'rgba(239,68,68,0.6)',
              fontSize: 11,
              fontWeight: 600,
              cursor: activeList.length === 0 ? 'default' : 'pointer',
              letterSpacing: '0.04em',
              fontFamily: 'var(--font-jb-mono, monospace)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              if (activeList.length > 0) {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.5)';
                (e.currentTarget as HTMLElement).style.color = '#ef4444';
              }
            }}
            onMouseLeave={(e) => {
              if (activeList.length > 0) {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.2)';
                (e.currentTarget as HTMLElement).style.color = 'rgba(239,68,68,0.6)';
              }
            }}
          >
            ✕ Clear {yearListActive ? 'Year' : 'Life'} List
          </button>
        ) : (
          <div
            style={{
              marginTop: 6,
              padding: '8px 10px',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ flex: 1, fontSize: 11, color: '#ef4444', fontFamily: 'var(--font-jb-mono, monospace)' }}>
              Clear {activeList.length} species?
            </span>
            <button
              onClick={() => {
                if (yearListActive) onClearYearList();
                else onClearLifeList();
                setConfirmClear(false);
              }}
              style={{
                padding: '3px 10px',
                background: 'rgba(239,68,68,0.2)',
                border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: 4,
                color: '#ef4444',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'var(--font-jb-mono, monospace)',
              }}
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              style={{
                padding: '3px 10px',
                background: 'transparent',
                border: `1px solid ${inputBorder}`,
                borderRadius: 4,
                color: textSecondary,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-jb-mono, monospace)',
              }}
            >
              No
            </button>
          </div>
        )}
      </div>

      {/* List — sorted alphabetically */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeList.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: textMuted, fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🐦</div>
            {yearListActive ? 'Your year list is empty.' : 'Your life list is empty.'}
            <br />
            Add species via map markers, search above, or import eBird CSV.
          </div>
        ) : (
          sortedActiveList.map((code) => {
            const meta = lifeListMeta[code];
            const info = nameMap.get(code);
            const name = meta?.comName ?? info?.comName ?? code;
            const subtitle =
              meta?.firstDate
                ? `${formatDate(meta.firstDate)} · ${meta.firstLocation}`
                : null;

            return (
              <div
                key={code}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  padding: '8px 12px',
                  borderBottom: `1px solid ${borderThin}`,
                  gap: 8,
                  background: cardBg,
                }}
              >
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: yearListActive ? '#3ecfb4' : '#f5a623',
                    flexShrink: 0,
                    marginTop: 5,
                    boxShadow: yearListActive ? '0 0 4px #3ecfb466' : '0 0 4px #f5a62366',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: textPrimary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: 500,
                    }}
                  >
                    {name}
                  </div>
                  {subtitle && (
                    <div
                      style={{
                        fontSize: 11,
                        color: textMuted,
                        marginTop: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: 'var(--font-jb-mono, monospace)',
                      }}
                    >
                      {subtitle}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => removeFn(code)}
                  title={`Remove from ${yearListActive ? 'year' : 'life'} list`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: textMuted,
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: '2px 4px',
                    borderRadius: 3,
                    lineHeight: 1,
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = textMuted; }}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── CSV row parser (handles quoted fields) ───────────────────────────────────

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── StatCell ────────────────────────────────────────────────────────────────

function StatCell({
  label,
  value,
  color,
  lightMode,
}: {
  label: string;
  value: string;
  color: string;
  lightMode: boolean;
}) {
  const labelColor = lightMode ? '#718096' : '#445566';

  return (
    <div
      style={{
        flex: 1,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: '0.1em',
          color: labelColor,
          fontFamily: 'var(--font-jb-mono, monospace)',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--font-jb-mono, monospace)' }}>
        {value}
      </span>
    </div>
  );
}

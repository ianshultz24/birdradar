'use client';

import { useState } from 'react';
import type { ClassifiedObservation, AppSettings, Hotspot, TargetSpecies } from '@/lib/ebird';
import type { SpeciesMeta } from '@/lib/lifelist';
import type { ArrivingSpecies } from '@/lib/forecast';
import type { SyncPayload } from '@/lib/sync-client';
import { getTheme } from '@/lib/theme';
import type { SortMode } from '@/lib/alerts-sort';
import { BellIcon, BirdIcon, SettingsIcon } from '@/components/Icons';
import AlertsPanel from './AlertsPanel';
import LifeListPanel from './LifeListPanel';
import SettingsPanel from './SettingsPanel';

type Tab = 'alerts' | 'lifelist' | 'settings';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  isMobile?: boolean;
  drawerOpen?: boolean;
  observations: ClassifiedObservation[];
  hotspots: Hotspot[];
  lifeList: string[];
  yearList: string[];
  lifeListMeta: Record<string, SpeciesMeta>;
  targetSpecies: TargetSpecies[];
  arrivingSpecies: ArrivingSpecies[];
  settings: AppSettings;
  apiStatus: 'ok' | 'error' | 'loading';
  loading: boolean;
  userCenter: [number, number];
  /** False while no location has been established — `userCenter` is a sentinel
   *  then (PENDING_CENTER in app/page.tsx). Only Settings acts on it: the alerts
   *  list is empty in that state anyway, because nothing has been fetched. */
  locationResolved: boolean;
  /** The user's GPS fix, for drive-time badges and the "reachable only" filter.
   *  Distinct from `userCenter`, which follows a dropped pin — a pin moves where
   *  you search, not where you are driving from. */
  driveOrigin: [number, number] | null;
  focusedSpecies: { code: string; name: string } | null;
  onFlyTo: (lat: number, lng: number) => void;
  onFocusSpecies: (code: string, name: string) => void;
  onAddToLifeList: (code: string, name: string, sciName?: string) => void;
  onRemoveFromLifeList: (code: string) => void;
  onAddToYearList: (code: string, name: string, sciName?: string) => void;
  onRemoveFromYearList: (code: string) => void;
  onBulkImport: (lifeCodes: string[], yearCodes: string[], meta: Record<string, SpeciesMeta>) => void;
  onClearLifeList: () => void;
  onClearYearList: () => void;
  onSettingsChange: (s: AppSettings) => void;
  onRefreshNow: () => void;
  onSyncMerge: (payload: SyncPayload) => void;
  /** OS-level reduced-motion preference — forces low battery mode on */
  prefersReducedMotion: boolean;
}

const TABS: { id: Tab; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { id: 'alerts', label: 'Alerts', Icon: BellIcon },
  { id: 'lifelist', label: 'Life List', Icon: BirdIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export default function Sidebar(props: Props) {
  const {
    activeTab, onTabChange, isMobile, drawerOpen,
    observations, lifeList, yearList, lifeListMeta, targetSpecies, arrivingSpecies,
    settings, apiStatus, loading, userCenter, locationResolved, driveOrigin,
    focusedSpecies, onFlyTo, onFocusSpecies,
    onAddToLifeList, onRemoveFromLifeList, onAddToYearList, onRemoveFromYearList,
    onBulkImport, onClearLifeList, onClearYearList, onSettingsChange,
    onRefreshNow, onSyncMerge, prefersReducedMotion,
  } = props;

  const [hoveredTab, setHoveredTab] = useState<Tab | null>(null);

  // ─── Alerts list controls live here, not in AlertsPanel ───────────────────
  // `panelContent` below renders `{activeTab === 'alerts' && <AlertsPanel/>}`, so
  // every tab switch unmounts that component and re-runs its `useState`
  // initialisers. With the sort mode owned there, picking "Closest", glancing at
  // Settings and coming back silently reverted to "Recent" — half of the Phase E1
  // "the sort does nothing" report.
  //
  // Sidebar is the right home rather than app/page.tsx: it is mounted for the
  // life of the page in BOTH layouts — the mobile branch renders its drawer
  // unconditionally and hides it with `transform: translateY(100%)`, so closing
  // the drawer does not unmount this component — and no other consumer needs the
  // sort mode. Verified, not assumed: a `{drawerOpen && …}` here instead of the
  // transform would reproduce the bug on mobile only, where the 1920-wide test
  // harness cannot see it.
  const [sortBy, setSortBy] = useState<SortMode>('recent');
  const [searchQuery, setSearchQuery] = useState('');

  const lm = settings.lightMode;
  const t = getTheme(lm);

  const lifers = observations.filter(o => o.tier === 'lifer' || o.tier === 'lifer-rare').length;
  const total = observations.length;
  const lifeListCount = lifeList.length;

  const pendingAlerts = observations.filter(
    o => o.tier === 'lifer-rare' || o.tier === 'lifer' || o.tier === 'rare'
  ).length;

  function handleToggleYearList(active: boolean) {
    onSettingsChange({ ...settings, yearListActive: active });
  }

  const panelContent = (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {activeTab === 'alerts' && (
        <AlertsPanel
          observations={observations}
          targetSpecies={targetSpecies}
          arrivingSpecies={arrivingSpecies}
          yearListActive={settings.yearListActive}
          lightMode={lm}
          useMetric={settings.useMetric}
          userCenter={userCenter}
          focusedSpecies={focusedSpecies}
          driveOrigin={driveOrigin}
          driveTimeReachableOnly={settings.driveTimeReachableOnly}
          driveTimeMaxMin={settings.driveTimeMaxMin}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onFlyTo={onFlyTo}
          onFocusSpecies={onFocusSpecies}
          onDriveTimeFilterChange={(reachableOnly, maxMin) =>
            onSettingsChange({
              ...settings,
              driveTimeReachableOnly: reachableOnly,
              driveTimeMaxMin: maxMin,
            })
          }
        />
      )}
      {activeTab === 'lifelist' && (
        <LifeListPanel
          lifeList={lifeList}
          yearList={yearList}
          lifeListMeta={lifeListMeta}
          yearListActive={settings.yearListActive}
          observations={observations}
          onAdd={onAddToLifeList}
          onRemove={onRemoveFromLifeList}
          onAddToYear={onAddToYearList}
          onRemoveFromYear={onRemoveFromYearList}
          onToggleYearList={handleToggleYearList}
          onBulkImport={onBulkImport}
          onClearLifeList={onClearLifeList}
          onClearYearList={onClearYearList}
          lightMode={lm}
        />
      )}
      {activeTab === 'settings' && (
        <SettingsPanel
          settings={settings}
          onChange={onSettingsChange}
          apiStatus={apiStatus}
          onRefreshNow={onRefreshNow}
          loading={loading}
          alertCenter={userCenter}
          locationResolved={locationResolved}
          lifeList={lifeList}
          yearList={yearList}
          lifeListMeta={lifeListMeta}
          onSyncMerge={onSyncMerge}
          prefersReducedMotion={prefersReducedMotion}
        />
      )}
      {/* HotspotPanel used to overlay this stack at `inset: 0`. It now lives in
          app/page.tsx as a right-hand panel over the map, alongside
          SpeciesDetailPanel — clicking a hotspot must not cover the observation
          list. `position: relative` above stays: it is the containing block the
          panels' shells are measured against elsewhere, and removing it here is
          unrelated churn. */}
    </div>
  );

  // ─── Mobile layout ───────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <div style={{
          position: 'fixed', bottom: 56, left: 0, right: 0, height: '62vh',
          zIndex: 1199, background: t.bg1, borderTop: `1px solid ${t.line2}`,
          borderRadius: '12px 12px 0 0',
          transform: drawerOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 6, flexShrink: 0 }}>
            <div style={{ width: 32, height: 3, borderRadius: 2, background: t.line3 }}/>
          </div>
          {panelContent}
        </div>

        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1200,
          background: t.bg1, borderTop: `1px solid ${t.line2}`,
          display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {TABS.map(tab => {
            const active = tab.id === activeTab && drawerOpen;
            const hov = hoveredTab === tab.id && !active;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                onMouseEnter={() => setHoveredTab(tab.id)}
                onMouseLeave={() => setHoveredTab(null)}
                style={{
                  flex: 1, minHeight: 56,
                  background: hov ? t.bg2 : 'transparent',
                  border: 'none',
                  borderTop: `2px solid ${active ? t.accent : 'transparent'}`,
                  color: active ? t.accent : hov ? t.fg1 : t.fg3,
                  cursor: 'pointer',
                  fontSize: 10, fontWeight: active ? 600 : 400,
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 3, transition: 'all 0.15s',
                  position: 'relative', paddingTop: 8, paddingBottom: 6,
                  WebkitTapHighlightColor: 'transparent',
                  fontFamily: t.sans,
                }}>
                <tab.Icon size={18}/>
                <span style={{ fontSize: 9, letterSpacing: '0.04em', fontFamily: t.sans }}>{tab.label}</span>
                {tab.id === 'alerts' && pendingAlerts > 0 && (
                  <span style={{
                    position: 'absolute', top: 6, right: '50%',
                    transform: 'translateX(10px)',
                    background: t.accent, color: t.accentFg,
                    fontSize: 8, fontWeight: 700, borderRadius: 8,
                    padding: '1px 4px', fontFamily: t.mono,
                  }}>{pendingAlerts}</span>
                )}
              </button>
            );
          })}
        </div>
      </>
    );
  }

  // ─── Desktop layout ──────────────────────────────────────────────────────
  return (
    <div style={{
      width: 380, height: '100vh', display: 'flex', flexDirection: 'column',
      background: t.bg1, borderRight: `1px solid ${t.line2}`,
      flexShrink: 0, overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${t.line2}`, flexShrink: 0 }}>
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* Radar glyph logo */}
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <circle cx="13" cy="13" r="12" stroke={t.accent} strokeWidth="1.5"/>
              <circle cx="13" cy="13" r="6.5" stroke={t.accent} strokeWidth="1" opacity="0.4"/>
              <circle cx="13" cy="13" r="2.5" fill={t.accent}/>
            </svg>
            <span style={{
              fontSize: 18, fontWeight: 700, fontFamily: t.display,
              letterSpacing: '-0.03em', color: t.fg0,
            }}>BirdRadar</span>
          </div>
          {/* Live badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, fontFamily: t.mono, color: t.accent, fontWeight: 500,
            background: t.accentBg, border: `1px solid ${t.accentBorder}`,
            borderRadius: 6, padding: '3px 8px',
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%', background: t.accent,
              animation: 'liferPulse 2s ease-in-out infinite',
            }}/>
            Live
          </div>
        </div>

        {/* Stat strip */}
        <div style={{
          display: 'flex', background: t.bg0,
          borderRadius: 8, overflow: 'hidden', border: `1px solid ${t.line2}`,
        }}>
          {[
            { label: 'Nearby', value: total },
            { label: settings.yearListActive ? 'Year New' : 'Lifers', value: lifers, accent: true },
            { label: 'Life List', value: lifeListCount },
          ].map((s, i) => (
            <div key={s.label} style={{
              flex: 1, padding: '10px 12px',
              borderRight: i < 2 ? `1px solid ${t.line2}` : 'none',
            }}>
              <div style={{
                fontSize: 10, color: t.fg3, fontFamily: t.mono,
                letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 2,
              }}>{s.label}</div>
              <div style={{
                fontSize: 20, fontWeight: 700, fontFamily: t.display,
                color: s.accent ? t.accent : t.fg0, letterSpacing: '-0.03em',
              }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', gap: 4, padding: '10px 14px',
        borderBottom: `1px solid ${t.line2}`, background: t.bg0, flexShrink: 0,
      }}>
        {TABS.map(tab => {
          const active = tab.id === activeTab;
          const hov = hoveredTab === tab.id && !active;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
              style={{
                flex: 1, padding: '8px 4px', borderRadius: 7,
                background: active ? t.bg1 : hov ? t.bg2 : 'transparent',
                border: active ? `1px solid ${t.line2}` : '1px solid transparent',
                boxShadow: active ? t.shadow : 'none',
                color: active ? t.fg0 : hov ? t.fg1 : t.fg3,
                cursor: 'pointer', fontSize: 12,
                fontWeight: active ? 600 : 400,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 5, fontFamily: t.sans, transition: 'all 0.12s',
                position: 'relative',
              }}>
              <tab.Icon size={14}/>
              {tab.label}
              {tab.id === 'alerts' && pendingAlerts > 0 && (
                <span style={{
                  position: 'absolute', top: 4, right: 6,
                  background: t.accent, color: t.accentFg,
                  fontSize: 8, fontWeight: 700, borderRadius: 6,
                  padding: '1px 4px', fontFamily: t.mono,
                }}>{pendingAlerts}</span>
              )}
            </button>
          );
        })}
      </div>

      {panelContent}
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { ClassifiedObservation, AppSettings, Hotspot, TargetSpecies } from '@/lib/ebird';
import type { SpeciesMeta } from '@/lib/lifelist';
import { getTheme } from '@/lib/theme';
import { BellIcon, BirdIcon, SettingsIcon } from '@/components/Icons';
import AlertsPanel from './AlertsPanel';
import LifeListPanel from './LifeListPanel';
import SettingsPanel from './SettingsPanel';
import HotspotPanel from './HotspotPanel';

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
  hotspotPanel: Hotspot | null;
  settings: AppSettings;
  apiStatus: 'ok' | 'error' | 'loading';
  loading: boolean;
  userCenter: [number, number];
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
  onCloseHotspotPanel: () => void;
}

const TABS: { id: Tab; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { id: 'alerts', label: 'Alerts', Icon: BellIcon },
  { id: 'lifelist', label: 'Life List', Icon: BirdIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export default function Sidebar(props: Props) {
  const {
    activeTab, onTabChange, isMobile, drawerOpen,
    observations, lifeList, yearList, lifeListMeta, targetSpecies,
    hotspotPanel, settings, apiStatus, loading, userCenter,
    focusedSpecies, onFlyTo, onFocusSpecies,
    onAddToLifeList, onRemoveFromLifeList, onAddToYearList, onRemoveFromYearList,
    onBulkImport, onClearLifeList, onClearYearList, onSettingsChange,
    onRefreshNow, onCloseHotspotPanel,
  } = props;

  const [hoveredTab, setHoveredTab] = useState<Tab | null>(null);

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
          yearListActive={settings.yearListActive}
          lightMode={lm}
          useMetric={settings.useMetric}
          userCenter={userCenter}
          focusedSpecies={focusedSpecies}
          onFlyTo={onFlyTo}
          onFocusSpecies={onFocusSpecies}
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
        />
      )}

      {hotspotPanel && (
        <HotspotPanel
          hotspot={hotspotPanel}
          lifeList={lifeList}
          onClose={onCloseHotspotPanel}
          onAddToLifeList={onAddToLifeList}
          lightMode={lm}
        />
      )}
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

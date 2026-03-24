'use client';

import type { ClassifiedObservation, AppSettings, Hotspot, TargetSpecies } from '@/lib/ebird';
import type { SpeciesMeta } from '@/lib/lifelist';
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
  onAddToLifeList: (code: string, name: string) => void;
  onRemoveFromLifeList: (code: string) => void;
  onAddToYearList: (code: string, name: string) => void;
  onRemoveFromYearList: (code: string) => void;
  onBulkImport: (lifeCodes: string[], yearCodes: string[], meta: Record<string, SpeciesMeta>) => void;
  onClearLifeList: () => void;
  onClearYearList: () => void;
  onSettingsChange: (s: AppSettings) => void;
  onRefreshNow: () => void;
  onHotspotDetail: (hs: Hotspot) => void;
  onCloseHotspotPanel: () => void;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'alerts', label: 'Alerts', icon: '📡' },
  { id: 'lifelist', label: 'Life List', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function Sidebar(props: Props) {
  const {
    activeTab,
    onTabChange,
    isMobile,
    drawerOpen,
    observations,
    lifeList,
    yearList,
    lifeListMeta,
    targetSpecies,
    hotspotPanel,
    settings,
    apiStatus,
    loading,
    userCenter,
    focusedSpecies,
    onFlyTo,
    onFocusSpecies,
    onAddToLifeList,
    onRemoveFromLifeList,
    onAddToYearList,
    onRemoveFromYearList,
    onBulkImport,
    onClearLifeList,
    onClearYearList,
    onSettingsChange,
    onRefreshNow,
    onHotspotDetail,
    onCloseHotspotPanel,
  } = props;

  const lm = settings.lightMode;

  const pendingAlerts = observations.filter(
    (o) => o.tier === 'lifer-rare' || o.tier === 'lifer' || o.tier === 'rare'
  ).length;

  // Light mode style tokens
  const sidebarBg = lm ? '#f4f6f8' : '#0d1520';
  const sidebarBorder = lm ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
  const headerBorder = lm ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)';
  const logoColor = lm ? '#1a2332' : '#f0f8ff';
  const subtitleColor = lm ? '#718096' : '#334455';
  const tabActiveColor = '#f5a623';
  const tabInactiveColor = lm ? '#718096' : '#445566';

  function handleToggleYearList(active: boolean) {
    onSettingsChange({ ...settings, yearListActive: active });
  }

  // ─── Shared panel content ────────────────────────────────────────────────
  const panelContent = (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {activeTab === 'alerts' && (
        <AlertsPanel
          observations={observations}
          targetSpecies={targetSpecies}
          yearListActive={settings.yearListActive}
          lightMode={lm}
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

      {/* Hotspot detail panel — overlays any tab */}
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
        {/* Bottom drawer panel — slides up/down */}
        <div
          style={{
            position: 'fixed',
            bottom: 56, // height of tab bar below
            left: 0,
            right: 0,
            height: '62vh',
            zIndex: 1199,
            background: sidebarBg,
            borderTop: `1px solid ${headerBorder}`,
            borderRadius: '12px 12px 0 0',
            transform: drawerOpen ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.35)',
          }}
        >
          {/* Drag handle */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              paddingTop: 10,
              paddingBottom: 6,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: lm ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)',
              }}
            />
          </div>
          {panelContent}
        </div>

        {/* Fixed bottom tab bar */}
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1200,
            background: sidebarBg,
            borderTop: `1px solid ${sidebarBorder}`,
            display: 'flex',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {TABS.map((tab) => {
            const active = tab.id === activeTab && drawerOpen;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                style={{
                  flex: 1,
                  minHeight: 56,
                  background: 'transparent',
                  border: 'none',
                  borderTop: `2px solid ${active ? tabActiveColor : 'transparent'}`,
                  color: active ? tabActiveColor : tabInactiveColor,
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: active ? 700 : 400,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  transition: 'color 0.15s',
                  position: 'relative',
                  paddingTop: 8,
                  paddingBottom: 6,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span style={{ fontSize: 18 }}>{tab.icon}</span>
                <span style={{ fontFamily: 'var(--font-dm-sans, sans-serif)', fontSize: 10, letterSpacing: '0.04em' }}>
                  {tab.label}
                </span>
                {tab.id === 'alerts' && pendingAlerts > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: '50%',
                      transform: 'translateX(10px)',
                      background: '#f5a623',
                      color: '#0a0e14',
                      fontSize: 8,
                      fontWeight: 800,
                      borderRadius: 8,
                      padding: '1px 4px',
                      fontFamily: 'var(--font-jb-mono, monospace)',
                    }}
                  >
                    {pendingAlerts}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </>
    );
  }

  // ─── Desktop layout (unchanged) ───────────────────────────────────────────
  return (
    <div
      style={{
        width: 380,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: sidebarBg,
        borderRight: `1px solid ${sidebarBorder}`,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px 10px',
          borderBottom: `1px solid ${headerBorder}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🦅</span>
          <div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: logoColor,
                letterSpacing: '0.05em',
                fontFamily: 'var(--font-jb-mono, monospace)',
              }}
            >
              BIRDRADAR
            </div>
            <div
              style={{
                fontSize: 10,
                color: subtitleColor,
                letterSpacing: '0.12em',
                fontFamily: 'var(--font-jb-mono, monospace)',
              }}
            >
              LIVE · BIRDRADAR
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${headerBorder}`,
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              style={{
                flex: 1,
                padding: '9px 4px',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? tabActiveColor : 'transparent'}`,
                color: active ? tabActiveColor : tabInactiveColor,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: active ? 700 : 400,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                transition: 'color 0.15s',
                position: 'relative',
              }}
            >
              <span style={{ fontSize: 13 }}>{tab.icon}</span>
              <span style={{ fontFamily: 'var(--font-dm-sans, sans-serif)' }}>{tab.label}</span>
              {tab.id === 'alerts' && pendingAlerts > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: 5,
                    right: 8,
                    background: '#f5a623',
                    color: '#0a0e14',
                    fontSize: 9,
                    fontWeight: 800,
                    borderRadius: 8,
                    padding: '1px 5px',
                    fontFamily: 'var(--font-jb-mono, monospace)',
                  }}
                >
                  {pendingAlerts}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {panelContent}
    </div>
  );
}

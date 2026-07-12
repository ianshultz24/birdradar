'use client';

import { useState } from 'react';
import type { AppSettings } from '@/lib/ebird';
import { requestNotificationPermission } from '@/lib/notifications';
import { getTheme, type Theme } from '@/lib/theme';
import { RefreshCwIcon, WifiIcon, WifiOffIcon } from '@/components/Icons';

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  apiStatus: 'ok' | 'error' | 'loading';
  onRefreshNow: () => void;
  loading: boolean;
}

export default function SettingsPanel({ settings, onChange, apiStatus, onRefreshNow, loading }: Props) {
  const t = getTheme(settings.lightMode);
  const [refreshHov, setRefreshHov] = useState(false);

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  const statusColor = loading ? t.accent
    : apiStatus === 'ok' ? t.lifer
    : apiStatus === 'error' ? '#EF4444'
    : t.fg4;

  const statusLabel = loading ? 'Fetching data…'
    : apiStatus === 'ok' ? 'Connected to eBird'
    : apiStatus === 'error' ? 'Connection error'
    : 'Idle';

  const KM_PER_MI = 1.609344;
  const sliderMin = 5;
  const sliderMax = settings.useMetric ? 50 : 30;
  const sliderStep = 5;
  const sliderUnit = settings.useMetric ? 'km' : 'mi';
  // Convert stored km to display unit, snap to step grid, then clamp to [min, max]
  const rawDisplay = settings.useMetric
    ? settings.searchRadius
    : settings.searchRadius / KM_PER_MI;
  const sliderValue = Math.min(sliderMax, Math.max(sliderMin,
    Math.round(rawDisplay / sliderStep) * sliderStep));
  const radiusDisplay = `${sliderValue} ${sliderUnit}`;
  const minLabel = `${sliderMin} ${sliderUnit}`;
  const maxLabel = `${sliderMax} ${sliderUnit}`;
  const alertRadiusLabel = settings.useMetric ? 'within 16 km' : 'within 10 mi';

  return (
    <div style={{ overflowY: 'auto', height: '100%', background: t.bg1 }}>

      <Group label="Map Display" t={t}>
        <Row t={t}>
          <RowToggle label="Show hotspot markers" checked={settings.showHotspots}
            onChange={v => set('showHotspots', v)} t={t}/>
        </Row>
        <Row t={t}>
          <RowToggle label="Dim already-seen species" checked={settings.dimSeenSpecies}
            onChange={v => set('dimSeenSpecies', v)} t={t}/>
        </Row>
        <Row t={t}>
          <RowToggle label="Lifer pulse animation" checked={settings.liferPulse}
            onChange={v => set('liferPulse', v)} t={t}/>
        </Row>
        <Row t={t} last>
          <RowToggle label="Radar animation" checked={settings.showRadarAnimation}
            onChange={v => set('showRadarAnimation', v)} t={t}/>
        </Row>
      </Group>

      <Group label="Appearance" t={t}>
        <Row t={t} last>
          <RowToggle label="Light mode" checked={settings.lightMode}
            onChange={v => set('lightMode', v)} t={t}/>
        </Row>
      </Group>

      <Group label="Units" t={t}>
        <div style={{ padding: '8px 20px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {([
            { value: true, label: 'Metric (km, m)' },
            { value: false, label: 'Imperial (mi, ft)' },
          ] as const).map(({ value, label }) => (
            <UnitRadioRow
              key={String(value)}
              label={label}
              checked={settings.useMetric === value}
              onSelect={() => set('useMetric', value)}
              t={t}
            />
          ))}
        </div>
      </Group>

      <Group label="Search" t={t}>
        <div style={{ padding: '12px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: t.fg1, fontFamily: t.sans }}>Search radius</span>
            <span style={{ fontFamily: t.mono, fontSize: 12, color: t.accent, fontWeight: 600 }}>
              {radiusDisplay}
            </span>
          </div>
          <input
            type="range" min={sliderMin} max={sliderMax} step={sliderStep}
            value={sliderValue}
            onChange={e => {
              const v = Number(e.target.value);
              set('searchRadius', settings.useMetric ? v : v * KM_PER_MI);
            }}
            style={{ width: '100%', accentColor: t.accent }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10, color: t.fg3, fontFamily: t.mono }}>
            <span>{minLabel}</span><span>{maxLabel}</span>
          </div>
        </div>
      </Group>

      <Group label="Auto-Refresh" t={t}>
        <div style={{ padding: '8px 20px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {([0, 5, 15, 30] as const).map(v => (
            <AutoRefreshRow
              key={v}
              value={v}
              selected={settings.autoRefresh === v}
              onSelect={() => set('autoRefresh', v)}
              t={t}
            />
          ))}
        </div>
      </Group>

      <Group label="Alerts" t={t}>
        <Row t={t}>
          <RowToggle
            label={`Lifer alerts ${alertRadiusLabel}`}
            checked={settings.notificationsEnabled}
            onChange={async v => { if (v) await requestNotificationPermission(); set('notificationsEnabled', v); }}
            t={t}
          />
        </Row>
        {settings.notificationsEnabled && (
          <Row t={t}>
            <RowToggle label="Sound alerts" checked={settings.soundEnabled}
              onChange={v => set('soundEnabled', v)} t={t}/>
          </Row>
        )}
        <div style={{ padding: '6px 20px 12px', fontSize: 11, color: t.fg3, fontFamily: t.mono }}>
          Fires once per species per session
        </div>
      </Group>

      <Group label="Data Source" t={t}>
        <div style={{ padding: '12px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0 }}/>
            <span style={{ fontSize: 13, color: t.fg1, fontFamily: t.sans }}>{statusLabel}</span>
            {apiStatus === 'ok'
              ? <WifiIcon size={14} style={{ color: t.lifer, marginLeft: 'auto' }}/>
              : apiStatus === 'error'
              ? <WifiOffIcon size={14} style={{ color: '#EF4444', marginLeft: 'auto' }}/>
              : null}
          </div>
          <button
            onClick={onRefreshNow}
            disabled={loading}
            onMouseEnter={() => setRefreshHov(true)}
            onMouseLeave={() => setRefreshHov(false)}
            style={{
              width: '100%', padding: '9px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              background: loading ? t.bg2 : refreshHov ? t.accentBorder : t.accentBg,
              border: `1px solid ${loading ? t.line2 : t.accentBorder}`,
              borderRadius: 8,
              color: loading ? t.fg3 : t.accent,
              fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: t.sans, transition: 'all 0.15s',
            }}
          >
            <RefreshCwIcon size={14}/>
            {loading ? 'Refreshing…' : 'Refresh Now'}
          </button>
        </div>
      </Group>

      <Group label="Marker Legend" t={t}>
        <div style={{ padding: '10px 20px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Lifer — green pin, pulses */}
          <LegendRow t={t} label="Lifer (new species)" pulse>
            <svg width="12" height="16" viewBox="0 0 12 16" style={{ flexShrink: 0 }}>
              <path d="M6 0C2.69 0 0 2.69 0 6c0 4.67 6 10 6 10s6-5.33 6-10C12 2.69 9.31 0 6 0z"
                fill="#059669" opacity="0.9"/>
              <circle cx="6" cy="5.5" r="2" fill="white" opacity="0.8"/>
            </svg>
          </LegendRow>
          {/* Lifer + Rare — red pin, pulses */}
          <LegendRow t={t} label="Lifer + Rare (new + eBird notable)" pulse>
            <svg width="12" height="16" viewBox="0 0 12 16" style={{ flexShrink: 0 }}>
              <path d="M6 0C2.69 0 0 2.69 0 6c0 4.67 6 10 6 10s6-5.33 6-10C12 2.69 9.31 0 6 0z"
                fill="#DC2626" opacity="0.9"/>
              <circle cx="6" cy="5.5" r="2" fill="white" opacity="0.8"/>
            </svg>
          </LegendRow>
          {/* Rare — red pin, no pulse */}
          <LegendRow t={t} label="Rare (eBird notable, already seen)">
            <svg width="12" height="16" viewBox="0 0 12 16" style={{ flexShrink: 0 }}>
              <path d="M6 0C2.69 0 0 2.69 0 6c0 4.67 6 10 6 10s6-5.33 6-10C12 2.69 9.31 0 6 0z"
                fill="#DC2626" opacity="0.65"/>
              <circle cx="6" cy="5.5" r="2" fill="white" opacity="0.8"/>
            </svg>
          </LegendRow>
          {/* Seen — gray pin */}
          <LegendRow t={t} label="Previously seen">
            <svg width="12" height="16" viewBox="0 0 12 16" style={{ flexShrink: 0 }}>
              <path d="M6 0C2.69 0 0 2.69 0 6c0 4.67 6 10 6 10s6-5.33 6-10C12 2.69 9.31 0 6 0z"
                fill="#9CA3AF" opacity="0.75"/>
              <circle cx="6" cy="5.5" r="2" fill="white" opacity="0.8"/>
            </svg>
          </LegendRow>
          {/* Hotspot — colored dot */}
          <LegendRow t={t} label="Hotspot (heatmap by species count)">
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: 'linear-gradient(135deg, #f5a623, #ef4444)',
              border: '1.5px solid rgba(255,255,255,0.4)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
              flexShrink: 0,
            }}/>
          </LegendRow>
        </div>
      </Group>
    </div>
  );
}

function Group({ label, t, children }: { label: string; t: Theme; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        padding: '11px 20px', background: t.bg2,
        borderTop: `1px solid ${t.line1}`, borderBottom: `1px solid ${t.line1}`,
        fontSize: 11, fontWeight: 600, color: t.fg1,
        letterSpacing: '0.04em', fontFamily: t.sans,
      }}>{label}</div>
      {children}
    </div>
  );
}

function Row({ t, last, children }: { t: Theme; last?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: last ? 'none' : `1px solid ${t.line1}` }}>
      {children}
    </div>
  );
}

function RowToggle({ label, checked, onChange, t }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  t: Theme;
}) {
  const [hov, setHov] = useState(false);

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '13px 20px',
        background: hov ? t.bg2 : 'transparent',
        transition: 'background 0.12s',
        cursor: 'pointer',
      }}
      onClick={() => onChange(!checked)}
    >
      <span style={{ fontSize: 13, color: t.fg1, fontFamily: t.sans }}>{label}</span>
      <div
        style={{
          width: 36, height: 20, borderRadius: 12, flexShrink: 0,
          background: checked ? t.accent : t.bg3,
          position: 'relative',
          transition: 'background 0.2s',
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: checked ? t.accentFg : t.fg3,
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
          transition: 'left 0.2s, background 0.2s',
        }}/>
      </div>
    </div>
  );
}

function UnitRadioRow({ label, checked, onSelect, t }: {
  label: string;
  checked: boolean;
  onSelect: () => void;
  t: Theme;
}) {
  const [hov, setHov] = useState(false);

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        cursor: 'pointer', padding: '6px 0',
        background: hov ? t.bg2 : 'transparent',
        borderRadius: 6, marginLeft: -4, paddingLeft: 4,
        transition: 'background 0.12s',
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${checked ? t.accent : t.line3}`,
        background: checked ? t.accent : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}>
        {checked && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.accentFg }}/>
        )}
      </span>
      <span style={{ fontSize: 13, color: t.fg1, fontFamily: t.sans }}>{label}</span>
    </div>
  );
}

function AutoRefreshRow({ value, selected, onSelect, t }: {
  value: 0 | 5 | 15 | 30;
  selected: boolean;
  onSelect: () => void;
  t: Theme;
}) {
  const [hov, setHov] = useState(false);

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        cursor: 'pointer', padding: '6px 0',
        background: hov ? t.bg2 : 'transparent',
        borderRadius: 6, marginLeft: -4, paddingLeft: 4,
        transition: 'background 0.12s',
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${selected ? t.accent : t.line3}`,
        background: selected ? t.accent : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}>
        {selected && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.accentFg }}/>
        )}
      </span>
      <span style={{ fontSize: 13, color: t.fg1, fontFamily: t.sans }}>
        {value === 0 ? 'Off' : `Every ${value} minutes`}
      </span>
    </div>
  );
}

function LegendRow({ t, label, children, pulse }: { t: Theme; label: string; children: React.ReactNode; pulse?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {children}
      </div>
      <span style={{ fontSize: 12, color: t.fg1, fontFamily: t.sans, flex: 1 }}>{label}</span>
      {pulse && (
        <span style={{
          fontSize: 9, fontFamily: t.mono, color: t.accent,
          background: t.accentBg, border: `1px solid ${t.accentBorder}`,
          borderRadius: 4, padding: '1px 5px', letterSpacing: '0.04em', flexShrink: 0,
        }}>pulse</span>
      )}
    </div>
  );
}

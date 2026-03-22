'use client';

import type { AppSettings } from '@/lib/ebird';
import { requestNotificationPermission } from '@/lib/notifications';

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  apiStatus: 'ok' | 'error' | 'loading';
  onRefreshNow: () => void;
  loading: boolean;
}

export default function SettingsPanel({
  settings,
  onChange,
  apiStatus,
  onRefreshNow,
  loading,
}: Props) {
  const lm = settings.lightMode;

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  // Style tokens for light/dark
  const groupBorder = lm ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
  const groupLabelColor = lm ? '#718096' : '#445566';
  const labelColor = lm ? '#4a5568' : '#aabbcc';
  const monoMuted = lm ? '#a0aec0' : '#334455';

  return (
    <div style={{ padding: '4px 0', overflowY: 'auto', height: '100%' }}>

      {/* Map Display */}
      <SettingsGroup label="Map Display" border={groupBorder} labelColor={groupLabelColor}>
        <Toggle
          label="Show hotspot markers"
          checked={settings.showHotspots}
          onChange={(v) => set('showHotspots', v)}
          labelColor={labelColor}
        />
        <Toggle
          label="Dim already-seen species"
          checked={settings.dimSeenSpecies}
          onChange={(v) => set('dimSeenSpecies', v)}
          labelColor={labelColor}
        />
        <Toggle
          label="Lifer pulse animation"
          checked={settings.liferPulse}
          onChange={(v) => set('liferPulse', v)}
          labelColor={labelColor}
        />
        <Toggle
          label="Light mode"
          checked={settings.lightMode}
          onChange={(v) => set('lightMode', v)}
          labelColor={labelColor}
        />
        <Toggle
          label="Show radius circle"
          checked={settings.showRadiusCircle}
          onChange={(v) => set('showRadiusCircle', v)}
          labelColor={labelColor}
        />
      </SettingsGroup>

      {/* Search radius (miles) */}
      <SettingsGroup label="Search" border={groupBorder} labelColor={groupLabelColor}>
        <div style={{ padding: '4px 14px 10px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 8,
              fontSize: 13,
              color: labelColor,
            }}
          >
            <span>Search radius</span>
            <span
              style={{
                fontFamily: 'var(--font-jb-mono, monospace)',
                color: '#f5a623',
                fontWeight: 700,
              }}
            >
              {settings.searchRadius} km
            </span>
          </div>
          <input
            type="range"
            min={5}
            max={50}
            step={5}
            value={settings.searchRadius}
            onChange={(e) => set('searchRadius', Number(e.target.value))}
            style={{ width: '100%', accentColor: '#f5a623' }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10,
              color: monoMuted,
              fontFamily: 'var(--font-jb-mono, monospace)',
              marginTop: 4,
            }}
          >
            <span>5 km</span>
            <span>50 km</span>
          </div>
        </div>
      </SettingsGroup>

      {/* Auto-refresh */}
      <SettingsGroup label="Auto-Refresh" border={groupBorder} labelColor={groupLabelColor}>
        <div style={{ padding: '4px 14px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {([0, 5, 15, 30] as const).map((v) => (
            <label
              key={v}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                padding: '4px 0',
              }}
            >
              <input
                type="radio"
                name="autoRefresh"
                value={v}
                checked={settings.autoRefresh === v}
                onChange={() => set('autoRefresh', v)}
                style={{ accentColor: '#f5a623' }}
              />
              <span style={{ fontSize: 13, color: labelColor }}>
                {v === 0 ? 'Off' : `Every ${v} minutes`}
              </span>
            </label>
          ))}
        </div>
      </SettingsGroup>

      {/* Alerts */}
      <SettingsGroup label="Alerts" border={groupBorder} labelColor={groupLabelColor}>
        <Toggle
          label="Enable lifer alerts (within 10 mi)"
          checked={settings.notificationsEnabled}
          onChange={async (v) => {
            if (v) await requestNotificationPermission();
            set('notificationsEnabled', v);
          }}
          labelColor={labelColor}
        />
        {settings.notificationsEnabled && (
          <Toggle
            label="Sound alerts"
            checked={settings.soundEnabled}
            onChange={(v) => set('soundEnabled', v)}
            labelColor={labelColor}
          />
        )}
        <div
          style={{
            padding: '4px 14px 10px',
            fontSize: 11,
            color: monoMuted,
            fontFamily: 'var(--font-jb-mono, monospace)',
            letterSpacing: '0.04em',
          }}
        >
          Fires once per species per session
        </div>
      </SettingsGroup>

      {/* API Status */}
      <SettingsGroup label="API Status" border={groupBorder} labelColor={groupLabelColor}>
        <div style={{ padding: '8px 14px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background:
                  loading
                    ? '#f5a623'
                    : apiStatus === 'ok'
                    ? '#3ecfb4'
                    : apiStatus === 'error'
                    ? '#ef4444'
                    : '#4b5563',
                boxShadow:
                  !loading && apiStatus === 'ok'
                    ? '0 0 6px #3ecfb4'
                    : undefined,
              }}
            />
            <span style={{ fontSize: 13, color: labelColor }}>
              {loading
                ? 'Fetching data…'
                : apiStatus === 'ok'
                ? 'Connected to eBird'
                : apiStatus === 'error'
                ? 'Connection error'
                : 'Idle'}
            </span>
          </div>
          <button
            onClick={onRefreshNow}
            disabled={loading}
            style={{
              width: '100%',
              padding: '8px 0',
              background: loading ? 'rgba(255,255,255,0.04)' : 'rgba(245,166,35,0.1)',
              border: `1px solid ${loading ? 'rgba(255,255,255,0.08)' : 'rgba(245,166,35,0.3)'}`,
              borderRadius: 5,
              color: loading ? '#334455' : '#f5a623',
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            {loading ? 'Refreshing…' : 'Refresh Now'}
          </button>
        </div>
      </SettingsGroup>

      {/* Legend */}
      <SettingsGroup label="Marker Legend" border={groupBorder} labelColor={groupLabelColor}>
        <div style={{ padding: '6px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { color: '#60a5fa', label: 'Lifer + Rare', pulse: true },
            { color: '#60a5fa', label: 'Lifer (common)', pulse: false },
            { color: '#e2e8f0', label: 'Rare seen (pulsing)', pulse: true, white: true },
            { color: '#e2e8f0', label: 'Already seen', pulse: false, white: true },
            { color: '#f5a623', label: 'Hotspot (heatmap)', diamond: true },
          ].map(({ color, label, pulse, diamond, white }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: diamond ? 0 : '50%',
                  transform: diamond ? 'rotate(45deg)' : undefined,
                  background: color,
                  border: white ? '1px solid rgba(100,116,139,0.5)' : undefined,
                  boxShadow: `0 0 ${pulse ? '8px' : '4px'} ${color}88`,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, color: labelColor }}>{label}</span>
              {pulse && (
                <span
                  style={{
                    fontSize: 9,
                    fontFamily: 'var(--font-jb-mono, monospace)',
                    color: '#aabbcc77',
                    marginLeft: 2,
                  }}
                >
                  PULSE
                </span>
              )}
            </div>
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}

function SettingsGroup({
  label,
  border,
  labelColor,
  children,
}: {
  label: string;
  border: string;
  labelColor: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: `1px solid ${border}`, paddingBottom: 2 }}>
      <div
        style={{
          padding: '10px 14px 6px',
          fontSize: 10,
          letterSpacing: '0.1em',
          color: labelColor,
          fontFamily: 'var(--font-jb-mono, monospace)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  labelColor,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  labelColor: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 14px',
        cursor: 'pointer',
        borderBottom: '1px solid rgba(128,128,128,0.06)',
      }}
    >
      <span style={{ fontSize: 13, color: labelColor }}>{label}</span>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          background: checked ? 'rgba(245,166,35,0.3)' : 'rgba(128,128,128,0.12)',
          border: `1px solid ${checked ? 'rgba(245,166,35,0.5)' : 'rgba(128,128,128,0.15)'}`,
          position: 'relative',
          cursor: 'pointer',
          transition: 'background 0.2s, border-color 0.2s',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: checked ? '#f5a623' : '#4b5563',
            transition: 'left 0.2s, background 0.2s',
            boxShadow: checked ? '0 0 4px #f5a62366' : undefined,
          }}
        />
      </div>
    </label>
  );
}

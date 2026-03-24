'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';

import type { ClassifiedObservation, Hotspot } from '@/lib/ebird';
import type { AppSettings } from '@/lib/ebird';
import { timeAgo } from '@/lib/ebird';
import { getTierMapColor } from '@/lib/classify';
import RadarOverlay from './RadarOverlay';
import RadarPositionSync from './RadarPositionSync';

// ─── Heatmap color helper ─────────────────────────────────────────────────────

function lerpColor(a: string, b: string, t: number): string {
  const ah = a.replace('#', '');
  const bh = b.replace('#', '');
  const ar = parseInt(ah.slice(0, 2), 16);
  const ag = parseInt(ah.slice(2, 4), 16);
  const ab = parseInt(ah.slice(4, 6), 16);
  const br = parseInt(bh.slice(0, 2), 16);
  const bg = parseInt(bh.slice(2, 4), 16);
  const bb = parseInt(bh.slice(4, 6), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function hotspotHeatColor(ratio: number): string {
  // 0.0 → gray, 0.33 → gold, 0.66 → orange, 1.0 → red
  if (ratio < 0.33) return lerpColor('#556677', '#f5a623', ratio / 0.33);
  if (ratio < 0.66) return lerpColor('#f5a623', '#ff7043', (ratio - 0.33) / 0.33);
  return lerpColor('#ff7043', '#ef4444', (ratio - 0.66) / 0.34);
}

// ─── Tier sort order (lower = higher priority) ────────────────────────────
const TIER_ORDER: Record<string, number> = { 'lifer-rare': 0, 'lifer': 1, 'rare': 2, 'seen': 3 };

// ─── Icon factories ────────────────────────────────────────────────────────

function birdIcon(
  tier: ClassifiedObservation['tier'],
  pulse: boolean,
  opacity: number,
  focused = false,
  lightMode = false,
): L.DivIcon {
  const isSeenTier = tier === 'seen' || tier === 'rare';
  const isRareTier = tier === 'lifer-rare' || tier === 'rare';

  // Map dot color: white-ish for seen tiers, blue for lifer tiers
  const color = getTierMapColor(tier, lightMode);

  const baseSize = isRareTier ? 14 : 10;
  const size = focused ? baseSize + 4 : baseSize;

  // Glow: softer for white markers, brighter for blue
  const glow = isSeenTier
    ? (lightMode
        ? `0 0 5px rgba(100,116,139,0.4)`
        : `0 0 8px rgba(226,232,240,0.5), 0 0 16px rgba(226,232,240,0.25)`)
    : (isRareTier
        ? `0 0 10px ${color}, 0 0 20px ${color}66`
        : `0 0 6px ${color}88`);

  // Pulse class: blue for rare lifers, white for rare seen
  const pulseClass = pulse && isRareTier
    ? (isSeenTier ? ' bird-pulse-white' : ' bird-pulse-blue')
    : '';

  const ring = focused ? `outline:2px solid ${color};outline-offset:2px;` : '';
  const border = isSeenTier
    ? `1.5px solid ${lightMode ? 'rgba(100,116,139,0.4)' : 'rgba(226,232,240,0.25)'}`
    : `1.5px solid ${color}cc`;

  return L.divIcon({
    className: '',
    html: `<div class="bird-marker${pulseClass}" style="width:${size}px;height:${size}px;border-radius:50%;background:${color};box-shadow:${glow};opacity:${opacity};border:${border};${ring}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

function hotspotIcon(ratio: number): L.DivIcon {
  const color = hotspotHeatColor(ratio);
  const size = 14;
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;background:${color};transform:rotate(45deg);border:1px solid rgba(255,255,255,0.35);box-shadow:0 0 7px ${color}99;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -10],
  });
}

function userLocationIcon(): L.DivIcon {
  const size = 16;
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 2px #3b82f6,0 0 12px #3b82f688;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

function pinDropIcon(): L.DivIcon {
  const size = 22;
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;background:#f5a623;transform:rotate(45deg);border:2px solid rgba(255,255,255,0.8);box-shadow:0 0 14px #f5a62399,0 2px 8px rgba(0,0,0,0.5);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -14],
  });
}

// ─── RecenterController: fires flyTo when trigger increments ─────────────────

function RecenterController({ target, trigger }: { target: [number, number]; trigger: number }) {
  const map = useMap();
  const prev = useRef(-1);
  useEffect(() => {
    if (trigger > 0 && trigger !== prev.current) {
      prev.current = trigger;
      map.flyTo(target, Math.max(map.getZoom(), 12), { animate: true, duration: 1.0 });
    }
  }, [trigger, target, map]);
  return null;
}

// ─── MapClickHandler: captures map clicks in pin-drop mode ──────────────────

function MapClickHandler({ active, onMapClick }: { active: boolean; onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (active) onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ─── CursorController: sets map cursor based on pin mode ─────────────────────

function CursorController({ isPinMode }: { isPinMode: boolean }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().style.cursor = isPinMode ? 'crosshair' : '';
  }, [isPinMode, map]);
  return null;
}

// ─── MapController: drives flyTo ────────────────────────────────────────────

function MapController({ target }: { target: [number, number] | null }) {
  const map = useMap();
  const prevTarget = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (
      target &&
      (prevTarget.current?.[0] !== target[0] ||
        prevTarget.current?.[1] !== target[1])
    ) {
      map.flyTo(target, 14, { animate: true, duration: 1.2 });
      prevTarget.current = target;
    }
  }, [target, map]);

  return null;
}

// ─── Observation Popup ───────────────────────────────────────────────────────

function ObsPopup({
  obs,
  onAddToLifeList,
  isOnLifeList,
  lightMode,
}: {
  obs: ClassifiedObservation;
  onAddToLifeList: (code: string, name: string, sciName?: string, date?: string, location?: string) => void;
  isOnLifeList: boolean;
  lightMode: boolean;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDate, setAddDate] = useState('');
  const [addLoc, setAddLoc] = useState('');

  function openForm() {
    setAddDate(obs.obsDt.split(' ')[0]);
    setAddLoc(obs.locName);
    setShowAddForm(true);
  }

  function confirmAdd() {
    onAddToLifeList(obs.speciesCode, obs.comName, obs.sciName, addDate, addLoc);
    setShowAddForm(false);
  }
  const tierColors: Record<string, string> = {
    'lifer-rare': '#60a5fa',
    'lifer':      '#60a5fa',
    'rare':       '#94a3b8',
    'seen':       '#6b7280',
  };
  const tierLabels: Record<string, string> = {
    'lifer-rare': 'LIFER + RARE',
    'lifer':      'LIFER',
    'rare':       'RARE SEEN',
    'seen':       'SEEN',
  };
  const color = tierColors[obs.tier];
  const textPrimary = lightMode ? '#1a2332' : '#f0f4f8';
  const textSecondary = lightMode ? '#4a5568' : '#8899aa';
  const textMuted = lightMode ? '#718096' : '#aabbcc';

  return (
    <div style={{ fontFamily: 'var(--font-dm-sans, sans-serif)', minWidth: 200, maxWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-jb-mono, monospace)',
            background: color + '22',
            color,
            border: `1px solid ${color}44`,
            borderRadius: 3,
            padding: '1px 5px',
            letterSpacing: '0.08em',
          }}
        >
          {tierLabels[obs.tier]}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: textPrimary, marginBottom: 2 }}>
        {obs.comName}
      </div>
      <div style={{ fontSize: 12, color: textSecondary, fontStyle: 'italic', marginBottom: 8 }}>
        {obs.sciName}
      </div>
      <div style={{ fontSize: 12, color: textMuted, marginBottom: 3 }}>
        📍 {obs.locName}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          fontSize: 12,
          color: textSecondary,
          fontFamily: 'var(--font-jb-mono, monospace)',
          marginBottom: obs.reportCount && obs.reportCount > 1 ? 4 : 10,
        }}
      >
        <span>{obs.howMany ? `${obs.howMany}×` : '1×'}</span>
        <span>{timeAgo(obs.obsDt)}</span>
      </div>
      {obs.reportCount && obs.reportCount > 1 && (
        <div style={{ fontSize: 11, color: textMuted, fontFamily: 'var(--font-jb-mono, monospace)', marginBottom: 10 }}>
          Reported {obs.reportCount}× this week here
        </div>
      )}
      {!isOnLifeList ? (
        !showAddForm ? (
          <button
            onClick={openForm}
            style={{
              width: '100%',
              padding: '6px 0',
              background: 'rgba(245,166,35,0.15)',
              border: '1px solid rgba(245,166,35,0.4)',
              borderRadius: 4,
              color: '#f5a623',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            + Add to Life List
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <input
              type="date"
              value={addDate}
              onChange={(e) => setAddDate(e.target.value)}
              style={{
                width: '100%',
                padding: '5px 8px',
                background: lightMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${lightMode ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 4,
                color: lightMode ? '#1a2332' : '#ddeeff',
                fontSize: 12,
                boxSizing: 'border-box',
              }}
            />
            <input
              type="text"
              value={addLoc}
              onChange={(e) => setAddLoc(e.target.value)}
              placeholder="Location"
              style={{
                width: '100%',
                padding: '5px 8px',
                background: lightMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${lightMode ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 4,
                color: lightMode ? '#1a2332' : '#ddeeff',
                fontSize: 12,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                onClick={confirmAdd}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  background: 'rgba(245,166,35,0.2)',
                  border: '1px solid rgba(245,166,35,0.5)',
                  borderRadius: 4,
                  color: '#f5a623',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✓ Confirm
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                style={{
                  padding: '5px 10px',
                  background: 'transparent',
                  border: `1px solid ${lightMode ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                  borderRadius: 4,
                  color: lightMode ? '#718096' : '#8899aa',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )
      ) : (
        <div
          style={{
            textAlign: 'center',
            fontSize: 11,
            color: '#4b5563',
            padding: '5px 0',
            fontFamily: 'var(--font-jb-mono, monospace)',
          }}
        >
          ✓ On life list
        </div>
      )}
    </div>
  );
}

// ─── Multi-obs popup (multiple species at same location) ─────────────────────

function MultiObsPopup({
  observations,
  onAddToLifeList,
  lifeSet,
  lightMode,
}: {
  observations: ClassifiedObservation[];
  onAddToLifeList: (code: string, name: string, sciName?: string, date?: string, location?: string) => void;
  lifeSet: Set<string>;
  lightMode: boolean;
}) {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, observations.length - 1);
  const obs = observations[safeIndex];

  const textMuted = lightMode ? '#718096' : '#8899aa';
  const navBg = lightMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)';
  const navBorder = lightMode ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.09)';

  return (
    <div>
      {observations.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
            background: navBg,
            border: `1px solid ${navBorder}`,
            borderRadius: 5,
            padding: '3px 6px',
          }}
        >
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={safeIndex === 0}
            style={{
              background: 'none',
              border: 'none',
              cursor: safeIndex === 0 ? 'default' : 'pointer',
              color: safeIndex === 0 ? textMuted : '#f5a623',
              fontSize: 18,
              fontWeight: 700,
              padding: '0 4px',
              lineHeight: 1,
              opacity: safeIndex === 0 ? 0.3 : 1,
            }}
          >
            ‹
          </button>
          <span
            style={{
              fontSize: 10,
              color: textMuted,
              fontFamily: 'var(--font-jb-mono, monospace)',
              letterSpacing: '0.06em',
            }}
          >
            {safeIndex + 1} / {observations.length} species here
          </span>
          <button
            onClick={() => setIndex((i) => Math.min(observations.length - 1, i + 1))}
            disabled={safeIndex === observations.length - 1}
            style={{
              background: 'none',
              border: 'none',
              cursor: safeIndex === observations.length - 1 ? 'default' : 'pointer',
              color: safeIndex === observations.length - 1 ? textMuted : '#f5a623',
              fontSize: 18,
              fontWeight: 700,
              padding: '0 4px',
              lineHeight: 1,
              opacity: safeIndex === observations.length - 1 ? 0.3 : 1,
            }}
          >
            ›
          </button>
        </div>
      )}
      <ObsPopup
        key={obs.speciesCode}
        obs={obs}
        onAddToLifeList={onAddToLifeList}
        isOnLifeList={lifeSet.has(obs.speciesCode)}
        lightMode={lightMode}
      />
    </div>
  );
}

// ─── Hotspot Popup ───────────────────────────────────────────────────────────

function HotspotPopupContent({
  hs,
  color,
  onMoreInfo,
  lightMode,
}: {
  hs: Hotspot;
  color: string;
  onMoreInfo: (hs: Hotspot) => void;
  lightMode: boolean;
}) {
  const textPrimary = lightMode ? '#1a2332' : '#f0f4f8';
  const textMuted = lightMode ? '#718096' : '#8899aa';

  return (
    <div style={{ fontFamily: 'var(--font-dm-sans, sans-serif)', minWidth: 190 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color, marginBottom: 4 }}>
        ◆ {hs.locName}
      </div>
      {hs.numSpeciesAllTime > 0 && (
        <div style={{ fontSize: 12, color: textMuted, fontFamily: 'var(--font-jb-mono, monospace)', marginBottom: 8 }}>
          {hs.numSpeciesAllTime} species all time
        </div>
      )}
      {hs.latestObsDt && (
        <div style={{ fontSize: 11, color: textMuted, marginBottom: 8 }}>
          Last obs: {timeAgo(hs.latestObsDt)}
        </div>
      )}
      <button
        onClick={() => onMoreInfo(hs)}
        style={{
          width: '100%',
          padding: '5px 0',
          background: `${color}18`,
          border: `1px solid ${color}44`,
          borderRadius: 4,
          color,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          letterSpacing: '0.04em',
        }}
      >
        More Info →
      </button>
      <div style={{ fontSize: 10, color: textMuted, marginTop: 4, textAlign: 'center', fontFamily: 'var(--font-jb-mono, monospace)' }}>
        {hs.locId}
      </div>
    </div>
  );
}

// ─── Main Map component ──────────────────────────────────────────────────────

export interface MapProps {
  center: [number, number];
  observations: ClassifiedObservation[];
  hotspots: Hotspot[];
  flyToTarget: [number, number] | null;
  settings: AppSettings;
  lifeList: string[];
  pinLocation: [number, number] | null;
  userLocation: [number, number] | null;
  focusedSpecies: { code: string; name: string } | null;
  isMobile?: boolean;
  onAddToLifeList: (code: string, name: string, sciName?: string, date?: string, location?: string) => void;
  onHotspotDetail: (hs: Hotspot) => void;
  onPinDrop: (lat: number, lng: number) => void;
  onClearPin: () => void;
}

export default function BirdMap({
  center,
  observations,
  hotspots,
  flyToTarget,
  settings,
  lifeList,
  pinLocation,
  userLocation,
  focusedSpecies,
  isMobile,
  onAddToLifeList,
  onHotspotDetail,
  onPinDrop,
  onClearPin,
}: MapProps) {
  const [isPinMode, setIsPinMode] = useState(false);
  const [reCenterTrigger, setReCenterTrigger] = useState(0);
  const [radarCenter, setRadarCenter] = useState({ x: 0, y: 0 });
  const [radarRadiusPx, setRadarRadiusPx] = useState(0);

  const handleRadarUpdate = useCallback((x: number, y: number, r: number) => {
    setRadarCenter({ x, y });
    setRadarRadiusPx(r);
  }, []);
  const reCenterTarget: [number, number] = userLocation ?? center;

  function handleMapClick(lat: number, lng: number) {
    onPinDrop(lat, lng);
    setIsPinMode(false);
  }
  const lifeSet = new Set(lifeList);
  const { lightMode } = settings;

  // When dimSeenSpecies is off, hide both 'seen' (common) and 'rare' (rare but seen) tiers
  const visibleObs = settings.dimSeenSpecies
    ? observations
    : observations.filter((o) => o.tier !== 'seen' && o.tier !== 'rare');

  // Count recent unique species per hotspot (fallback when numSpeciesAllTime is 0)
  const hotspotRecentSpecies = new Map<string, Set<string>>();
  for (const obs of observations) {
    if (obs.locId) {
      if (!hotspotRecentSpecies.has(obs.locId)) hotspotRecentSpecies.set(obs.locId, new Set());
      hotspotRecentSpecies.get(obs.locId)!.add(obs.speciesCode);
    }
  }
  const getHotspotHeat = (hs: typeof hotspots[0]) =>
    Math.max(hs.numSpeciesAllTime || 0, hotspotRecentSpecies.get(hs.locId)?.size ?? 0);

  const maxHeat = Math.max(...hotspots.map(getHotspotHeat), 1);

  const tileUrl = lightMode
    ? 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png'
    : 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png';

  const tileAttrib = '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  const lm = lightMode;
  const overlayBg = lm ? 'rgba(240,244,248,0.9)' : 'rgba(13,21,32,0.88)';
  const overlayBorder = lm ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)';
  const overlayText = lm ? '#1a2332' : '#ddeeff';

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
    <MapContainer
      center={center}
      zoom={11}
      style={{ height: '100%', width: '100%', background: lightMode ? '#e8ecf0' : '#0a0e14' }}
      zoomControl={false}
    >
      <TileLayer url={tileUrl} attribution={tileAttrib} maxZoom={20} />

      <MapController target={flyToTarget} />
      <RecenterController target={reCenterTarget} trigger={reCenterTrigger} />
      <MapClickHandler active={isPinMode} onMapClick={handleMapClick} />
      <CursorController isPinMode={isPinMode} />

      {/* Radar position sync — must be inside MapContainer for useMap() access */}
      {settings.showRadarAnimation && (
        <RadarPositionSync
          geoCenter={pinLocation ?? center}
          radiusKm={settings.searchRadius}
          onUpdate={handleRadarUpdate}
        />
      )}

      {/* Radius circle — search boundary outline only, no fill */}
      {settings.showRadiusCircle && (
        <Circle
          center={pinLocation ?? center}
          radius={settings.searchRadius * 1000}
          pathOptions={{
            color: '#f5a623',
            weight: 1.5,
            opacity: 0.55,
            fillOpacity: 0,
            dashArray: '6 4',
          }}
        />
      )}

      {/* Hotspot markers — rendered first so they sit behind bird markers */}
      {settings.showHotspots &&
        hotspots.map((hs) => {
          const ratio = Math.min(getHotspotHeat(hs) / maxHeat, 1);
          const color = hotspotHeatColor(ratio);
          return (
            <Marker
              key={hs.locId}
              position={[hs.lat, hs.lng]}
              icon={hotspotIcon(ratio)}
            >
              <Popup className="bird-popup">
                <HotspotPopupContent
                  hs={hs}
                  color={color}
                  onMoreInfo={onHotspotDetail}
                  lightMode={lightMode}
                />
              </Popup>
            </Marker>
          );
        })}

      {/* Bird sighting markers — grouped by location so overlapping species share one marker */}
      {(() => {
        // Group observations by location
        const groups = new Map<string, ClassifiedObservation[]>();
        for (const obs of visibleObs) {
          const key = obs.locId || obs.locName;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(obs);
        }
        // Within each group: focused species first, then by tier priority
        for (const group of groups.values()) {
          group.sort((a, b) => {
            const aFoc = focusedSpecies?.code === a.speciesCode ? -1 : 0;
            const bFoc = focusedSpecies?.code === b.speciesCode ? -1 : 0;
            if (aFoc !== bFoc) return aFoc - bFoc;
            return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
          });
        }
        return Array.from(groups.entries()).map(([locKey, group]) => {
          const repObs = group[0];
          const isFocused = !!(focusedSpecies && group.some((o) => o.speciesCode === focusedSpecies.code));
          const isSeenTier = repObs.tier === 'seen' || repObs.tier === 'rare';
          const baseOpacity = isSeenTier && settings.dimSeenSpecies ? 0.3 : 1;
          const focusOpacity = focusedSpecies && !isFocused ? 0.15 : 1;
          const opacity = baseOpacity * focusOpacity;
          return (
            <Marker
              key={locKey}
              position={[repObs.lat, repObs.lng]}
              icon={birdIcon(repObs.tier, settings.liferPulse, opacity, isFocused, settings.lightMode)}
            >
              <Popup className="bird-popup">
                <MultiObsPopup
                  observations={group}
                  onAddToLifeList={onAddToLifeList}
                  lifeSet={lifeSet}
                  lightMode={lightMode}
                />
              </Popup>
            </Marker>
          );
        });
      })()}

      {/* User location marker — only rendered once GPS fix is confirmed */}
      {userLocation && (
        <Marker position={userLocation} icon={userLocationIcon()} zIndexOffset={1000}>
          <Popup className="bird-popup">
            <div style={{ fontFamily: 'var(--font-dm-sans, sans-serif)', fontSize: 13, fontWeight: 600, color: '#3b82f6' }}>
              ◉ Your Location
            </div>
          </Popup>
        </Marker>
      )}

      {/* Pin drop marker */}
      {pinLocation && (
        <Marker position={pinLocation} icon={pinDropIcon()}>
          <Popup className="bird-popup">
            <div style={{ fontFamily: 'var(--font-dm-sans, sans-serif)', minWidth: 160 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#f5a623', marginBottom: 4 }}>
                ◆ Custom Search Pin
              </div>
              <div style={{ fontSize: 11, color: overlayText, opacity: 0.7, marginBottom: 8, fontFamily: 'var(--font-jb-mono, monospace)' }}>
                Showing birds within ~31mi (50km max)
              </div>
              <button
                onClick={onClearPin}
                style={{
                  width: '100%',
                  padding: '5px 0',
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.35)',
                  borderRadius: 4,
                  color: '#ef4444',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ✕ Clear Pin
              </button>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>

    {/* Radar canvas overlay — rendered outside MapContainer so it's a true DOM overlay */}
    {settings.showRadarAnimation && radarRadiusPx >= 20 && (
      <RadarOverlay
        centerX={radarCenter.x}
        centerY={radarCenter.y}
        radiusPx={radarRadiusPx}
        enabled={settings.showRadarAnimation}
      />
    )}

    {/* Pin drop overlay controls */}
    <div
      style={{
        position: 'absolute',
        bottom: isMobile ? 86 : 30,
        right: 10,
        zIndex: 1001,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'flex-end',
      }}
    >
      {/* Re-center button */}
      <button
        onClick={() => setReCenterTrigger((t) => t + 1)}
        title={userLocation ? 'Fly to your GPS location' : 'Fly to search center'}
        style={{
          padding: '7px 13px',
          background: overlayBg,
          border: `1px solid ${overlayBorder}`,
          borderRadius: 7,
          color: '#3b82f6',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
          letterSpacing: '0.03em',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          transition: 'all 0.15s',
        }}
      >
        ⊙ Re-center
      </button>
      <button
        onClick={() => setIsPinMode((v) => !v)}
        style={{
          padding: '7px 13px',
          background: isPinMode ? '#f5a623' : overlayBg,
          border: `1px solid ${isPinMode ? '#f5a623' : overlayBorder}`,
          borderRadius: 7,
          color: isPinMode ? '#0a0e14' : overlayText,
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
          letterSpacing: '0.03em',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          transition: 'all 0.15s',
        }}
      >
        {isPinMode ? '✕ Cancel' : '📍 Drop Pin'}
      </button>
      {pinLocation && (
        <button
          onClick={onClearPin}
          style={{
            padding: '5px 11px',
            background: overlayBg,
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 7,
            color: '#ef4444',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(6px)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          ✕ Clear Pin
        </button>
      )}
    </div>
    </div>
  );
}

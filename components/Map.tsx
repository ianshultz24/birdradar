'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getTheme, tierTokens, tierLabel } from '@/lib/theme';
import { RefreshCwIcon, CrosshairIcon, MapPinIcon, XIcon } from '@/components/Icons';
import RadarOverlay from './RadarOverlay';
import RadarPositionSync from './RadarPositionSync';
import ChasePanel from './ChasePanel';

// ─── Tier colors for DivIcon HTML strings (CSS vars can't be used in html strings) ───
const TIER_COLORS_LIGHT = {
  'lifer-rare': '#DC2626',  // red — lifer + eBird notable (highest urgency)
  'lifer':      '#059669',  // green — new species
  'rare':       '#DC2626',  // red — eBird notable, already seen
  'seen':       '#9CA3AF',  // gray — previously seen
} as const;

const TIER_COLORS_DARK = {
  'lifer-rare': '#F87171',  // red
  'lifer':      '#34D399',  // green
  'rare':       '#F87171',  // red
  'seen':       '#71717A',  // gray
} as const;

// Per-tier glow colors injected as CSS variables into the DivIcon HTML
const TIER_GLOW_LO_LIGHT: Record<string, string> = {
  'lifer-rare': '0 2px 4px rgba(220,38,38,0.28)',
  'lifer':      '0 2px 4px rgba(5,150,105,0.28)',
  'rare':       '0 2px 4px rgba(220,38,38,0.22)',
  'seen':       '0 2px 3px rgba(0,0,0,0)',
};
const TIER_GLOW_HI_LIGHT: Record<string, string> = {
  'lifer-rare': '0 4px 10px rgba(220,38,38,0.50)',
  'lifer':      '0 4px 10px rgba(5,150,105,0.50)',
  'rare':       '0 4px 10px rgba(220,38,38,0.40)',
  'seen':       '0 4px 8px rgba(0,0,0,0)',
};
const TIER_GLOW_LO_DARK: Record<string, string> = {
  'lifer-rare': '0 2px 4px rgba(248,113,113,0.35)',
  'lifer':      '0 2px 4px rgba(52,211,153,0.35)',
  'rare':       '0 2px 4px rgba(248,113,113,0.28)',
  'seen':       '0 2px 3px rgba(0,0,0,0)',
};
const TIER_GLOW_HI_DARK: Record<string, string> = {
  'lifer-rare': '0 4px 12px rgba(248,113,113,0.55)',
  'lifer':      '0 4px 12px rgba(52,211,153,0.55)',
  'rare':       '0 4px 12px rgba(248,113,113,0.46)',
  'seen':       '0 4px 8px rgba(0,0,0,0)',
};

type TierKey = keyof typeof TIER_COLORS_LIGHT;

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
  if (ratio < 0.33) return lerpColor('#556677', '#f5a623', ratio / 0.33);
  if (ratio < 0.66) return lerpColor('#f5a623', '#ff7043', (ratio - 0.33) / 0.33);
  return lerpColor('#ff7043', '#ef4444', (ratio - 0.66) / 0.34);
}

// ─── Tier sort order ──────────────────────────────────────────────────────────
const TIER_ORDER: Record<string, number> = { 'lifer-rare': 0, lifer: 1, rare: 2, seen: 3 };

// ─── Bird pin icon (teardrop SVG, anchored at tip) ────────────────────────────

// Icons are pure functions of a few discrete inputs — cache them so re-renders
// reuse L.DivIcon instances instead of rebuilding ~400 of them each time.
const birdPinIconCache = new Map<string, L.DivIcon>();

function birdPinIcon(
  tier: ClassifiedObservation['tier'],
  pulse: boolean,
  opacity: number,
  focused = false,
  lightMode = false,
): L.DivIcon {
  const cacheKey = `${tier}|${pulse}|${opacity}|${focused}|${lightMode}`;
  const cached = birdPinIconCache.get(cacheKey);
  if (cached) return cached;

  const tc = lightMode ? TIER_COLORS_LIGHT : TIER_COLORS_DARK;
  const color = tc[tier as TierKey] ?? tc.seen;
  const dotBg = lightMode ? '#FFFFFF' : '#111113';

  // Bigger pins for high-priority tiers
  const sizes: Record<string, [number, number]> = {
    'lifer-rare': [20, 28],
    lifer:        [18, 25],
    rare:         [16, 22],
    seen:         [14, 19],
  };
  const [w, h] = sizes[tier] ?? [14, 19];

  const shouldPulse = pulse && (tier === 'lifer-rare' || tier === 'lifer');
  const pulseClass = shouldPulse ? 'bird-pin-pulse' : '';

  const glowLoTable = lightMode ? TIER_GLOW_LO_LIGHT : TIER_GLOW_LO_DARK;
  const glowHiTable = lightMode ? TIER_GLOW_HI_LIGHT : TIER_GLOW_HI_DARK;
  const glowLo = glowLoTable[tier] ?? glowLoTable.seen;
  const glowHi = glowHiTable[tier] ?? glowHiTable.seen;

  // Outer focus ring drawn inside the SVG viewBox
  const focusRing = focused
    ? `<circle cx="10" cy="9.5" r="6.5" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.45"/>`
    : '';

  const icon = L.divIcon({
    className: '',
    html: `<div class="${pulseClass}" style="display:inline-block;transform-origin:50% 100%;opacity:${opacity};--pin-glow-lo:${glowLo};--pin-glow-hi:${glowHi}"><svg width="${w}" height="${h}" viewBox="0 0 20 28" fill="none" overflow="visible"><path d="M10 0C4.5 0 0 4.5 0 10c0 7 10 18 10 18s10-11 10-18C20 4.5 15.5 0 10 0z" fill="${color}" opacity="${focused ? 1 : 0.88}"/>${focusRing}<circle cx="10" cy="9.5" r="3.5" fill="${dotBg}" opacity="0.88"/></svg></div>`,
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), h],
    popupAnchor: [0, -(h + 4)],
  });
  birdPinIconCache.set(cacheKey, icon);
  return icon;
}

// ─── Hotspot dot icon (circle, heatmap colored) ───────────────────────────────

const hotspotIconCache = new Map<number, L.DivIcon>();

function hotspotIcon(ratio: number): L.DivIcon {
  // Quantize to 20 heat buckets — visually identical, keeps the cache tiny
  const bucket = Math.round(Math.min(Math.max(ratio, 0), 1) * 20) / 20;
  const cached = hotspotIconCache.get(bucket);
  if (cached) return cached;

  const color = hotspotHeatColor(bucket);
  const size = 10;
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};opacity:0.88;box-shadow:0 1px 4px rgba(0,0,0,0.28);border:1.5px solid rgba(255,255,255,0.45);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
  hotspotIconCache.set(bucket, icon);
  return icon;
}

// ─── User location dot ────────────────────────────────────────────────────────

let userLocationIconCached: L.DivIcon | null = null;

function userLocationIcon(): L.DivIcon {
  if (userLocationIconCached) return userLocationIconCached;
  const size = 16;
  return (userLocationIconCached = L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 2px rgba(59,130,246,0.35),0 2px 8px rgba(0,0,0,0.2);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  }));
}

// ─── Drop-pin marker (amber, indicates custom search center) ──────────────────

let pinDropIconCached: L.DivIcon | null = null;

function pinDropIcon(): L.DivIcon {
  if (pinDropIconCached) return pinDropIconCached;
  const w = 20, h = 28;
  return (pinDropIconCached = L.divIcon({
    className: '',
    html: `<svg width="${w}" height="${h}" viewBox="0 0 20 28" fill="none" overflow="visible"><path d="M10 0C4.5 0 0 4.5 0 10c0 7 10 18 10 18s10-11 10-18C20 4.5 15.5 0 10 0z" fill="#F59E0B" opacity="0.9"/><circle cx="10" cy="9.5" r="3.5" fill="white" opacity="0.88"/></svg>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -(h + 6)],
  }));
}

// ─── RecenterController ───────────────────────────────────────────────────────

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

// ─── InitialLocationController ────────────────────────────────────────────────

const INITIAL_LOCATION_ZOOM = 11;

function InitialLocationController({ location }: { location: [number, number] | null }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (location && !done.current) {
      done.current = true;
      map.setView(location, INITIAL_LOCATION_ZOOM);
    }
  }, [location, map]);
  return null;
}

// ─── MapClickHandler ──────────────────────────────────────────────────────────

function MapClickHandler({ active, onMapClick }: { active: boolean; onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (active) onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ─── CursorController ─────────────────────────────────────────────────────────

function CursorController({ isPinMode }: { isPinMode: boolean }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().style.cursor = isPinMode ? 'crosshair' : '';
  }, [isPinMode, map]);
  return null;
}

// ─── MapController ────────────────────────────────────────────────────────────

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

// ─── Observation Popup ────────────────────────────────────────────────────────

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

  const t = getTheme(lightMode);
  const tc = tierTokens(obs.tier, t);
  const label = tierLabel(obs.tier);
  const chaseWorthwhile = obs.tier !== 'seen';

  function openForm() {
    setAddDate(obs.obsDt.split(' ')[0]);
    setAddLoc(obs.locName);
    setShowAddForm(true);
  }

  function confirmAdd() {
    onAddToLifeList(obs.speciesCode, obs.comName, obs.sciName, addDate, addLoc);
    setShowAddForm(false);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '5px 8px',
    background: t.bg2, border: `1px solid ${t.line2}`,
    borderRadius: 5, color: t.fg0, fontSize: 12,
    outline: 'none', boxSizing: 'border-box',
    fontFamily: t.sans,
  };

  return (
    <div style={{ fontFamily: t.sans, minWidth: 240, maxWidth: 300 }}>
      {/* Tier badge */}
      <div style={{ marginBottom: 7 }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, fontFamily: t.mono,
          background: tc.bg, color: tc.color,
          border: `1px solid ${tc.border}`,
          borderRadius: 4, padding: '2px 6px', letterSpacing: '0.04em',
        }}>{label}</span>
      </div>

      {/* Species name */}
      <div style={{ fontSize: 15, fontWeight: 700, color: t.fg0, fontFamily: t.display, marginBottom: 2, lineHeight: 1.25 }}>
        {obs.comName}
      </div>
      <div style={{ fontSize: 12, color: t.fg2, fontStyle: 'italic', marginBottom: 10 }}>
        {obs.sciName}
      </div>

      {/* Sighting odds — will the bird still be there? (prominent, always shown) */}
      {chaseWorthwhile && (
        <div style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 9.5, fontWeight: 700, fontFamily: t.mono, color: t.fg3,
            letterSpacing: '0.06em',
          }}>
            SIGHTING ODDS
          </div>
          <ChasePanel speciesCode={obs.speciesCode} lat={obs.lat} lng={obs.lng} lightMode={lightMode} />
        </div>
      )}

      {/* Location + meta */}
      <div style={{ fontSize: 12, color: t.fg2, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {obs.locName}
      </div>
      <div style={{
        display: 'flex', gap: 12, fontSize: 12, color: t.fg3,
        fontFamily: t.mono,
        marginBottom: obs.reportCount && obs.reportCount > 1 ? 4 : 12,
      }}>
        <span>{obs.howMany ? `${obs.howMany}×` : '1×'}</span>
        <span>{timeAgo(obs.obsDt)}</span>
      </div>
      {obs.reportCount && obs.reportCount > 1 && (
        <div style={{ fontSize: 11, color: t.fg3, fontFamily: t.mono, marginBottom: 12 }}>
          Reported {obs.reportCount}× this week here
        </div>
      )}

      {/* Add to life list */}
      {!isOnLifeList ? (
        !showAddForm ? (
          <button
            onClick={openForm}
            style={{
              width: '100%', padding: '7px 0',
              background: t.accentBg, border: `1px solid ${t.accentBorder}`,
              borderRadius: 6, color: t.accent,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: t.sans,
            }}
          >
            + Add to Life List
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} style={inputStyle}/>
            <input type="text" value={addLoc} onChange={e => setAddLoc(e.target.value)} placeholder="Location" style={inputStyle}/>
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                onClick={confirmAdd}
                style={{
                  flex: 1, padding: '5px 0',
                  background: t.accentBg, border: `1px solid ${t.accentBorder}`,
                  borderRadius: 5, color: t.accent,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: t.sans,
                }}
              >
                ✓ Confirm
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                style={{
                  padding: '5px 10px',
                  background: 'transparent', border: `1px solid ${t.line2}`,
                  borderRadius: 5, color: t.fg2, fontSize: 11, cursor: 'pointer', fontFamily: t.sans,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )
      ) : (
        <div style={{ textAlign: 'center', fontSize: 11, color: t.accent, padding: '5px 0', fontFamily: t.mono }}>
          ✓ On life list
        </div>
      )}
    </div>
  );
}

// ─── Multi-obs popup ──────────────────────────────────────────────────────────

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
  const t = getTheme(lightMode);

  return (
    <div>
      {observations.length > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 10,
          background: t.bg2, border: `1px solid ${t.line2}`,
          borderRadius: 5, padding: '3px 6px',
        }}>
          <button
            onClick={() => setIndex(i => Math.max(0, i - 1))}
            disabled={safeIndex === 0}
            style={{
              background: 'none', border: 'none',
              cursor: safeIndex === 0 ? 'default' : 'pointer',
              color: safeIndex === 0 ? t.fg4 : t.accent,
              fontSize: 18, fontWeight: 700, padding: '0 4px', lineHeight: 1,
              opacity: safeIndex === 0 ? 0.3 : 1,
            }}
          >‹</button>
          <span style={{ fontSize: 10, color: t.fg3, fontFamily: t.mono, letterSpacing: '0.06em' }}>
            {safeIndex + 1} / {observations.length} species here
          </span>
          <button
            onClick={() => setIndex(i => Math.min(observations.length - 1, i + 1))}
            disabled={safeIndex === observations.length - 1}
            style={{
              background: 'none', border: 'none',
              cursor: safeIndex === observations.length - 1 ? 'default' : 'pointer',
              color: safeIndex === observations.length - 1 ? t.fg4 : t.accent,
              fontSize: 18, fontWeight: 700, padding: '0 4px', lineHeight: 1,
              opacity: safeIndex === observations.length - 1 ? 0.3 : 1,
            }}
          >›</button>
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

// ─── Hover-to-open marker ─────────────────────────────────────────────────────
// On hover-capable pointers, hovering a bird pin opens its card (with a short
// intent delay so skimming across pins doesn't fire fetches), and the card stays
// open long enough to move onto it and click. Touch devices are unaffected — the
// default tap-to-open behavior remains.
const canHover =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function HoverMarker({ position, icon, children }: {
  position: [number, number];
  icon: L.DivIcon;
  children: React.ReactNode;
}) {
  const markerRef = useRef<L.Marker>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupElRef = useRef<HTMLElement | null>(null);

  const cancelOpen = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      markerRef.current?.closePopup();
    }, 260);
  }, [cancelClose]);

  // Stable references so the popup DOM listeners we add on open are the exact
  // ones we remove on close.
  const onPopupEnter = useCallback(() => cancelClose(), [cancelClose]);
  const onPopupLeave = useCallback(() => scheduleClose(), [scheduleClose]);

  useEffect(() => () => { cancelOpen(); cancelClose(); }, [cancelOpen, cancelClose]);

  const eventHandlers = useMemo(() => {
    if (!canHover) return undefined;
    return {
      mouseover: () => {
        cancelClose();
        if (openTimer.current) return;
        openTimer.current = setTimeout(() => {
          openTimer.current = null;
          markerRef.current?.openPopup();
        }, 130);
      },
      mouseout: () => {
        cancelOpen();
        scheduleClose();
      },
      popupopen: (e: L.PopupEvent) => {
        const el = e.popup.getElement() as HTMLElement | null;
        if (!el) return;
        popupElRef.current = el;
        el.addEventListener('mouseenter', onPopupEnter);
        el.addEventListener('mouseleave', onPopupLeave);
      },
      popupclose: () => {
        const el = popupElRef.current;
        if (el) {
          el.removeEventListener('mouseenter', onPopupEnter);
          el.removeEventListener('mouseleave', onPopupLeave);
          popupElRef.current = null;
        }
        cancelOpen();
        cancelClose();
      },
    };
  }, [cancelClose, cancelOpen, scheduleClose, onPopupEnter, onPopupLeave]);

  return (
    <Marker ref={markerRef} position={position} icon={icon} eventHandlers={eventHandlers}>
      <Popup className="bird-popup">{children}</Popup>
    </Marker>
  );
}

// ─── Hotspot Popup ────────────────────────────────────────────────────────────

function HotspotPopupContent({
  hs,
  onMoreInfo,
  lightMode,
}: {
  hs: Hotspot;
  onMoreInfo: (hs: Hotspot) => void;
  lightMode: boolean;
}) {
  const t = getTheme(lightMode);

  return (
    <div style={{ fontFamily: t.sans, minWidth: 190 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.fg0, fontFamily: t.display, marginBottom: 5, lineHeight: 1.3 }}>
        {hs.locName}
      </div>
      {hs.numSpeciesAllTime > 0 && (
        <div style={{ fontSize: 12, color: t.fg3, fontFamily: t.mono, marginBottom: 8 }}>
          {hs.numSpeciesAllTime} species all time
        </div>
      )}
      {hs.latestObsDt && (
        <div style={{ fontSize: 11, color: t.fg3, marginBottom: 8 }}>
          Last obs: {timeAgo(hs.latestObsDt)}
        </div>
      )}
      <button
        onClick={() => onMoreInfo(hs)}
        style={{
          width: '100%', padding: '6px 0',
          background: t.accentBg, border: `1px solid ${t.accentBorder}`,
          borderRadius: 6, color: t.accent,
          fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: t.sans,
        }}
      >
        More Info →
      </button>
      <div style={{ fontSize: 10, color: t.fg4, marginTop: 4, textAlign: 'center', fontFamily: t.mono }}>
        {hs.locId}
      </div>
    </div>
  );
}

// ─── Main Map component ───────────────────────────────────────────────────────

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
  loading?: boolean;
  onAddToLifeList: (code: string, name: string, sciName?: string, date?: string, location?: string) => void;
  onHotspotDetail: (hs: Hotspot) => void;
  onPinDrop: (lat: number, lng: number) => void;
  onClearPin: () => void;
  onRefreshNow?: () => void;
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
  loading,
  onAddToLifeList,
  onHotspotDetail,
  onPinDrop,
  onClearPin,
  onRefreshNow,
}: MapProps) {
  const [isPinMode, setIsPinMode] = useState(false);
  const [reCenterTrigger, setReCenterTrigger] = useState(0);
  const [radarCenter, setRadarCenter] = useState({ x: 0, y: 0 });
  const [radarRadiusPx, setRadarRadiusPx] = useState(0);
  const [hoveredMapBtn, setHoveredMapBtn] = useState<string | null>(null);

  const handleRadarUpdate = useCallback((x: number, y: number, r: number) => {
    setRadarCenter({ x, y });
    setRadarRadiusPx(r);
  }, []);

  const reCenterTarget: [number, number] = userLocation ?? center;
  const theme = getTheme(settings.lightMode);

  function handleMapClick(lat: number, lng: number) {
    onPinDrop(lat, lng);
    setIsPinMode(false);
  }

  const lifeSet = useMemo(() => new Set(lifeList), [lifeList]);
  const { lightMode } = settings;

  const visibleObs = useMemo(
    () => settings.dimSeenSpecies
      ? observations
      : observations.filter(o => o.tier !== 'seen' && o.tier !== 'rare'),
    [observations, settings.dimSeenSpecies]
  );

  const { getHotspotHeat, maxHeat } = useMemo(() => {
    const hotspotRecentSpecies = new Map<string, Set<string>>();
    for (const obs of observations) {
      if (obs.locId) {
        if (!hotspotRecentSpecies.has(obs.locId)) hotspotRecentSpecies.set(obs.locId, new Set());
        hotspotRecentSpecies.get(obs.locId)!.add(obs.speciesCode);
      }
    }
    const getHotspotHeat = (hs: Hotspot) =>
      Math.max(hs.numSpeciesAllTime || 0, hotspotRecentSpecies.get(hs.locId)?.size ?? 0);
    const maxHeat = Math.max(...hotspots.map(getHotspotHeat), 1);
    return { getHotspotHeat, maxHeat };
  }, [observations, hotspots]);

  // Group observations by location and sort each group (focused species first,
  // then by tier priority) — memoized so panning/hover re-renders don't redo it.
  const markerGroups = useMemo(() => {
    const groups = new Map<string, ClassifiedObservation[]>();
    for (const obs of visibleObs) {
      const key = obs.locId || obs.locName;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(obs);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const aFoc = focusedSpecies?.code === a.speciesCode ? -1 : 0;
        const bFoc = focusedSpecies?.code === b.speciesCode ? -1 : 0;
        if (aFoc !== bFoc) return aFoc - bFoc;
        return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
      });
    }
    return Array.from(groups.entries());
  }, [visibleObs, focusedSpecies]);

  const tileUrl = lightMode
    ? 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png'
    : 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png';

  const tileAttrib = '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  // Shared styles for the map overlay control buttons
  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '7px 12px', borderRadius: 8,
    fontSize: 12, fontWeight: 600, fontFamily: theme.sans,
    cursor: 'pointer', boxShadow: theme.shadowLg,
    backdropFilter: 'blur(8px)', transition: 'all 0.15s',
    border: `1px solid ${theme.line2}`,
  };

  return (
    <div className={lightMode ? '' : 'dark'} style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer
        center={center}
        zoom={11}
        minZoom={3}
        maxZoom={18}
        style={{ height: '100%', width: '100%', background: lightMode ? '#e8ecf0' : '#0a0e14' }}
        zoomControl={false}
      >
        <TileLayer url={tileUrl} attribution={tileAttrib} maxZoom={20} />

        <MapController target={flyToTarget} />
        <RecenterController target={reCenterTarget} trigger={reCenterTrigger} />
        <InitialLocationController location={userLocation} />
        <MapClickHandler active={isPinMode} onMapClick={handleMapClick} />
        <CursorController isPinMode={isPinMode} />

        {settings.showRadarAnimation && (
          <RadarPositionSync
            geoCenter={pinLocation ?? center}
            radiusKm={settings.searchRadius}
            onUpdate={handleRadarUpdate}
          />
        )}

        {settings.showRadiusCircle && (
          <Circle
            center={pinLocation ?? center}
            radius={settings.searchRadius * 1000}
            pathOptions={{
              color: theme.accent,
              weight: 1.5,
              opacity: 0.4,
              fillOpacity: 0,
              dashArray: '6 4',
            }}
          />
        )}

        {/* Hotspot markers — rendered behind bird markers */}
        {settings.showHotspots &&
          hotspots.map(hs => {
            const ratio = Math.min(getHotspotHeat(hs) / maxHeat, 1);
            return (
              <Marker key={hs.locId} position={[hs.lat, hs.lng]} icon={hotspotIcon(ratio)}>
                <Popup className="bird-popup">
                  <HotspotPopupContent
                    hs={hs}
                    onMoreInfo={onHotspotDetail}
                    lightMode={lightMode}
                  />
                </Popup>
              </Marker>
            );
          })}

        {/* Bird sighting pin markers — grouped by location */}
        {markerGroups.map(([locKey, group]) => {
          const repObs = group[0];
          const isFocused = !!(focusedSpecies && group.some(o => o.speciesCode === focusedSpecies.code));
          const isSeenTier = repObs.tier === 'seen' || repObs.tier === 'rare';
          const baseOpacity = isSeenTier && settings.dimSeenSpecies ? 0.3 : 1;
          const focusOpacity = focusedSpecies && !isFocused ? 0.18 : 1;
          const opacity = baseOpacity * focusOpacity;
          return (
            <HoverMarker
              key={locKey}
              position={[repObs.lat, repObs.lng]}
              icon={birdPinIcon(repObs.tier, settings.liferPulse, opacity, isFocused, settings.lightMode)}
            >
              <MultiObsPopup
                observations={group}
                onAddToLifeList={onAddToLifeList}
                lifeSet={lifeSet}
                lightMode={lightMode}
              />
            </HoverMarker>
          );
        })}

        {/* User GPS location dot */}
        {userLocation && (
          <Marker position={userLocation} icon={userLocationIcon()} zIndexOffset={1000}>
            <Popup className="bird-popup">
              <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: '#3b82f6' }}>
                Your Location
              </div>
            </Popup>
          </Marker>
        )}

        {/* Custom search pin */}
        {pinLocation && (
          <Marker position={pinLocation} icon={pinDropIcon()}>
            <Popup className="bird-popup">
              <div style={{ fontFamily: theme.sans, minWidth: 170 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B', fontFamily: theme.display, marginBottom: 5 }}>
                  Custom Search Pin
                </div>
                <div style={{ fontSize: 11, color: theme.fg3, marginBottom: 10, fontFamily: theme.mono }}>
                  Searching up to 50 km from this point
                </div>
                <button
                  onClick={onClearPin}
                  style={{
                    width: '100%', padding: '5px 0',
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 5, color: '#EF4444',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: theme.sans,
                  }}
                >
                  Clear Pin
                </button>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Radar canvas overlay */}
      {settings.showRadarAnimation && radarRadiusPx >= 20 && (
        <RadarOverlay
          centerX={radarCenter.x}
          centerY={radarCenter.y}
          radiusPx={radarRadiusPx}
          enabled={settings.showRadarAnimation}
        />
      )}

      {/* Map overlay controls — bottom-right */}
      <div style={{
        position: 'absolute',
        bottom: isMobile ? 86 : 30,
        right: 10,
        zIndex: 1001,
        display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end',
      }}>
        {/* Refresh */}
        {onRefreshNow && (
          <button
            onClick={onRefreshNow}
            disabled={loading}
            title="Refresh bird data"
            onMouseEnter={() => setHoveredMapBtn('refresh')}
            onMouseLeave={() => setHoveredMapBtn(null)}
            style={{
              ...btnBase,
              background: hoveredMapBtn === 'refresh' && !loading ? theme.bg2 : theme.cardBg,
              color: loading ? theme.fg3 : theme.accent,
              cursor: loading ? 'not-allowed' : 'pointer',
              transform: hoveredMapBtn === 'refresh' && !loading ? 'translateY(-1px)' : 'none',
            }}
          >
            <RefreshCwIcon size={13}/>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        )}

        {/* Re-center */}
        <button
          onClick={() => setReCenterTrigger(n => n + 1)}
          title={userLocation ? 'Fly to GPS location' : 'Fly to search center'}
          onMouseEnter={() => setHoveredMapBtn('center')}
          onMouseLeave={() => setHoveredMapBtn(null)}
          style={{
            ...btnBase,
            background: hoveredMapBtn === 'center' ? theme.bg2 : theme.cardBg,
            color: theme.fg1,
            transform: hoveredMapBtn === 'center' ? 'translateY(-1px)' : 'none',
          }}
        >
          <CrosshairIcon size={13}/>
          Center
        </button>

        {/* Drop Pin / Cancel */}
        <button
          onClick={() => setIsPinMode(v => !v)}
          onMouseEnter={() => setHoveredMapBtn('pin')}
          onMouseLeave={() => setHoveredMapBtn(null)}
          style={{
            ...btnBase,
            background: isPinMode ? theme.accent : hoveredMapBtn === 'pin' ? theme.bg2 : theme.cardBg,
            border: `1px solid ${isPinMode ? theme.accent : theme.line2}`,
            color: isPinMode ? theme.accentFg : theme.fg1,
            transform: hoveredMapBtn === 'pin' && !isPinMode ? 'translateY(-1px)' : 'none',
          }}
        >
          <MapPinIcon size={13}/>
          {isPinMode ? 'Cancel' : 'Drop Pin'}
        </button>

        {/* Clear Pin */}
        {pinLocation && (
          <button
            onClick={onClearPin}
            onMouseEnter={() => setHoveredMapBtn('clearpin')}
            onMouseLeave={() => setHoveredMapBtn(null)}
            style={{
              ...btnBase,
              padding: '6px 10px',
              background: hoveredMapBtn === 'clearpin' ? 'rgba(239,68,68,0.1)' : theme.cardBg,
              border: '1px solid rgba(239,68,68,0.35)',
              color: '#EF4444',
              fontSize: 11,
              transform: hoveredMapBtn === 'clearpin' ? 'translateY(-1px)' : 'none',
            }}
          >
            <XIcon size={12}/>
            Clear Pin
          </button>
        )}
      </div>
    </div>
  );
}

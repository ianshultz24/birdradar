'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Tooltip,
  Circle,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';

import type { ClassifiedObservation, Hotspot } from '@/lib/ebird';
import type { AppSettings } from '@/lib/ebird';
import { timeAgo } from '@/lib/ebird';
import type { MarkerGroup } from '@/lib/markers';
import { getTheme, type Theme } from '@/lib/theme';
import { useStableCallback } from '@/hooks/useStableCallback';
import { RefreshCwIcon, CrosshairIcon, MapPinIcon, XIcon } from '@/components/Icons';
import { DETAIL_PANEL_WIDTH } from '@/components/SpeciesDetailPanel';

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

const noop = () => {};

// Hover tooltips are pointer affordances. On touch, Leaflet's bindTooltip also
// wires `click` to open the tooltip, which would race the click that opens the
// detail panel — so touch devices get no tooltip at all.
const canHover =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// ─── Bird pin icon (teardrop SVG, anchored at tip) ────────────────────────────

// Icons are pure functions of a few discrete inputs — cache them so re-renders
// reuse L.DivIcon instances instead of rebuilding ~400 of them each time.
const birdPinIconCache = new Map<string, L.DivIcon>();

// Note: marker opacity is deliberately NOT baked in here. It changes for every
// pin whenever a species is focused in the sidebar, and a new icon identity means
// react-leaflet calls setIcon() → DivIcon._createIcon() resets innerHTML → every
// pulse animation restarts. Opacity goes through <Marker opacity> instead, which
// writes style.opacity on the existing element.
function birdPinIcon(
  tier: ClassifiedObservation['tier'],
  pulse: boolean,
  focused = false,
  lightMode = false,
): L.DivIcon {
  const cacheKey = `${tier}|${pulse}|${focused}|${lightMode}`;
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
    html: `<div class="${pulseClass}" style="display:inline-block;transform-origin:50% 100%;--pin-glow-lo:${glowLo};--pin-glow-hi:${glowHi}"><svg width="${w}" height="${h}" viewBox="0 0 20 28" fill="none" overflow="visible"><path d="M10 0C4.5 0 0 4.5 0 10c0 7 10 18 10 18s10-11 10-18C20 4.5 15.5 0 10 0z" fill="${color}" opacity="${focused ? 1 : 0.88}"/>${focusRing}<circle cx="10" cy="9.5" r="3.5" fill="${dotBg}" opacity="0.88"/></svg></div>`,
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
// Markers default to `bubblingMouseEvents: false`, so a click on a pin never
// reaches the map — the dismiss below can't fight the selection above. Paths do
// bubble, so clicking the search-radius circle dismisses, which is what we want.

function MapClickHandler({
  isPinMode,
  onMapClick,
  onDismiss,
}: {
  isPinMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onDismiss: () => void;
}) {
  useMapEvents({
    click(e) {
      if (isPinMode) onMapClick(e.latlng.lat, e.latlng.lng);
      else onDismiss();
    },
  });
  return null;
}

// ─── InvalidateSizeController ─────────────────────────────────────────────────
// The detail panel overlays the map rather than resizing it, so nothing here
// fires today. It exists so that any future layout that *does* resize the
// container can't leave Leaflet rendering against stale dimensions.

function InvalidateSizeController() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);
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

// ─── Tooltip edge flipping ────────────────────────────────────────────────────
// Leaflet's `direction: 'auto'` only picks left/right, and it picks from the map
// *centre* rather than the viewport edge — so horizontal clipping is impossible,
// but a pin within half a tooltip of the top or bottom edge still gets cut off.
//
// Rather than measure where Leaflet has already put the tooltip (which lags a
// frame behind the content react-leaflet portals in), compute where it *would*
// go from the marker's container point and the element's own size. That answer
// doesn't depend on when Leaflet last repositioned anything.
//
// `offset` has to flip with the direction: Leaflet adds it after choosing the
// direction, so a gap tuned for 'top' drags a 'bottom' tooltip up over its pin.
// The 'top' offset also clears the tallest pin, because a marker's latlng sits at
// the pin tip and the artwork extends upwards from there.

const TOOLTIP_GAP_BELOW = 4;
const TOOLTIP_GAP_ABOVE = -30;

function useTooltipEdgeFlip() {
  const map = useMap();

  return useMemo(() => ({
    tooltipopen: (e: L.TooltipEvent) => {
      const tooltip = e.tooltip;
      const source = e.target as L.Marker;
      // react-leaflet portals the children in on its own tooltipopen listener, so
      // on the very first hover the element is still empty this tick.
      requestAnimationFrame(() => {
        const el = tooltip.getElement();
        if (!el || !el.isConnected || !source.getLatLng) return;

        const point = map.latLngToContainerPoint(source.getLatLng());
        const size = map.getSize();
        const w = el.offsetWidth;
        const h = el.offsetHeight;

        // 'auto' resolves to left/right, both vertically centred on the anchor.
        const direction: L.Direction =
          point.y - h / 2 < 0 ? 'bottom'
          : point.y + h / 2 > size.y ? 'top'
          : 'auto';

        // A vertical flip centres the tooltip horizontally on the pin, which can
        // clip in a corner — nudge it back inside by however much it overhangs.
        let dx = 0;
        if (direction !== 'auto') {
          dx = Math.max(0, w / 2 - point.x) - Math.max(0, point.x + w / 2 - size.x);
        }
        const dy = direction === 'bottom' ? TOOLTIP_GAP_BELOW
          : direction === 'top' ? TOOLTIP_GAP_ABOVE
          : 0;

        const offset = tooltip.options.offset as L.Point | undefined;
        if (tooltip.options.direction === direction && offset?.x === dx && offset?.y === dy) return;

        tooltip.options.direction = direction;
        tooltip.options.offset = L.point(dx, dy);
        // Safe on a Tooltip: unlike Popup, its _adjustPan is a no-op, so this
        // repositions without yanking the map out from under the cursor.
        tooltip.update();
      });
    },
    tooltipclose: (e: L.TooltipEvent) => {
      // Re-measure from neutral next time rather than inheriting the last flip.
      e.tooltip.options.direction = 'auto';
      e.tooltip.options.offset = L.point(0, 0);
    },
  }), [map]);
}

// ─── Bird pin marker (memoized) ───────────────────────────────────────────────
// Hover shows a cheap tooltip; click opens the species detail panel. There is no
// Popup bound to these markers at all, which is what stops Leaflet's built-in
// click-toggles-the-popup behaviour from closing the card hover had just opened.
//
// Takes primitives and stable references only, so React.memo actually holds: the
// parent can re-render freely without touching ~400 Leaflet markers. The position
// tuple is memoized because react-leaflet compares it by identity and calls
// setLatLng() on every change — a fresh array literal each render meant every
// marker was repositioned on every render, which clobbers Leaflet's in-flight
// zoom-animation transform and makes the pins visibly drift from the tiles.

interface BirdPinMarkerProps {
  locKey: string;
  lat: number;
  lng: number;
  tier: ClassifiedObservation['tier'];
  pulse: boolean;
  focused: boolean;
  lightMode: boolean;
  opacity: number;
  showTooltip: boolean;
  group: ClassifiedObservation[];
  onSelect: (locKey: string) => void;
}

const BirdPinMarker = memo(function BirdPinMarker({
  locKey,
  lat,
  lng,
  tier,
  pulse,
  focused,
  lightMode,
  opacity,
  showTooltip,
  group,
  onSelect,
}: BirdPinMarkerProps) {
  const position = useMemo<[number, number]>(() => [lat, lng], [lat, lng]);
  const icon = useMemo(
    () => birdPinIcon(tier, pulse, focused, lightMode),
    [tier, pulse, focused, lightMode]
  );

  const tooltipHandlers = useTooltipEdgeFlip();
  // Memoized, not an inline literal: react-leaflet compares the handlers object by
  // reference and does a full off/on cycle when it changes. Focusing a species in
  // the sidebar changes `opacity` on nearly every pin, so a literal here would mean
  // thousands of listener rebinds per sidebar click.
  const eventHandlers = useMemo(() => ({
    ...tooltipHandlers,
    click: (e: L.LeafletMouseEvent) => {
      // The cursor is still over the pin when the panel opens, and Leaflet only
      // closes a tooltip on mouseout — so it would otherwise hang around.
      (e.target as L.Marker).closeTooltip();
      onSelect(locKey);
    },
  }), [tooltipHandlers, onSelect, locKey]);

  const rep = group[0];

  return (
    <Marker position={position} icon={icon} opacity={opacity} eventHandlers={eventHandlers}>
      {showTooltip && (
        <Tooltip direction="auto" offset={[0, 0]} opacity={1} className="bird-tooltip">
          <span className="bird-tooltip-name">{rep.comName}</span>
          <span className="bird-tooltip-meta">
            {timeAgo(rep.obsDt)}
            {group.length > 1 && ` · +${group.length - 1} more`}
          </span>
        </Tooltip>
      )}
    </Marker>
  );
});

// ─── Hotspot marker (memoized) ────────────────────────────────────────────────
// Same contract as the bird pins: hover previews, click opens the detail panel —
// here the existing HotspotPanel in the sidebar, with no popup in between.

const HotspotMarker = memo(function HotspotMarker({
  hs,
  ratio,
  showTooltip,
  onMoreInfo,
}: {
  hs: Hotspot;
  ratio: number;
  showTooltip: boolean;
  onMoreInfo: (hs: Hotspot) => void;
}) {
  const position = useMemo<[number, number]>(() => [hs.lat, hs.lng], [hs.lat, hs.lng]);
  const icon = useMemo(() => hotspotIcon(ratio), [ratio]);

  const tooltipHandlers = useTooltipEdgeFlip();
  const eventHandlers = useMemo(() => ({
    ...tooltipHandlers,
    click: (e: L.LeafletMouseEvent) => {
      (e.target as L.Marker).closeTooltip();
      onMoreInfo(hs);
    },
  }), [tooltipHandlers, onMoreInfo, hs]);

  return (
    <Marker position={position} icon={icon} eventHandlers={eventHandlers}>
      {showTooltip && (
        <Tooltip direction="auto" offset={[0, 0]} opacity={1} className="bird-tooltip">
          <span className="bird-tooltip-name">{hs.locName}</span>
          {hs.numSpeciesAllTime > 0 && (
            <span className="bird-tooltip-meta">{hs.numSpeciesAllTime} species all time</span>
          )}
        </Tooltip>
      )}
    </Marker>
  );
});

// ─── Main Map component ───────────────────────────────────────────────────────

export interface MapProps {
  /** Single source of truth for where we're searching: dropped pin, else GPS/default. */
  searchCenter: [number, number];
  /** Radius actually queried, in km. A dropped pin overrides the setting, and the
   *  circle has to say so — it used to keep drawing the settings radius. */
  searchRadiusKm: number;
  observations: ClassifiedObservation[];
  /** Pre-grouped by location in app/page.tsx, so markers and the detail panel
   *  resolve the same locKey to the same observations. */
  markerGroups: MarkerGroup[];
  hotspots: Hotspot[];
  flyToTarget: [number, number] | null;
  settings: AppSettings;
  pinLocation: [number, number] | null;
  userLocation: [number, number] | null;
  focusedSpecies: { code: string; name: string } | null;
  /** locKey of the sighting whose detail panel is open, if any. */
  selectedLocKey: string | null;
  isMobile?: boolean;
  loading?: boolean;
  /** Low battery mode — suppresses marker pulse/glow and expensive filters. */
  lowFi?: boolean;
  onSelectSighting: (locKey: string) => void;
  onCloseDetail: () => void;
  onHotspotDetail: (hs: Hotspot) => void;
  onPinDrop: (lat: number, lng: number) => void;
  onClearPin: () => void;
  onRefreshNow?: () => void;
}

export default function BirdMap({
  searchCenter,
  searchRadiusKm,
  observations,
  markerGroups,
  hotspots,
  flyToTarget,
  settings,
  pinLocation,
  userLocation,
  focusedSpecies,
  selectedLocKey,
  isMobile,
  loading,
  lowFi = false,
  onSelectSighting,
  onCloseDetail,
  onHotspotDetail,
  onPinDrop,
  onClearPin,
  onRefreshNow,
}: MapProps) {
  const [isPinMode, setIsPinMode] = useState(false);
  const [reCenterTrigger, setReCenterTrigger] = useState(0);

  // The page re-creates its handler props on every render. Freeze their identity
  // here so the memoized markers below actually stay memoized.
  const selectSighting = useStableCallback(onSelectSighting);
  const closeDetail = useStableCallback(onCloseDetail);
  const hotspotDetail = useStableCallback(onHotspotDetail);
  const clearPin = useStableCallback(onClearPin);
  const stableRefresh = useStableCallback(onRefreshNow ?? noop);
  const refreshNow = onRefreshNow ? stableRefresh : undefined;

  const togglePinMode = useCallback(() => setIsPinMode(v => !v), []);
  const reCenter = useCallback(() => setReCenterTrigger(n => n + 1), []);

  const reCenterTarget = useMemo<[number, number]>(
    () => userLocation ?? searchCenter,
    [userLocation, searchCenter]
  );
  const theme = getTheme(settings.lightMode);

  const pinDrop = useStableCallback(onPinDrop);
  const handleMapClick = useCallback((lat: number, lng: number) => {
    pinDrop(lat, lng);
    setIsPinMode(false);
  }, [pinDrop]);

  const { lightMode } = settings;
  const focusedCode = focusedSpecies?.code ?? null;
  const pulseEnabled = settings.liferPulse && !lowFi;

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

  const tileUrl = lightMode
    ? 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png'
    : 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png';

  const tileAttrib = '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  return (
    <div className={lightMode ? '' : 'dark'} style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer
        center={searchCenter}
        zoom={11}
        minZoom={3}
        maxZoom={18}
        // No background here: react-leaflet freezes the container div's style at
        // mount (`const [props] = useState({ className, id, style })`), so an
        // inline colour would stay stuck on whichever theme was active on load.
        // globals.css owns it via .leaflet-container / .dark .leaflet-container.
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        zoomSnap={0.5}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={120}
        inertia
        inertiaDeceleration={2500}
        zoomAnimation
        markerZoomAnimation
        fadeAnimation
      >
        <TileLayer
          url={tileUrl}
          attribution={tileAttrib}
          maxZoom={20}
          // Keep a wider ring of off-screen tiles so zooming out doesn't expose
          // the empty container background. Costs no extra requests — it only
          // stops Leaflet from pruning tiles it already has.
          keepBuffer={4}
          updateWhenZooming={false}
        />

        <MapController target={flyToTarget} />
        <RecenterController target={reCenterTarget} trigger={reCenterTrigger} />
        <InitialLocationController location={userLocation} />
        <MapClickHandler isPinMode={isPinMode} onMapClick={handleMapClick} onDismiss={closeDetail} />
        <CursorController isPinMode={isPinMode} />
        <InvalidateSizeController />

        {settings.showRadiusCircle && (
          <Circle
            center={searchCenter}
            radius={searchRadiusKm * 1000}
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
          hotspots.map(hs => (
            <HotspotMarker
              key={hs.locId}
              hs={hs}
              ratio={Math.min(getHotspotHeat(hs) / maxHeat, 1)}
              showTooltip={canHover}
              onMoreInfo={hotspotDetail}
            />
          ))}

        {/* Bird sighting pin markers — grouped by location */}
        {markerGroups.map(([locKey, group]) => {
          const repObs = group[0];
          const isFocused =
            locKey === selectedLocKey ||
            !!(focusedCode && group.some(o => o.speciesCode === focusedCode));
          const isSeenTier = repObs.tier === 'seen' || repObs.tier === 'rare';
          const baseOpacity = isSeenTier && settings.dimSeenSpecies ? 0.3 : 1;
          const focusOpacity = focusedCode && !isFocused ? 0.18 : 1;
          return (
            <BirdPinMarker
              key={locKey}
              locKey={locKey}
              lat={repObs.lat}
              lng={repObs.lng}
              tier={repObs.tier}
              pulse={pulseEnabled}
              focused={isFocused}
              lightMode={lightMode}
              opacity={baseOpacity * focusOpacity}
              showTooltip={canHover}
              group={group}
              onSelect={selectSighting}
            />
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
                  Searching up to {searchRadiusKm} km from this point
                </div>
                <button
                  onClick={clearPin}
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

      <MapControls
        theme={theme}
        isMobile={!!isMobile}
        loading={!!loading}
        lowFi={lowFi}
        detailOpen={!!selectedLocKey}
        isPinMode={isPinMode}
        hasUserLocation={!!userLocation}
        hasPin={!!pinLocation}
        onRefreshNow={refreshNow}
        onTogglePinMode={togglePinMode}
        onReCenter={reCenter}
        onClearPin={clearPin}
      />
    </div>
  );
}

// ─── Map overlay controls ─────────────────────────────────────────────────────
// Owns its own hover state. It used to live in BirdMap, which meant simply moving
// the cursor across these buttons re-rendered every marker on the map.

const MapControls = memo(function MapControls({
  theme,
  isMobile,
  loading,
  lowFi,
  detailOpen,
  isPinMode,
  hasUserLocation,
  hasPin,
  onRefreshNow,
  onTogglePinMode,
  onReCenter,
  onClearPin,
}: {
  theme: Theme;
  isMobile: boolean;
  loading: boolean;
  lowFi: boolean;
  /** Desktop detail panel is open — slide the controls clear of it. */
  detailOpen: boolean;
  isPinMode: boolean;
  hasUserLocation: boolean;
  hasPin: boolean;
  onRefreshNow?: () => void;
  onTogglePinMode: () => void;
  onReCenter: () => void;
  onClearPin: () => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '7px 12px', borderRadius: 8,
    fontSize: 12, fontWeight: 600, fontFamily: theme.sans,
    cursor: 'pointer', boxShadow: theme.shadowLg,
    // backdrop-filter forces an expensive readback of everything behind the
    // button on every frame — not something to run in low battery mode.
    backdropFilter: lowFi ? undefined : 'blur(8px)',
    transition: lowFi ? undefined : 'all 0.15s',
    border: `1px solid ${theme.line2}`,
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: isMobile ? 86 : 30,
      // On mobile the detail sheet covers these the way the sidebar drawer already
      // does; on desktop the panel is a fixed-width column, so step aside instead.
      right: !isMobile && detailOpen ? DETAIL_PANEL_WIDTH + 10 : 10,
      zIndex: 1001,
      display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end',
      transition: lowFi ? undefined : 'right 0.24s cubic-bezier(0.32, 0.72, 0, 1)',
    }}>
      {/* Refresh */}
      {onRefreshNow && (
        <button
          onClick={onRefreshNow}
          disabled={loading}
          title="Refresh bird data"
          onMouseEnter={() => setHovered('refresh')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            background: hovered === 'refresh' && !loading ? theme.bg2 : theme.cardBg,
            color: loading ? theme.fg3 : theme.accent,
            cursor: loading ? 'not-allowed' : 'pointer',
            transform: hovered === 'refresh' && !loading ? 'translateY(-1px)' : 'none',
          }}
        >
          <RefreshCwIcon size={13}/>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      )}

      {/* Re-center */}
      <button
        onClick={onReCenter}
        title={hasUserLocation ? 'Fly to GPS location' : 'Fly to search center'}
        onMouseEnter={() => setHovered('center')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          background: hovered === 'center' ? theme.bg2 : theme.cardBg,
          color: theme.fg1,
          transform: hovered === 'center' ? 'translateY(-1px)' : 'none',
        }}
      >
        <CrosshairIcon size={13}/>
        Center
      </button>

      {/* Drop Pin / Cancel */}
      <button
        onClick={onTogglePinMode}
        onMouseEnter={() => setHovered('pin')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          background: isPinMode ? theme.accent : hovered === 'pin' ? theme.bg2 : theme.cardBg,
          border: `1px solid ${isPinMode ? theme.accent : theme.line2}`,
          color: isPinMode ? theme.accentFg : theme.fg1,
          transform: hovered === 'pin' && !isPinMode ? 'translateY(-1px)' : 'none',
        }}
      >
        <MapPinIcon size={13}/>
        {isPinMode ? 'Cancel' : 'Drop Pin'}
      </button>

      {/* Clear Pin */}
      {hasPin && (
        <button
          onClick={onClearPin}
          onMouseEnter={() => setHovered('clearpin')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            padding: '6px 10px',
            background: hovered === 'clearpin' ? 'rgba(239,68,68,0.1)' : theme.cardBg,
            border: '1px solid rgba(239,68,68,0.35)',
            color: '#EF4444',
            fontSize: 11,
            transform: hovered === 'clearpin' ? 'translateY(-1px)' : 'none',
          }}
        >
          <XIcon size={12}/>
          Clear Pin
        </button>
      )}
    </div>
  );
});

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
import { isPrivateLocation } from '@/lib/location-privacy';
import {
  hotspotGlyph,
  hotspotHeatColor,
  pinSearchGlyph,
  pulseGlowVars,
  sightingGlyph,
  tierCanPulse,
  userDotGlyph,
  USER_DOT_COLOR,
  type MarkerGlyph,
} from '@/lib/marker-style';
import { getTheme, type Theme } from '@/lib/theme';
import { getTileLayer } from '@/lib/tiles';
import { useStableCallback } from '@/hooks/useStableCallback';
import { RefreshCwIcon, CrosshairIcon, MapPinIcon, XIcon } from '@/components/Icons';
import { DETAIL_PANEL_WIDTH } from '@/components/SpeciesDetailPanel';
import MapLegend from '@/components/MapLegend';

const noop = () => {};

/** Beyond this, a reported GPS accuracy is a shrug, not a measurement. */
const MAX_ACCURACY_HALO_M = 5000;

// ─── Hotspot budget ───────────────────────────────────────────────────────────
// eBird returns every hotspot in the search radius: 916 of them in the default
// area, against 77 sighting markers. Leaflet gives each one a
// `leaflet-zoom-animated` icon and rewrites its transform on every zoom.
// Measured on the live app (fixes/PhaseC_fixes.md §3.3): writing that transform to
// 993 icons and flushing style + layout costs ~16 ms — the whole 16.7 ms frame
// budget, before a single pixel is rastered. Sightings alone cost ~1 ms.
//
// That is why the markers and the vector overlay used to commit their zoom
// transitions a frame behind the tiles and appear to slide against the basemap.
// These three numbers are a rendering budget, not a taste preference.

/** Below this zoom a hotspot field is noise, not information. */
const MIN_HOTSPOT_ZOOM = 10;
/** Ceiling on hotspot markers, applied after viewport culling. */
const MAX_HOTSPOT_MARKERS = 150;
/** Viewport margin kept when culling, so a small pan doesn't pop markers in at
 *  the edge of the screen. */
const HOTSPOT_VIEWPORT_PAD = 0.25;

// Hover tooltips are pointer affordances. On touch, Leaflet's bindTooltip also
// wires `click` to open the tooltip, which would race the click that opens the
// detail panel — so touch devices get no tooltip at all.
const canHover =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// ─── Icons ────────────────────────────────────────────────────────────────────
// All artwork comes from lib/marker-style.ts so the legend can render the exact
// same glyphs. This file owns only the L.DivIcon wrapping and the caches.
//
// Every marker here is **centre-anchored** — the latlng sits at the middle of the
// box. Phase B's markers were tip-anchored teardrops; that change is why the
// tooltip offsets below had to become derived rather than constant.

/** Wrap a glyph in a centre-anchored DivIcon. `className: ''` is required —
 *  DivIcon otherwise defaults to `leaflet-div-icon`, which paints a white box. */
function divIconFromGlyph(glyph: MarkerGlyph, wrapper?: { cls?: string; style?: string }): L.DivIcon {
  const c = glyph.box / 2;
  const svg = `<svg width="${glyph.box}" height="${glyph.box}" viewBox="0 0 ${glyph.box} ${glyph.box}" fill="none" overflow="visible">${glyph.svg}</svg>`;
  return L.divIcon({
    className: '',
    html: wrapper
      ? `<div class="${wrapper.cls ?? ''}" style="display:inline-block;${wrapper.style ?? ''}">${svg}</div>`
      : svg,
    iconSize: [glyph.box, glyph.box],
    iconAnchor: [c, c],
    popupAnchor: [0, -(c + 4)],
  });
}

// Icons are pure functions of a few discrete inputs — cache them so re-renders
// reuse L.DivIcon instances instead of rebuilding ~400 of them each time.
const birdPinIconCache = new Map<string, L.DivIcon>();

// Note: marker opacity is deliberately NOT baked in here. It changes for every
// pin whenever a species is focused in the sidebar, and a new icon identity means
// react-leaflet calls setIcon() → DivIcon._createIcon() resets innerHTML → every
// pulse animation restarts. Opacity goes through <Marker opacity> instead, which
// writes style.opacity on the existing element.
//
// The cache key must name every input. `isPrivate` was added in Phase C; forget
// one and markers silently share the wrong artwork. 4 tiers × 2⁴ = 64 entries max.
function birdPinIcon(
  tier: ClassifiedObservation['tier'],
  pulse: boolean,
  focused = false,
  lightMode = false,
  isPrivate = false,
): L.DivIcon {
  const cacheKey = `${tier}|${pulse}|${focused}|${lightMode}|${isPrivate}`;
  const cached = birdPinIconCache.get(cacheKey);
  if (cached) return cached;

  const glyph = sightingGlyph(tier, { lightMode, focused, isPrivate });
  const shouldPulse = pulse && tierCanPulse(tier);

  const icon = divIconFromGlyph(glyph, {
    cls: shouldPulse ? 'bird-pin-pulse' : '',
    // transform-origin is centre now, not the tip — see @keyframes pinRingPulse.
    style: `transform-origin:50% 50%;${pulseGlowVars(tier, lightMode)}`,
  });
  birdPinIconCache.set(cacheKey, icon);
  return icon;
}

// ─── Hotspot icon (diamond outline, heatmap colored) ──────────────────────────
// A different shape, not just a different colour — a hotspot can no longer be
// mistaken for a sighting at a glance.

const hotspotIconCache = new Map<number, L.DivIcon>();

function hotspotIcon(ratio: number): L.DivIcon {
  // Quantize to 20 heat buckets — visually identical, keeps the cache tiny
  const bucket = Math.round(Math.min(Math.max(ratio, 0), 1) * 20) / 20;
  const cached = hotspotIconCache.get(bucket);
  if (cached) return cached;

  const icon = divIconFromGlyph(hotspotGlyph(hotspotHeatColor(bucket)));
  hotspotIconCache.set(bucket, icon);
  return icon;
}

// ─── User location dot ────────────────────────────────────────────────────────

let userLocationIconCached: L.DivIcon | null = null;

function userLocationIcon(): L.DivIcon {
  return (userLocationIconCached ??= divIconFromGlyph(userDotGlyph()));
}

// ─── Custom search location (crosshair) ───────────────────────────────────────

let pinSearchIconCached: L.DivIcon | null = null;

function pinSearchIcon(): L.DivIcon {
  return (pinSearchIconCached ??= divIconFromGlyph(pinSearchGlyph()));
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
//
// ─── Why the offsets are derived rather than constant ────────────────────────
//
// Phase B hard-coded -30 / +4, tuned for a teardrop whose latlng sat at the pin
// *tip* with 28 px of artwork above it. Verified in Tooltip._setPosition
// (leaflet-src.js:10739): Leaflet positions a tooltip from the marker's latlng
// plus `options.offset` plus the icon's `tooltipAnchor` (default [0,0],
// leaflet-src.js:7380) — **icon size and iconAnchor are never consulted.** So a
// constant is really a constant *for one icon geometry*, and Phase C now ships
// five: boxes from 12 px (`seen`) to 34 px (private `lifer-rare`), all
// centre-anchored. One formula, read off each marker's own icon:
//
//   dyAbove = -(iconAnchor.y + GAP)              clear the artwork above the anchor
//   dyBelow =  (iconSize.y - iconAnchor.y) + GAP clear the artwork below it
//   dxSide  =  max(anchor.x, size.x - anchor.x) + GAP
//
// Sanity-checked against the values it replaces before adoption: the old teardrop
// (iconSize [20,28], iconAnchor [10,28]) yields -32 / +4 against the hand-tuned
// -30 / +4. The formula reproduces the tuning.
//
// `dxSide` covers the *unflipped* case, which Phase B left at offset.x = 0 —
// putting the tooltip's inner edge on the marker's latlng, i.e. overlapping half
// the glyph. Barely visible on a tip-anchored teardrop; obvious on a centred dot.
// A single positive offset.x gives a symmetric gap on both sides: the 'right'
// branch puts the left edge at pos.x + offset.x, and the 'left' branch's
// `subX = tooltipWidth + (offset.x + anchor.x) * 2` resolves to a right edge at
// pos.x - offset.x. That doubling is Leaflet mirroring the offset, not a bug —
// it is exactly why one value serves both sides.

const TOOLTIP_GAP = 4;

/** Phase B's constants, used only if a marker's icon omits its metrics. */
const TOOLTIP_FALLBACK = { dxSide: 0, dyAbove: -30, dyBelow: 4 };

/**
 * Tooltip spacing for a marker, derived from its own icon box.
 *
 * `L.point(undefined)` returns `undefined` rather than throwing, so reading `.y`
 * off it would blow up inside a requestAnimationFrame with no useful stack. Every
 * icon in this file sets both fields; the bail-out is here so a future marker
 * kind that forgets can't take the whole tooltip layer down with it.
 */
function iconTooltipMetrics(source: L.Marker): typeof TOOLTIP_FALLBACK {
  const io = (source.options?.icon as L.Icon | undefined)?.options;
  if (!io?.iconSize || !io?.iconAnchor) return TOOLTIP_FALLBACK;
  const size = L.point(io.iconSize as L.PointExpression);
  const anchor = L.point(io.iconAnchor as L.PointExpression);
  if (!size || !anchor) return TOOLTIP_FALLBACK;
  return {
    dxSide: Math.max(anchor.x, size.x - anchor.x) + TOOLTIP_GAP,
    dyAbove: -(anchor.y + TOOLTIP_GAP),
    dyBelow: size.y - anchor.y + TOOLTIP_GAP,
  };
}

function useTooltipEdgeFlip() {
  const map = useMap();

  return useMemo(() => ({
    tooltipopen: (e: L.TooltipEvent) => {
      const tooltip = e.tooltip;
      const source = e.target as L.Marker;
      const metrics = iconTooltipMetrics(source);

      // The side gap depends only on the icon, so apply it now. Deferring it to
      // the frame below would paint one frame of tooltip-over-glyph on every
      // first hover.
      tooltip.options.direction = 'auto';
      tooltip.options.offset = L.point(metrics.dxSide, 0);
      tooltip.update();

      // react-leaflet portals the children in on its own tooltipopen listener, so
      // on the very first hover the element is still empty this tick — and the
      // flip decision needs the rendered size.
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
        // This only ever applies when subX = tooltipWidth / 2, so it never meets
        // the 'left' branch's offset doubling described above.
        let dx = metrics.dxSide;
        if (direction !== 'auto') {
          dx = Math.max(0, w / 2 - point.x) - Math.max(0, point.x + w / 2 - size.x);
        }
        const dy = direction === 'bottom' ? metrics.dyBelow
          : direction === 'top' ? metrics.dyAbove
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
      // tooltipopen re-derives the offset synchronously, so zeroing it here can't
      // leak a wrong gap into the next hover.
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
  /** eBird personal location — draws the dotted "approximate" ring. A primitive,
   *  so React.memo still holds. See lib/location-privacy.ts. */
  isPrivate: boolean;
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
  isPrivate,
  opacity,
  showTooltip,
  group,
  onSelect,
}: BirdPinMarkerProps) {
  const position = useMemo<[number, number]>(() => [lat, lng], [lat, lng]);
  const icon = useMemo(
    () => birdPinIcon(tier, pulse, focused, lightMode, isPrivate),
    [tier, pulse, focused, lightMode, isPrivate]
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

// ─── HotspotLayer ─────────────────────────────────────────────────────────────
// Draws only the hotspots that are actually on screen, capped (see the budget
// above). Nothing is removed from the data — pan or zoom in and the rest appear.
//
// The viewport state lives HERE rather than in BirdMap on purpose. Hoisting it
// would re-render every sighting marker on every map movement, which is exactly
// the per-frame cost this component exists to remove.
//
// It listens on `moveend` only — which fires after a pan and after a zoom — so
// markers never mount or unmount part-way through an animation. Subscribing to
// `move` or `zoom` instead would reintroduce the stall inside the frames that
// matter.

interface RankedHotspot {
  hs: Hotspot;
  /** Heat ratio 0..1, precomputed in BirdMap so culling doesn't recompute it. */
  ratio: number;
}

const HotspotLayer = memo(function HotspotLayer({
  hotspots,
  showTooltip,
  onMoreInfo,
}: {
  /** Pre-sorted by heat, descending — the cap below depends on that order. */
  hotspots: RankedHotspot[];
  showTooltip: boolean;
  onMoreInfo: (hs: Hotspot) => void;
}) {
  const map = useMap();
  const [view, setView] = useState(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }));

  // Memoized: react-leaflet re-registers the whole handler set whenever this
  // object's identity changes.
  const handlers = useMemo(
    () => ({ moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }) }),
    [map]
  );
  useMapEvents(handlers);

  const visible = useMemo(() => {
    if (view.zoom < MIN_HOTSPOT_ZOOM) return [];
    const bounds = view.bounds.pad(HOTSPOT_VIEWPORT_PAD);
    const out: RankedHotspot[] = [];
    for (const entry of hotspots) {
      if (!bounds.contains([entry.hs.lat, entry.hs.lng] as L.LatLngTuple)) continue;
      out.push(entry);
      // `hotspots` is heat-sorted, so this keeps the best ones rather than
      // whichever the API happened to return first.
      if (out.length === MAX_HOTSPOT_MARKERS) break;
    }
    return out;
  }, [hotspots, view]);

  return (
    <>
      {visible.map(({ hs, ratio }) => (
        <HotspotMarker
          key={hs.locId}
          hs={hs}
          ratio={ratio}
          showTooltip={showTooltip}
          onMoreInfo={onMoreInfo}
        />
      ))}
    </>
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
  /** GPS accuracy radius in metres, from `pos.coords.accuracy`. Drives the halo
   *  under the user dot; null/absurd values simply draw nothing. */
  userAccuracyM?: number | null;
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
  userAccuracyM,
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

  // Heat resolved and sorted once, here, rather than per-marker on every render.
  // HotspotLayer's cap relies on this being ordered best-first.
  const rankedHotspots = useMemo<RankedHotspot[]>(() => {
    const hotspotRecentSpecies = new Map<string, Set<string>>();
    for (const obs of observations) {
      if (obs.locId) {
        if (!hotspotRecentSpecies.has(obs.locId)) hotspotRecentSpecies.set(obs.locId, new Set());
        hotspotRecentSpecies.get(obs.locId)!.add(obs.speciesCode);
      }
    }
    const heat = (hs: Hotspot) =>
      Math.max(hs.numSpeciesAllTime || 0, hotspotRecentSpecies.get(hs.locId)?.size ?? 0);
    const maxHeat = Math.max(...hotspots.map(heat), 1);
    return hotspots
      .map(hs => ({ hs, ratio: Math.min(heat(hs) / maxHeat, 1) }))
      .sort((a, b) => b.ratio - a.ratio);
  }, [observations, hotspots]);

  // Memoized so the object identity only changes with the theme — same rule as
  // the marker props below: primitives and stable references only.
  const { url: tileUrl, attribution: tileAttrib } = useMemo(
    () => getTileLayer(lightMode),
    [lightMode]
  );

  // A coarse IP-derived fix reports tens of kilometres of "accuracy"; drawing it
  // would paint a blue disc over the whole map and tell the user nothing. Above
  // the cap we show the dot alone rather than a halo that means "somewhere".
  const haloRadiusM =
    typeof userAccuracyM === 'number' &&
    Number.isFinite(userAccuracyM) &&
    userAccuracyM > 0 &&
    userAccuracyM <= MAX_ACCURACY_HALO_M
      ? userAccuracyM
      : null;

  // Memoized because react-leaflet compares pathOptions by identity and calls
  // layer.setStyle() whenever it changes — an object literal here meant every
  // BirdMap render restyled both circles. `theme` is a module-level singleton per
  // mode (lib/theme.ts), so these hold. Same rule as the marker props above.
  const radiusPathOptions = useMemo(
    () => ({ color: theme.accent, weight: 1.5, opacity: 0.4, fillOpacity: 0, dashArray: '6 4' }),
    [theme]
  );
  const haloPathOptions = useMemo(
    () => ({
      color: USER_DOT_COLOR,
      weight: 1,
      opacity: 0.35,
      fillColor: USER_DOT_COLOR,
      fillOpacity: 0.1,
    }),
    []
  );

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
        // The Stadia / OpenMapTiles / OpenStreetMap credit is not deleted — it
        // renders in Settings → Credits instead, which is what keeps this
        // compliant with their terms. See lib/tiles.ts.
        attributionControl={false}
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
            pathOptions={radiusPathOptions}
          />
        )}

        {/* Hotspot markers — rendered behind bird markers, viewport-culled and
            capped. See the hotspot budget at the top of this file. */}
        {settings.showHotspots && (
          <HotspotLayer
            hotspots={rankedHotspots}
            showTooltip={canHover}
            onMoreInfo={hotspotDetail}
          />
        )}

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
              isPrivate={isPrivateLocation(repObs)}
              opacity={baseOpacity * focusOpacity}
              showTooltip={canHover}
              group={group}
              onSelect={selectSighting}
            />
          );
        })}

        {/* GPS accuracy halo — drawn in ground units, so it stays honest at every
            zoom. `interactive={false}` is required: Paths bubble mouse events by
            default (leaflet-src.js:8166), which is what makes clicking the search
            radius circle dismiss the detail panel. A halo that can be hundreds of
            metres wide must not become a dismiss target over the user's position. */}
        {userLocation && haloRadiusM != null && (
          <Circle
            center={userLocation}
            radius={haloRadiusM}
            interactive={false}
            pathOptions={haloPathOptions}
          />
        )}

        {/* User GPS location dot */}
        {userLocation && (
          <Marker position={userLocation} icon={userLocationIcon()} zIndexOffset={1000}>
            <Popup className="bird-popup">
              <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: USER_DOT_COLOR }}>
                Your Location
              </div>
              {haloRadiusM != null && (
                <div style={{ fontSize: 11, color: theme.fg3, fontFamily: theme.mono, marginTop: 3 }}>
                  Accurate to about {Math.round(haloRadiusM)} m
                </div>
              )}
            </Popup>
          </Marker>
        )}

        {/* Custom search location — a crosshair, unlike any sighting marker */}
        {pinLocation && (
          <Marker position={pinLocation} icon={pinSearchIcon()}>
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

      {/* Sibling of MapContainer, like MapControls — outside the Leaflet
          container, so Leaflet never sees its clicks or wheel events. */}
      <MapLegend
        theme={theme}
        lightMode={lightMode}
        isMobile={!!isMobile}
        lowFi={lowFi}
        detailOpen={!!selectedLocKey}
        pulseEnabled={pulseEnabled}
      />

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

# ind_bugfix_A — the map escapes the world

**Date:** 2026-08-16
**Follows:** `fixes/PhaseC_fixes.md`
**Touches:** `components/Map.tsx` only.

This is the reference format for bugfix reports in this repo — see `AGENTS.md`.
Sections 3 and 5 are the point of the document: they exist so the next agent does not
re-derive a dead end, or "fix" something that is load-bearing.

---

## 1. Symptom

Two user reports, both about the basemap rather than the data:

> Users can zoom out past the world into empty background.

> Panning far east/west reaches a wrapped world copy where tiles repeat but all
> markers/hotspots/circles are absent, reading as a broken empty map.

Neither is a data bug. In both cases the eBird payload is intact and every marker is
mounted — the view has simply moved somewhere the markers are not.

---

## 2. Root cause

Both defects come from the same omission: **the map had no `maxBounds`, so Leaflet's
`Map#_limitCenter` never ran and the view was free to leave the one world copy that
contains anything.**

Grepping the whole repo (excluding `node_modules`) for `maxBounds`,
`maxBoundsViscosity`, `worldCopyJump`, `noWrap`, `continuousWorld`, `crs`, `bounds`
and `renderWorldCopies` returned **nothing**. The map ran on pure Leaflet defaults:
`CRS.EPSG3857`, infinitely repeating tiles, unconstrained panning.

### 2a. Bug 1 — the container background

`minZoom={3}` was a fixed constant. Two independent paths reached the background.

**Vertical over-pan — the dominant one, and it happens at every zoom.** Web Mercator
stops at ±85.0511°; there is no tile above or below that at any zoom level. Without
`maxBounds` Leaflet allows unlimited vertical dragging, so the world can simply be
dragged off the top or bottom of the viewport and the flat `.leaflet-container` colour
(`#e8ecf0` / `#0a0e14`, `app/globals.css:191-192`) is what fills the gap. This is why
the report says "zoom out" but the bug is reproducible at zoom 11 too — zooming out
just makes it easier to hit.

**Zoom-out on a large viewport.** The world is `256 · 2³ = 2048` CSS px square at zoom
3. A viewport wider or taller than 2048 px does not fit inside it, so the background
frames the map on the left and right as well. At 1920 px the world just barely covers
the viewport, which is why this read as screen-dependent and was easy to miss on the
machine it was developed on.

The old `keepBuffer={4}` comment claimed to be the mitigation for this ("so zooming out
doesn't expose the empty container background"). It was not, and could not be:
`keepBuffer` only stops Leaflet pruning tiles it already has, and beyond ±85.05° there
are none to retain. That comment was a symptom patch on this bug and has been
corrected in place.

### 2b. Bug 2 — the empty world copies

Leaflet's `TileLayer` defaults to `noWrap: false`, so tiles repeat infinitely in x.
Overlays do not repeat: `Marker`, `Circle` and the SVG renderer each project a single
longitude — always within ±180 here, since that is what eBird returns and what
`lib/ebird-proxy.ts:40-59` validates. So every copy of the basemap past ±180 is a
correct, fully-rendered map with zero overlays on it. `worldCopyJump` was not set, so
nothing pulled the view back.

There is a **second, downstream** contributor specific to hotspots. `HotspotLayer`
culls on `map.getBounds()` and tests `bounds.contains([hs.lat, hs.lng])`.
`getBounds()` returns **unwrapped** longitudes, so one copy east it returns something
like `190..250` while the hotspot data is at `-122` — every hotspot fails `contains`
before the projection issue even applies. This path is now unreachable rather than
patched; see §5.

---

## 3. Ruled out

Recorded so nobody spends time here again.

| Hypothesis | Why not |
|---|---|
| The Phase C marker-lag work (`PhaseC_fixes.md`) | That is per-frame transform cost during zoom animation. Both of these bugs reproduce with hotspots off and the map completely stationary. |
| Stadia tile auth (`phaseB_fixes.md`) | The empty area is the CSS container colour, not Stadia's 401 watermark PNG — and in the world copies the tiles that render are *correct*, which a bad key could not produce. |
| `zoomSnap` / `zoomDelta` at `0.5` | They change the size of a zoom step, not the zoom floor. `PhaseC_fixes.md` §4.5 already flags these as an open lead for the *softness* of the basemap; that is a separate issue and is untouched here. |
| `keepBuffer` being too small | See §2a. `keepBuffer` cannot retain tiles that do not exist. Raising it changes nothing above ±85.05°. |
| Markers being filtered/dropped in a copy | They are not. The DOM nodes stay mounted at their correct latlng the whole time; the *viewport* moved 40,000 km away from them. Hotspots additionally get culled by §2b, but sightings are not culled at all and were equally absent. |

---

## 4. The change

Two edits, both in `components/Map.tsx`. Bug 2 needs only the first; bug 1 needs both.

### 4a. Constrain the view to one world (`Map.tsx:78-97`, `:819-840`)

```ts
const MERCATOR_MAX_LAT = 85.0511287798;
const WORLD_BOUNDS: L.LatLngBoundsLiteral = [
  [-MERCATOR_MAX_LAT, -180],
  [MERCATOR_MAX_LAT, 180],
];
const BASE_MIN_ZOOM = 3;
const ZOOM_SNAP = 0.5;
```

On `<MapContainer>`: `maxBounds={WORLD_BOUNDS}`, `maxBoundsViscosity={1.0}`,
`minZoom={BASE_MIN_ZOOM}`, and `zoomSnap` / `zoomDelta` now read `ZOOM_SNAP` instead of
a duplicated literal.

`MERCATOR_MAX_LAT`, not ±90 — the bound has to sit where the tiles stop, not where the
coordinate system stops, or the north and south edges leak background again.

`maxBoundsViscosity: 1.0` is a hard wall rather than a rubber band. Data is scoped to a
≤50 km radius around `searchCenter` (`app/page.tsx:118`), so there is nothing out there
to bounce toward and a firm stop is the clearer signal.

These are static values, so plain props are correct — react-leaflet passes them to
`L.map()` at mount. A `searchCenter`-dependent bound would have needed an imperative
`map.setMaxBounds()` controller instead; see §5 for why it does not.

### 4b. Derive the zoom floor from the container size (`Map.tsx:253-303`)

`maxBounds` alone does **not** fix bug 1. When the viewport is larger than the world,
`_limitCenter` just centres a too-small world and the background frames it on all four
sides. The floor has to guarantee the world covers the viewport:

```ts
const crs = map.options.crs ?? L.CRS.EPSG3857;
const fitZoom = map.getScaleZoom(Math.max(size.x, size.y) / crs.scale(0), 0);
const snapped = Math.ceil(fitZoom / ZOOM_SNAP - 1e-9) * ZOOM_SNAP;
const next = Math.max(BASE_MIN_ZOOM, snapped);
if (next !== map.getMinZoom()) map.setMinZoom(next);
```

`setMinZoom` fires `zoomlevelschange` and pulls the current zoom up itself when it now
sits below the floor, so nothing else is needed.

**Why `getScaleZoom` and not `getBoundsZoom(WORLD_BOUNDS, true)`,** which reads like the
obvious API for this: `getBoundsZoom` clamps its result with
`Math.max(this.getMinZoom(), …)`. Once the floor has been raised to 4 on a wide window,
it can never return anything below 4 again — shrinking the window back would leave the
map permanently stuck over-zoomed.

Measured in the live app rather than argued from the source. With an 827 px viewport
(true fit zoom **1.692**), after `setMinZoom(4)`:

| API | Returns |
|---|---|
| `getBoundsZoom(WORLD_BOUNDS, true)` | **4** — its own previous output, fed back |
| `getScaleZoom(827 / crs.scale(0), 0)` | **1.692** — correct, unaffected |

This is load-bearing; do not "simplify" it back.

**Where it lives.** `InvalidateSizeController` was renamed `ViewportFitController` and
extended, rather than a second `ResizeObserver` being added on the same element.
`phaseB_rationale.md` §9 kept that component as insurance for a future layout that
resizes the container instead of overlaying it; this is that insurance being cashed in.
The order inside the frame is load-bearing: `getSize()` must be read *after*
`invalidateSize()` has refreshed Leaflet's cached dimensions, or the floor is computed
from the previous layout. `ResizeObserver` fires once on `observe()`, so the floor is
also correct at mount.

Effect in practice — for most users nothing changes at all. Measured against the live
map's own CRS:

| Viewport (larger axis) | Fit zoom | Floor |
|---|---|---|
| 827 px | 1.692 | **3** (base) |
| 1920 px | 2.907 | **3** (base) |
| 2560 px | 3.322 | **3.5** |
| 3840 px | 3.907 | **4** |

---

## 5. Deliberately not changed

Each of these is a plausible-looking "missing" fix that would be wrong.

- **`noWrap` stays `false` on the `TileLayer`.** With `maxBounds` a world copy is
  unreachable anyway, and wrapped tiles still fill the ±180 seam during
  zoom-animation frames. They cost nothing: `GridLayer` wraps the tile x coordinate
  back into range, so the URLs are the home copy's and come from browser cache — no
  extra Stadia credits. Setting `noWrap: true` would paint container background at the
  seam, i.e. reintroduce bug 1 at the edge.

- **`worldCopyJump` stays `false`.** It is the textbook answer to bug 2 and it is worse
  here: it only re-centres on `moveend`, so overlays would still be missing for the
  entire duration of the drag, and the snap-back is visible. `maxBounds` prevents the
  state from ever being reached, which is strictly better than recovering from it.

- **No longitude normalization in `HotspotLayer`.** The unwrapped-`getBounds()` path in
  §2b is now **unreachable**: with the centre clamped inside `WORLD_BOUNDS` and the
  viewport never larger than the world, the corners of `map.getBounds()` cannot exceed
  ±180. Adding a `wrapLatLng` there would be dead code that implies the clamp is
  optional. If you ever remove or widen `maxBounds`, this is the second thing that
  breaks — and it will fail silently.

- **`HotspotLayer` is untouched.** Owning its own viewport state and subscribing to
  `moveend` rather than `move`/`zoom` is load-bearing (`PhaseC_fixes.md` §5), as are
  `MIN_HOTSPOT_ZOOM` / `MAX_HOTSPOT_MARKERS` / `HOTSPOT_VIEWPORT_PAD` — a measured
  frame budget, not preferences.

- **`zoomSnap` / `zoomDelta` stay at `0.5`.** Still an open lead for basemap softness
  per `PhaseC_fixes.md` §4.5; out of scope here. They are now sourced from `ZOOM_SNAP`
  so the derived floor lands on a real zoom stop — if you change one, change the
  constant, not the props.

- **Dateline searches are a known, accepted limitation.** A `searchCenter` within
  ~0.5° of ±180 — Fiji, Kiribati, the western Aleutians — has part of its 50 km radius
  on the far side of the clamp and cannot pan to it. Those users were already broken:
  markers at lng −179.9 and +179.9 currently render a world apart on the same screen.
  The alternative considered was a 360°-wide `maxBounds` window that follows
  `searchCenter`, putting the seam on the far side of the planet from the data. It
  works, but it requires normalizing longitude at all six overlay call sites (bird
  pins, hotspots, radius circle, GPS halo, user dot, search pin) and every future one —
  a new invariant every overlay must remember, for a vanishing user count. If this is
  ever revisited, that is the design, and the invariant is the cost.

---

## 6. Verification

**Static gates** — the triad used by every fix doc in this directory. There is no test
runner and no `test` script in this project.

```
npm run lint      # clean
npx tsc --noEmit  # clean
npm run build     # clean, 19/19 static pages
```

**The harness caveat is real and was reproduced.** `PhaseC_fixes.md` §3.1 and §6 record
that the automation tab is occluded. Confirmed again here:
`document.visibilityState === 'hidden'`, and an explicit `requestAnimationFrame` probe
**never fired** within 700 ms. `ViewportFitController` computes the floor inside a rAF,
so **it has never executed under the harness** — every `minZoom` reading below is the
static prop, and the floor arithmetic was therefore verified as an expression against
the live map's CRS instead of through the controller.

### Verified live (dev server, real gestures)

| Check | Result |
|---|---|
| Options reached `L.map()` | `maxBounds` = `-180,-85.0511287798,180,85.0511287798`; `maxBoundsViscosity` = 1; `zoomSnap` = 0.5 |
| 3 hard drags north at zoom 3 | bbox top pinned at **85.0511287798066** — exactly the world edge, no background |
| 7 hard drags east at zoom 3 | bbox east pinned at **180.0**; a second world copy is unreachable |
| Overlays survive the pan | 79 `.leaflet-marker-icon` nodes still mounted at the east wall |
| `setView` past the world | lng 300 → 179.83; lng −300 → −179.83; lat 89 → 85.03; lat −89 → −85.03 |
| Floor arithmetic | 827→3, 1920→3, 2560→3.5, 3840→4 (table in §4b) |
| `getBoundsZoom` feedback loop | reproduced — see the table in §4b |
| Static gates | lint, `tsc --noEmit`, build all clean |

A useful incidental: Leaflet clamps every real input path itself once `maxBounds` is
set — drag viscosity (`leaflet-src.js:13794`), inertia
(`:13911`, `_limitOffset`), keyboard pan (`:14079`, `_limitOffset`) — and
`Map.initialize` calls `setMaxBounds` for you when the option is passed (`:3257`),
which registers the `moveend` → `_panInsideMaxBounds` backstop. Passing the option is
genuinely sufficient; no extra `moveend` handler is needed.

**One Leaflet quirk found while testing, deliberately not worked around:**
`map.panBy(offset, {animate: false})` where `offset` exceeds the viewport takes an
early `_resetView` branch (`leaflet-src.js:3435`) that bypasses `_limitCenter`, and can
leave the view outside `maxBounds` until the next `moveend` corrects it. Measured: a
4000 px programmatic `panBy` north reached bbox top 88.6°. **No user gesture produces
this and nothing in this codebase calls `panBy`** — the app uses `setView` and `flyTo`,
both of which limit. Recorded so it is not mistaken for a regression if someone
reproduces it from the console. If `panBy` is ever adopted, pass `animate: true` or
follow it with `panInsideBounds`.

### Still manual — needs a focused window, and a real device for 7

1. Zoom fully out with the scroll wheel on the **widest display available**. The world
   fills the viewport at every stop, no background strip on any edge. This is the path
   that exercises `ViewportFitController` for real; the harness cannot.
2. With the map zoomed all the way out, resize the window from narrow to widest: the
   floor rises and the map zooms in to stay filled. Then shrink it back: the floor
   returns to 3. **This is the case `getBoundsZoom` would have got wrong** (§4b).
3. Phase C regression: Settings → "Show radius circle" on, pick a road junction sitting
   on the dashed circle, then double-click-zoom and wheel-zoom in both themes. The
   circle and pins must stay locked to the landmark for the full 250 ms.
4. `Drop Pin`, `Center`, and fly-to-species from the sidebar still land correctly — all
   three now route through `_limitCenter`.
5. Pinch-zoom out to the floor on a real phone and confirm the bounce-back. The harness
   pins the viewport and no phase has driven the mobile breakpoint live, so this stays
   code-inspection until someone runs it on a device.

---

## 7. Invariants for future agents

- **`maxBounds` is what makes the absent longitude normalization safe.** Remove or
  widen it and `HotspotLayer`'s `bounds.contains` starts silently dropping every
  hotspot. §5.
- **`getScaleZoom`, not `getBoundsZoom`, in `ViewportFitController`.** The latter
  clamps against the floor it is being used to compute. §4b.
- **`invalidateSize()` before `getSize()`** inside that rAF, or the floor is one layout
  behind.
- **`ZOOM_SNAP` and the `zoomSnap` / `zoomDelta` props must move together.** A floor
  between two stops is unreachable and costs a zoom level.
- **`MERCATOR_MAX_LAT`, not 90.** The bound belongs where the tiles stop.

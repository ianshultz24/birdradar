# Phase C fixes — map layers detaching during zoom; Stadia credit moved to Settings

**Follows:** `fixes/PhaseC_rationale.md` (uncommitted at the time of writing).
**Date:** 2026-08-16

Two follow-ups reported by the user against the Phase C working tree.

---

## 1. The defects

### 1a. Layers detach from the basemap during zoom

> "markers on the map and the hotspot circle — the hotspot circle especially — seem detached from
> the map itself. When zooming in or out, the outer circle moves at a different pace, and likewise,
> the pins and other dots seem detached from the map. It just makes it seem cheap."

Three answers narrowed this before any code was read, and each one killed a whole class of
explanation:

| Question | Answer | What it rules out |
|---|---|---|
| Wrong only while moving, or still wrong at rest? | **Only during the motion** | Projection / radius / `iconAnchor` geometry. The layers land in the right place; they take a different *path* getting there. |
| Which input? | Mouse wheel **and double-click** | Double-click is a single clean `setZoomAround` — one animated step, no debounce, no dropped events. Kills every "wheel events are being swallowed" theory. |
| Which circle? | The **dashed search-radius circle** (`showRadiusCircle`) | Not the GPS accuracy halo, though both are `<Circle>` on the same renderer, so a fix covers both. |

Phase C is why this is suddenly visible rather than why it exists: Phase B's markers were
tip-anchored 20×28 teardrops with all their artwork *above* the anchor, which masks a couple of
pixels of drift. Phase C's are centre-anchored discs from 10 px to 34 px, where the same drift is a
large fraction of the whole marker.

### 1b. Hide the Stadia credit from the map

The bottom-right `Leaflet | © Stadia Maps © OpenMapTiles © OpenStreetMap` line should come off the
main screen, with a small credits section added to the bottom of Settings in its place.

---

## 2. What was eliminated, and the evidence

**This section is the point of this document.** All of the below are the obvious suspects; none of
them is the cause. Read this before re-deriving any of them.

Checked against `node_modules/leaflet/dist/leaflet-src.js` (1.9.4) and `leaflet.css`.

### 2a. Not prop-identity churn — the Phase B fix holds

The comment at `components/Map.tsx:391` records that a fresh `[lat, lng]` array literal per render
made react-leaflet call `setLatLng()` on every marker every render, "which clobbers Leaflet's
in-flight zoom-animation transform and makes the pins visibly drift from the tiles." That is the
same symptom, so it was the first thing checked — and it is already fixed everywhere:

- `searchCenter` is `useMemo`'d on `[pinLocation, baseCenter]` (`app/page.tsx:113`).
- `userLocation` / `pinLocation` are `useState` arrays — stable by construction.
- `BirdPinMarker` and `HotspotMarker` both memoize their position tuples
  (`components/Map.tsx:426`, `:479`).
- `radius={searchRadiusKm * 1000}` is a number; react-leaflet's `updateCircle` compares it by value.

Nothing repositions a layer mid-animation.

### 2b. Not missing or overridden CSS

`leaflet.css` is imported at `app/layout.tsx:5`. Both load-bearing rules are present and nothing in
`app/globals.css` touches them:

```
.leaflet-zoom-animated               { transform-origin: 0 0; }              /* leaflet.css:188 */
.leaflet-zoom-anim .leaflet-zoom-animated {
        transition: transform 0.25s cubic-bezier(0,0,0.25,1); }              /* leaflet.css:197 */
```

If `transform-origin: 0 0` were missing, the scaled panes would grow about their own centres and the
overlay would be wildly wrong during zoom and correct at rest — a very good fit for the report,
which is exactly why it was worth checking. It is there.

### 2c. Not a Leaflet math mismatch — the three panes are locked by construction

During an animated zoom Leaflet gives:

- tile levels — `translate3d(t) scale(s)` (`_setZoomTransform`, leaflet-src.js:11697)
- the SVG renderer container — `translate3d(t) scale(s)` (`_updateTransform`, leaflet-src.js:12522)
- marker icons — `translate3d(p)`, no scale (`Marker._animateZoom`, leaflet-src.js:8007)

all set inside the same synchronous `fire('zoomanim')`, all under the same transition.

A point at layer-offset `d` inside a scaled container renders at `t(u) + d·s(u)`. With `t` and `s`
each interpolating linearly in the eased progress `u`, that expression is **linear in `u`**, starts
at `p₀` and ends at `p₁` — i.e. identical to the marker's `p₀ + (p₁−p₀)u`. The scaled panes and the
translated markers trace the same path. There is no mismatch to find here.

### 2d. Not stranded tile levels

`GridLayer._setView` ends in `_setZoomTransforms` — **plural** (leaflet-src.js:11688) — which loops
every level, not just the incoming one. Old levels are not left static while the new one animates.
`_updateLevels` (leaflet-src.js:11466) also forces a layout read on a freshly created level
("force the browser to consider the newly added element for transition") so the new level's
transition starts on the same frame as everything else.

Related and also checked: `updateWhenZooming={false}` only suppresses the tile refresh when
`noUpdate` is truthy, which for a normal animated zoom it is not — it is set only by pinch
(`TouchZoom`, leaflet-src.js:14404). It has no effect on a wheel or double-click zoom.

### 2e. Not `setStyle` clobbering the circle's radius

`CircleMarker.setStyle` (leaflet-src.js:8302) does
`var radius = options && options.radius || this._radius; … this.setRadius(radius)` — where
`this._radius` is a **pixel** radius and `Circle.setRadius` writes **metres**. That would corrupt a
`Circle` on every restyle. It cannot happen: `Circle` explicitly overrides it back with
`setStyle: Path.prototype.setStyle` (leaflet-src.js:8406).

### 2f. Not dropped wheel events

`zoomSnap: 0.5` + `wheelPxPerZoomLevel: 120` + Leaflet's 40 ms wheel debounce does produce a lurchy
wheel zoom — `_tryAnimatedZoom` returns early while `_animatingZoom` is set, so ticks arriving
during the 250 ms animation are silently discarded. That is real, but it is not this: **double-click
reproduces the problem**, and `DoubleClickZoom` fires exactly one `setZoomAround`.

### 2g. What is left

Nothing is mathematically out of sync, so the panes must be **committing their transitions on
different frames** — a frame-budget problem, not a geometry one.

The leading hypothesis, to be confirmed by measurement before anything is changed: with hotspots on
the map carries **~940 marker icons** (Phase C's own DOM census, `PhaseC_rationale.md` §9 — 864
diamonds plus the sightings), each an absolutely-positioned div wrapping an inline multi-path
`<svg>`. Every zoom starts ~940 concurrent CSS transform transitions, and the SVG overlay pane is
re-rasterized on the main thread each frame because its transform carries a `scale` and Chrome does
not composite it by default. The tiles are a handful of large compositor-owned layers and keep
gliding regardless. That predicts precisely "the hotspot circle especially" — the circle is the one
element that is purely main-thread rasterized.

---

## 3. Measurement

Taken on the live app (`localhost:3000`, default settings, default search area) **before** any fix.

### 3.1 The harness cannot trace the animation — and that is proven, not assumed

```
visibilityState: "hidden"   rafAlive: false
```

`PhaseC_rationale.md` §10 recorded this: the automation tab is occluded, so
`requestAnimationFrame` never fires and Chrome throttles rendering. A per-frame trace of the
transition is therefore **not obtainable from this harness**, and no such trace is claimed below.
What *is* measurable without rendering is the cost Leaflet incurs at the start of every zoom, which
is the actual claim under test.

### 3.2 DOM census

| | |
|---|---|
| `.leaflet-marker-icon` | **993** |
| …carrying `leaflet-zoom-animated` | **993** (all of them) |
| …that are hotspot diamonds | **916** |
| SVG child nodes inside marker icons | **2024** |
| `.leaflet-overlay-pane` `will-change` | `auto` — **not promoted**, so the vector pane repaints on the main thread |

### 3.3 The cost of one zoom frame

On `zoomanim` Leaflet writes a fresh `transform` to every marker icon, and the browser must then
recalc style and layout for all of them on that same frame. Timed directly — write the transform to
every icon, force a style + layout flush, measure — five consecutive passes, in ms:

| | pass 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **all 993 markers** | 5.4 | 18.5 | 15.4 | 16.3 | **16.1** |
| **sightings only (77)** | 3.0 | 7.2 | 0.8 | 1.5 | **0.6** |

Steady state is **~16 ms against a 16.7 ms frame budget** — the entire frame, spent on style and
layout alone, **before anything is rastered or composited**, in a tab that is not even painting.
Dropping the hotspot diamonds takes the same work to **~1 ms**, a 10–25× reduction.

That settles §2g. The tile levels are a handful of large compositor-owned layers and keep gliding
on the compositor thread; the marker layer and the un-promoted SVG overlay pane cannot get their
first transition frame out on time and commit late. Hence: correct at rest, sliding during motion,
and worst on the vector circle.

**Stated honestly:** this measures style + layout for the transform writes, which is what Leaflet
does at `zoomanim`. It is a strong proxy for the per-frame cost, not a frame trace. The visual
confirmation still requires a focused Chrome window — see §6.

---

## 4. Edits

### 4.1 `components/Map.tsx` — a hotspot rendering budget (the fix)

The measurement in §3.3 says the problem is the number of animated marker icons, and 916 of the 993
are hotspots. So: **draw only the hotspots that are on screen, and cap what's left.**

New constants at the top of the file, with the measured numbers in the comment so the next reader
knows they are a rendering budget and not a taste preference:

```ts
const MIN_HOTSPOT_ZOOM = 10;        // below this a hotspot field is noise
const MAX_HOTSPOT_MARKERS = 150;    // ceiling, applied after viewport culling
const HOTSPOT_VIEWPORT_PAD = 0.25;  // margin so a small pan doesn't pop markers in
```

New `HotspotLayer` component. Three decisions in it are load-bearing:

- **The viewport state lives in `HotspotLayer`, not in `BirdMap`.** Hoisting it would re-render
  every sighting marker on every map movement — the exact per-frame cost being removed. Same reason
  `MapControls` owns its hover state and `MapLegend` owns its `open` state.
- **It subscribes to `moveend` only**, which fires after a pan *and* after a zoom. Subscribing to
  `move` or `zoom` would mount and unmount markers *inside* the frames that are already tight,
  which is the stall this is removing.
- **The cap takes the first N of a heat-sorted list**, so it keeps the *best* hotspots rather than
  whichever ones eBird happened to return first. `BirdMap`'s existing heat memo now emits a sorted
  `RankedHotspot[]` (`{ hs, ratio }`) instead of a `getHotspotHeat` closure plus `maxHeat`, so the
  ratio is resolved once rather than per marker per render.

**Nothing is filtered out of the data.** Every hotspot is still fetched, still in the sidebar, and
still appears on the map — pan or zoom in and the rest show up.

### 4.2 `app/globals.css` — a fix that was written, tested, and then deleted

The plan called for `.leaflet-overlay-pane { will-change: transform }` to promote the vector pane so
the dashed circle would stop repainting on the main thread each frame. It was added, and the browser
then reported the pane's computed `will-change` as `auto` — the rule had no effect.

Two reasons, both worth recording:

1. **It targeted the wrong element.** `Renderer._updateTransform` writes the zoom transform to
   `this._container`, which for the SVG renderer *is the `<svg>`*, not the pane div.
2. **It was unnecessary anyway.** leaflet.css:193 already ships
   `svg.leaflet-zoom-animated { will-change: transform; }` — verified in the compiled stylesheet at
   runtime. Leaflet 1.9.4 promotes that element itself.

So the search-radius circle was **already composited**, and its lag was never a rasterization
problem — it was purely the frame-budget stall from 993 marker transitions. The rule was removed
rather than left in place as a no-op with a comment claiming it mattered; a short comment now
records why there is deliberately nothing there.

### 4.3 `components/Map.tsx` — stop restyling both circles on every render

Both `<Circle>`s passed a fresh `pathOptions` object literal. react-leaflet compares it by identity,
so every `BirdMap` render called `layer.setStyle()` → `SVG._updateStyle` → `_updateDashArray` plus
attribute writes, on both circles. Now `useMemo`'d (`theme` is a module-level singleton per mode, so
they hold). Small, but it is the same class of identity churn the Phase B comment at
`components/Map.tsx:391` exists to warn about, and it costs one hook to remove.

### 4.4 Attribution off the map, credits into Settings

- **`components/Map.tsx`** — `attributionControl={false}` on `<MapContainer>`.
  `attribution={tileAttrib}` stays on the `<TileLayer>`: it is the layer declaring its own credit,
  it costs nothing with no control mounted, and it keeps working if a control is ever re-added.
- **`lib/tiles.ts`** — new exported `TILE_CREDITS: { label, href }[]` as the single definition;
  the existing `ATTRIBUTION` string is now derived from it, so the Leaflet form and the Settings
  form cannot drift.
- **`components/SettingsPanel.tsx`** — a `Credits` group at the bottom, using the existing `Group`
  helper and theme tokens: **Basemap** (the three credits, linked) and **Bird data** (eBird, Cornell
  Lab of Ornithology). All links `target="_blank" rel="noopener noreferrer"`.
- **`components/MapLegend.tsx`** — the width cap's comment justified itself as keeping clear of
  Leaflet's corner attribution, which no longer exists. Comment corrected to the real reason
  (layout). The cap itself is kept — nothing about this change makes a wider legend better.

### 4.5 Considered and not applied

- **`markerZoomAnimation={false}`** — would tag icons `leaflet-zoom-hide` and hide the marker pane
  outright for the 250 ms, making a desync unrepresentable. Held in reserve: §3.3 says the budget
  problem is solved by 4.1, and this costs visible pins during every zoom.
- **`zoomSnap` / `zoomDelta` back to `1`** — both were set to `0.5` in `b8ccb70`. At half-zoom
  stops Leaflet renders tiles at an integer zoom scaled by 0.707×/1.414×, so the basemap is
  permanently soft while markers and vectors stay crisp, which contributes to the "pasted on" read.
  **Not changed**, because the user reported the misalignment *only during motion* and this is a
  separate, at-rest complaint that changes how the map feels to drive. Worth revisiting on its own.
- **Replacing the per-marker inline `<svg>` with CSS shapes** (border-radius / rotated square).
  Would cut raster cost further, but it would break the Phase C invariant that the legend swatch
  *is* the marker — same string, no drift — for a win that §3.3 says is no longer needed.

---

## 5. Landmines

- **The three hotspot constants are a measured budget, not preferences.** Raising
  `MAX_HOTSPOT_MARKERS` or lowering `MIN_HOTSPOT_ZOOM` walks straight back into §3.3. If they need
  to move, re-run the §3.3 timing first.
- **`HotspotLayer` owning its viewport state is load-bearing**, and so is its subscribing to
  `moveend` rather than `move`/`zoom`. Both are the fix, not incidental structure. See §4.1.
- **There is deliberately no `will-change` for the overlay pane in `globals.css`.** Leaflet already
  ships it on the right element. Do not "add the missing promotion" — see §4.2.
- **Hotspots are culled, never filtered.** If a user reports a missing hotspot, the answer is zoom
  or pan, not a data bug.
- **The Stadia / OpenMapTiles / OpenStreetMap credits are a licensing obligation**, not decoration.
  They moved from the map corner to Settings → Credits; both licences require the credit to be
  available and discoverable, not painted over the map. Deleting the Settings group, or trimming the
  list, is a violation and risks the API key. `lib/tiles.ts` is the single definition.
- Everything `PhaseC_rationale.md` §11 lists is still true and untouched.

---

## 6. Known gaps — read before assuming this is fully verified

**The zoom animation itself was not observed.** `Map._tryAnimatedZoom` wraps `_animateZoom` in
`requestAnimFrame` (leaflet-src.js:4789), and the automation tab reports
`visibilityState === 'hidden'` with `requestAnimationFrame` never firing — measured, not assumed
(§3.1), and the same trap `PhaseC_rationale.md` §10 documented. Every number in §3.3 is a
style-and-layout cost for the transform writes Leaflet performs at `zoomanim`; **none of it is a
frame trace of the animation**, and no claim above rests on one.

What that leaves outstanding is the visual confirmation, which needs a **focused** Chrome window:

1. Turn on Settings → "Show radius circle". Pick a fixed landmark on the basemap — a road junction
   works well — sitting on or near the dashed circle.
2. Double-click zoom, then wheel zoom, in both light and dark mode. The circle and the pins must
   stay locked to that landmark for the whole 250 ms, not slide and catch up.
3. Repeat with hotspots on and off, and at a half-zoom stop (`zoomSnap` is 0.5, so zoom 11.5 is
   reachable and renders tiles scaled).

**Verified in this pass** (dev server, dark mode, default settings, radius circle on):

- Marker count **993 → 226** (150 hotspots + 76 sightings); frame cost **~16 ms → ~1.6 ms**
  steady state, measured the same way before and after on a settled page.
- `HotspotLayer` re-evaluates on `moveend` without error — a real double-click took the map from
  tile zoom 11 to 12 and the layer recomputed. The **cap** is confirmed binding at 150; the
  **`MIN_HOTSPOT_ZOOM` gate** and the behaviour of the cull while panning are **code inspection
  only**, because driving the map far enough needs the animated-zoom path above.
- Attribution control absent from the map; Settings → Credits renders all four links with correct
  `href`, `target="_blank"` and `rel="noopener noreferrer"`.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- Only console error is the pre-existing Grammarly hydration warning (`data-gr-ext-installed` on
  `<body>`), unchanged from `PhaseC_rationale.md` §9.

**The mobile breakpoint was again not driven** — same harness limitation as `phaseB_rationale.md`
§7 and `PhaseC_rationale.md` §10. The Credits group inherits the Settings panel's existing layout
and adds no new positioning, so the risk is low, but it is unverified.

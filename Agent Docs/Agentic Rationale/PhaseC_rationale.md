# Phase C — marker taxonomy, always-on legend, location privacy

**Follows:** `6c4c330 fix: phase b round` (see `phaseB_rationale.md`) and the Stadia tile fix
(`phaseB_fixes.md`).
**Date:** 2026-08-15
**Scope:** 13 files, +383 / −223 plus three new modules

```
lib/marker-style.ts               | new   — all marker artwork, one definition
lib/location-privacy.ts           | new   — the routing chokepoint
components/MapLegend.tsx          | new   — always-visible legend chip
components/Map.tsx                | 336 ++++++-------------
components/SettingsPanel.tsx      |  91 ++-------
components/SpeciesDetailPanel.tsx |  77 ++++-
app/api/alerts/run/route.ts       |  23 +-
components/HotspotPanel.tsx       |  22 +-
app/globals.css                   |  19 +-
components/AlertsPanel.tsx        |  15 +-
lib/ebird.ts                      |  11 +
app/page.tsx                      |   8 +
components/Icons.tsx              |   4 +
```

---

## 1. The three defects

1. **Four marker kinds shared two shapes.** Bird sightings were teardrop pins, hotspots were
   10 px circles, the drop-pin was another amber teardrop, the user dot a third round thing.
   Worse, within sightings the *only* tier signal was colour — and `lifer-rare` and `rare` are
   **the same red** (`#DC2626` / `#F87171`). To a red-blind user the two highest-urgency tiers
   were identical; to everyone else they differed by 4 px.
2. **The legend was buried and had already drifted.** It lived in Settings → Marker Legend,
   three taps from the map, and hand-copied the teardrop SVG path and hex codes out of
   `Map.tsx`. It rendered light-mode greens in dark mode and had no row at all for the drop-pin
   or the user dot.
3. **`locationPrivate` was read by nothing.** eBird flags personal locations; the app treated
   them exactly like public hotspots, and nothing structurally prevented a future directions or
   drive-time feature from routing a stranger to a birder's house.

---

## 2. Decisions taken with the user before implementing

| Question | Answer | Consequence |
|---|---|---|
| The brief says "keep circular markers", but sightings are actually teardrops and the *hotspots* are the circles. Which end state? | **Convert sightings to circles**, hotspots to diamonds | Centre-anchored icons ⇒ the tooltip offset constants had to be re-derived (§4) and the pulse `transform-origin` had to move (§5) |
| There are **no** directions actions anywhere in the app, so "hide directions" is a no-op. What should ship? | **Add a gated Directions action** | The privacy rule now guards a real affordance instead of a hypothetical one, and is testable |
| Should private locations be distinguishable on the map itself? | **Yes — dotted outer ring + its own legend row** | One more dimension on the icon cache key |
| What happens to the Settings legend? | **Both surfaces render the same shared rows** | `lib/marker-style.ts` became the single definition |

The user then amended the plan mid-flight with four things that materially improved it, all
implemented here: the **horizontal** tooltip offset needed the same derivation as the vertical
one (§4); the legend must not crowd Leaflet's attribution, which is a *licensing* constraint;
`routableTargets` was mis-scoped and became `navigableTargets` with drive-time explicitly kept
**in** (§7.4); and push-alert bodies needed a geographic fallback or the privacy label would
quietly gut the alerts feature (§7.5).

---

## 3. `lib/marker-style.ts` — artwork has one definition, three consumers

```
lib/marker-style.ts ──┬──► components/Map.tsx        (L.divIcon html)
                      ├──► components/MapLegend.tsx  (map chip)
                      └──► components/SettingsPanel  (Settings → Marker Legend)
```

Glyphs are emitted as **SVG markup strings**, not React elements. Leaflet needs a string for
`L.divIcon({ html })`; authoring React and serialising it would drag `react-dom/server` into the
client bundle. The legend feeds *the same string* to `dangerouslySetInnerHTML`, which is what
makes drift impossible — the swatch is not a drawing of the marker, it **is** the marker. It is
safe because every byte is generated from constants in that module; no user or API data reaches
it.

### The taxonomy

| kind | shape | why |
|---|---|---|
| sighting | circle, centre-anchored | tier by size **and** ring style |
| hotspot | diamond outline | different *shape*, so it can't be mistaken for a sighting |
| custom search | crosshair | unlike any sighting marker |
| user | blue dot + ground-unit accuracy halo | the platform convention |

Within sightings, colour is the **last** cue and never the only one. Both notable tiers stay
red — red means "eBird notable", and that's worth keeping — so they are separated by silhouette
and size instead:

```
lifer-rare  ◎  18px  disc + core + detached outer ring   (two concentric marks)  + pulse
lifer       ◉  16px  disc + core                          (one donut)            + pulse
rare        ◌  14px  dashed hollow ring, no fill
seen        ·  10px  flat disc, no ring, no core
```

`sightingBox()` derives the icon box from tier + privacy but **deliberately not from `focused`**.
The focus ring is allowed to overflow (every marker SVG sets `overflow="visible"`), so focusing a
species in the sidebar doesn't resize hundreds of icon boxes — and, because tooltip spacing is
derived from the box (§4), doesn't make the tooltip gap twitch as focus moves.

---

## 4. Tooltip offsets are now derived, not constant

**This is the highest-risk change in Phase C and the one most likely to be "tidied" back.**

Phase B hard-coded `TOOLTIP_GAP_ABOVE = -30` / `TOOLTIP_GAP_BELOW = 4`. Verified in
`node_modules/leaflet/dist/leaflet-src.js:10739` (`Tooltip._setPosition`): Leaflet places a
tooltip from the marker's latlng plus `options.offset` plus the icon's `tooltipAnchor`
(default `[0,0]`, leaflet-src.js:7380) — **icon size and `iconAnchor` are never consulted.** A
constant is therefore a constant *for one icon geometry*. Phase B had one (a 20×28 teardrop
anchored at its tip). Phase C ships boxes from 12 px (`seen`) to 34 px (private `lifer-rare`),
all centre-anchored.

```ts
const TOOLTIP_GAP = 4;
dyAbove = -(iconAnchor.y + TOOLTIP_GAP)                        // clear artwork above the anchor
dyBelow =  (iconSize.y - iconAnchor.y) + TOOLTIP_GAP           // clear artwork below it
dxSide  =  max(iconAnchor.x, iconSize.x - iconAnchor.x) + TOOLTIP_GAP
```

**The formula was sanity-checked against the values it replaces before being adopted.** Feed it
the old teardrop (`iconSize [20,28]`, `iconAnchor [10,28]`) and it yields `-32 / +4` against the
hand-tuned `-30 / +4`. It reproduces the tuning it replaces; that is why it can be trusted for
the four new geometries.

### The horizontal case mattered too

Phase B left the unflipped case at `offset={[0, 0]}`, which puts the tooltip's inner edge exactly
on the marker's latlng — overlapping half the glyph. Barely visible on a tip-anchored teardrop
whose artwork is all *above* the anchor; obvious on a centre-anchored dot. A single **positive**
`offset.x` gives a symmetric gap on both sides:

- `'right'`: `subX = 0` → left edge at `pos.x + offset.x`
- `'left'`: `subX = tooltipWidth + (offset.x + anchor.x) * 2` → right edge at `pos.x - offset.x`

That doubling is **Leaflet mirroring the offset, not a bug to work around** — it is precisely why
one value serves both sides. Do not "fix" it.

### Two implementation details

- **The side offset is applied synchronously in `tooltipopen`, before the `requestAnimationFrame`.**
  It depends only on the icon, not on the rendered tooltip size, and deferring it painted one
  frame of tooltip-over-glyph on every first hover. Only the *direction* decision needs the frame,
  because it needs `offsetWidth`/`offsetHeight`.
- **`iconTooltipMetrics()` bails out to the Phase B constants** if an icon omits `iconSize`/
  `iconAnchor`. `L.point(undefined)` returns `undefined` rather than throwing, so reading `.y`
  off it would blow up inside a rAF with no useful stack. Every icon in `Map.tsx` sets both; the
  guard is there so a future marker kind that forgets can't take the tooltip layer down.

**Measured, not assumed** (§9): the visual gap is `halfBox + 10 px` for every box size tested —
the extra 6 px over `TOOLTIP_GAP` is Leaflet's own `.leaflet-tooltip-left/right { margin: ∓6px }`,
which applies uniformly to all four directions and so preserves the symmetry.

---

## 5. `.bird-pin-pulse` had to stop pulling toward the tip

`globals.css` previously ran `@keyframes pinBobPulse` with `transform-origin: 50% 100%` and
`translateY(-3px)`. On a **tip-anchored teardrop** that grows the pin upward from a fixed tip —
correct. On a **centre-anchored circle** the identical rule swings the dot up and off the very
coordinate it represents, so a pulsing lifer no longer marks where the bird was.

Replaced with `@keyframes pinRingPulse`: `transform-origin: 50% 50%`, scale only, **no
translate**, same `--pin-glow-lo` / `--pin-glow-hi` custom properties. If you ever reintroduce a
bob, the marker must be re-anchored first.

The `.low-fi` kill switch and `.low-fi .leaflet-marker-icon svg { overflow: visible }` are
unchanged and still load-bearing — the second one is what lets focus and privacy rings overflow
their boxes.

---

## 6. The legend chip

`components/MapLegend.tsx` renders as a **sibling of `<MapContainer>`**, exactly like
`MapControls` — outside the Leaflet container, so Leaflet never sees its clicks or wheel events
and no `stopPropagation` plumbing is needed.

- **It owns its own `open` state.** Same reason `MapControls` owns its hover state: if `open`
  lived in `BirdMap`, expanding the legend would re-render every marker on the map. Its props are
  primitives plus `theme`, and `getTheme()` returns a module-level singleton, so `memo` holds.
- **Bottom-left at `left: 10, bottom: isMobile ? 86 : 30`** — matching `MapControls`, which clears
  the mobile tab bar. Leaflet's attribution is bottom-**right**, so the corner is free. The
  expanded card is width-capped rather than allowed to grow: Stadia's and OpenStreetMap's terms
  require the attribution to stay visible and legible, which makes that a **licensing**
  constraint, not a layout preference. Verified unobstructed at 1512 px in both themes.
- Swatches render at their **real size**, in a fixed-width gutter so labels line up. Normalising
  them to a uniform size would flatten the tier size ladder — one of the two cues that survives a
  colour-vision deficiency — and make the legend contradict the map.
- The `pulse` badges are gated on `settings.liferPulse` so the legend can't claim an animation
  the map isn't running. (With `lowBatteryMode` on — the default — no badges appear, matching the
  static markers.)
- Hidden entirely when `isMobile && detailOpen`; the 60 vh sheet covers that corner anyway and a
  mounted-but-invisible chip is just a stray tab stop.

`SettingsPanel`'s group now renders the same rows through the shared `LegendEntry`. Its five
hand-drawn `<svg>` blocks and its local `LegendRow` helper are gone.

---

## 7. Location privacy

### 7.1 What the flag actually means — and what it doesn't

`locationPrivate: true` marks a **personal location**: one the observer created instead of
picking an existing hotspot. Sometimes that is a home. Far more often it is a roadside pullout, a
trail junction, a parking lot, or a birder's own name for a corner of a public park. **The flag
means "not a hotspot", not "residence"** — and the two are indistinguishable through the API,
which is why the treatment is conservative rather than confident. Do not build anything on the
premise that private ⇒ dwelling.

### 7.2 eBird facts, measured against the live API rather than assumed

- `locationPrivate` is present in **both** feeds that reach `mergeObservations` —
  `/data/obs/geo/recent` (simple detail) **and** `/data/obs/geo/recent/notable`
  (`detail=full`). `classifyAll` preserves it by spread. No API-route change was needed.
- `obsId` remains full-detail-only, consistent with `phaseB_rationale.md` §4a.
- **Private is the common case.** In the app's default search area, **3 of 3** recent
  observations came back private. Anything that degrades when the flag is set degrades most of
  the time — which is what drove §7.4 and §7.5.
- **Two things that look like signals but are not:** private locations carry ordinary `L…`
  locIds (so `locId` format tells you nothing, and marker grouping in `lib/markers.ts` is
  unaffected), and their `locName` can look like any other place name. One live sample was
  `"Monohon Woods (Restricted Access)"`; another, hit during testing, was literally
  `"Backyard - Redmond, WA"`. **Only the boolean is a signal.**

### 7.3 Fail closed, except for hotspots

```ts
export function isPrivateLocation(o) { return o?.locationPrivate !== false; }
```

Only an explicit `false` is public. `undefined` — a truncated response, a fixture, a future feed
that drops the field — resolves to **private**. A false positive costs a missing Directions
button; a false negative routes a stranger to someone's house. Not symmetric.

**`Hotspot` has no `locationPrivate` field and must never be passed through this function** —
fail-closed would mark every hotspot private. That asymmetry is the whole reason there are two
functions (`observationDirectionsUrl` / `hotspotDirectionsUrl`) rather than one generic one.

### 7.4 `navigableTargets()` gates navigation — **not** drive-time

The original brief said to exclude private locations from future drive-time requests. That
instruction was revised during planning, and the revision is the important part to preserve:

> This plan plots private sightings at their **true coordinates** on the map. A drive-time
> *duration* is a number computed server-side, with no address and no route — it leaks strictly
> less than the pin the user is already looking at. Excluding private locations would therefore
> protect nothing while removing the badge from the majority of sightings.

So: private locations stay **in** the Phase D drive-time batch (round coordinates to 2 dp on the
way in if you want extra margin — at 15/30/60-minute banding it changes nothing), and stay
**out** of every navigation URL. If Phase D adds turn-by-turn or a route polyline, that *is*
navigation and goes back behind `navigableTargets()`. The function is named for what it guards
precisely so this doesn't get re-muddled.

### 7.5 Push alerts needed a geographic fallback

Substituting the privacy label into the notification body gives
`"🐦 Lifer nearby: Anna's Hummingbird — Personal location (approximate) · 6 mi away"`. With
private the common case, a label alone would make most alerts undecidable — quietly gutting a
feature Phase C never intended to touch. `alertPlace()` appends `subnational2Name` (county) when
present, and the distance from the subscriber was already in the body. County is `detail=full`
only, i.e. the notable feed, hence the optional chain; `lib/ebird.ts` gained
`subnational1Name?` / `subnational2Name?` for it.

### 7.6 Coordinate rounding is a **display** treatment and nothing more

`formatCoords()` prints 2 dp for private locations and 4 dp for public ones. The marker is still
plotted at the true coordinate. Rounding the plotted position would change the `locKey` in
`lib/markers.ts` and could merge genuinely distinct locations onto one pin — and would break the
Phase B invariant that the map and the detail panel resolve the same key to the same group.
**Do not describe this as coordinate obfuscation.**

### 7.7 The chokepoint

`lib/location-privacy.ts` is the only module in the codebase permitted to construct a navigation
URL. Enforcement is structural rather than by convention, and it is greppable:

```bash
grep -rn "google.com/maps\|maps.apple\|geo:\|/dir/" app components lib
```

must only ever hit that file. It currently returns exactly two lines: the doc comment above, and
line 70. **Run this in review.**

`LocationRow` renders the action **on the URL**, not on a disabled button holding a live href —
there is nothing there to re-enable. Where the button would be, a private location gets one
muted line of explanation instead, because a silently missing control reads as a bug.

One deliberate judgement call: for a private location the panel shows the label as the primary
line **and keeps eBird's `locName` beneath it in muted type**. eBird publishes that name itself,
so withholding it buys no privacy while costing real context. What is withheld is the thing that
actually enables a visit: the directions action and coordinate precision.

---

## 8. Accuracy halo

`pos.coords.accuracy` was already delivered at `app/page.tsx` and thrown away. It is now stored
as its own scalar (`userAccuracyM`) rather than a third slot in the `userLocation` tuple, so that
tuple's identity contract — read by `InitialLocationController` and `reCenterTarget` — is
untouched.

- Drawn as a Leaflet `<Circle>` in **ground units**, not a pixel ring. A pixel halo would lie
  about accuracy at every zoom but one.
- **`interactive={false}` is required, not cosmetic.** Paths bubble mouse events by default
  (leaflet-src.js:8166) — which is exactly what makes clicking the search-radius circle dismiss
  the detail panel (`phaseB_rationale.md` §3.6). A halo hundreds of metres wide must not become an
  invisible dismiss target parked over the user's own position. Verified in the DOM: the halo path
  has `pointer-events: none` and no `leaflet-interactive` class, while the radius circle keeps both.
- Suppressed when accuracy is not a finite positive number **or exceeds `MAX_ACCURACY_HALO_M`
  (5000)**. A coarse IP-derived fix reports tens of kilometres and would paint a blue disc over the
  whole map, which says "somewhere" rather than "here".

---

## 9. Verification — what was actually proven

`npm run lint`, `npx tsc --noEmit`, `npm run build` all clean.

Driven live in Chrome against the dev server:

- **All four kinds render and read apart**, in dark and light: circles / diamond outlines /
  crosshair / blue dot. DOM census with hotspots on: 940 markers — 864 diamonds, and circles at
  boxes 12, 18, 20, 26, 28, 34 (i.e. every tier × privacy combination present), 35 carrying the
  dotted private ring.
- **Tooltip spacing is uniform across icon sizes** — the point of the derivation. Measured gap
  from the glyph edge to the tooltip: box 18 → 19 px, box 20 → 20 px, box 26 → 23 px, box 34 →
  27 px. That is `halfBox + 10` in all four cases, i.e. an identical 10 px visual gap regardless
  of marker size. A constant `offset.x` could not produce this.
- **Privacy, both paths.** A private sighting: dotted ring on the map, lock + "Personal location
  (approximate)", eBird's own name beneath (`Backyard - Redmond, WA` — an actual backyard), coords
  `47.69, -122.16` at 2 dp, no Directions control, explanatory line in its place. A public
  sighting (`Marymoor Park`): coords `47.6613, -122.1184` at 4 dp and a Directions link resolving
  to `www.google.com/maps/dir/` with `destination=47.6612642,-122.1184109`,
  `target="_blank" rel="noopener noreferrer"`.
- **Chokepoint grep** returns `lib/location-privacy.ts` and nothing else.
- **Legend** chip visible on load, expands and collapses, `Esc` closes, every swatch matches its
  live marker (same string), Settings shows the identical rows, attribution unobstructed. In light
  mode the swatches render **light-mode** colours — the specific drift the old hand-drawn legend
  had.
- **Pulse** with `lowBatteryMode` off: 68 of 76 sighting markers animate (only the two lifer
  tiers), scaling about their own centres with no positional drift. With the setting on, zero
  animate and the legend drops its `pulse` badges to match.
- **Accuracy halo** present with the right paint and `pointer-events: none` (§8).
- **Phase B behaviours intact**: hover shows the tooltip and fires no request; click opens the
  panel; clicking the same pin again does not toggle it closed; map controls slide left; `Esc` and
  a bare map click both dismiss.
- Only console error is the pre-existing Grammarly hydration warning
  (`data-gr-ext-installed` on `<body>`), unrelated to this work.

---

## 10. Known gaps — read before assuming Phase C is fully verified

**The vertical tooltip edge-flip was not driven live.** The branch runs inside
`requestAnimationFrame`, and the automation tab reports `document.visibilityState === 'hidden'`
(the Chrome window is occluded), so **rAF callbacks never fire** — a bare
`requestAnimationFrame(() => fired = true)` also never resolves. Proven, not guessed: temporary
probes showed `tooltipopen` firing and `tooltip.update()` completing, then the rAF body never
executing. Everything measured above therefore exercises the **synchronous** path only.

What that leaves unverified is the *branch selection* (`'bottom'` near the top edge, `'top'` near
the bottom edge), not the arithmetic — `dyAbove`/`dyBelow`/`dxSide` all come from the same two
numbers, and `dxSide` is confirmed correct for four different icon boxes. **A manual pass with the
Chrome window in the foreground is still outstanding:** drag a circle marker to the top edge (the
tooltip must appear below it), then to the bottom edge (above it), then into a corner (no
horizontal clipping), for both a circle and a diamond.

**Two harness traps that cost a lot of time here — do not re-derive them:**

1. **The screenshot coordinate space is scaled.** Screenshots come back 1512×797 while the page
   viewport is 1463×771 — a factor of ≈1.0335. `computer` actions take *screenshot* coordinates,
   but `getBoundingClientRect()` returns *CSS* pixels. Feeding page coordinates straight to
   `hover` misses by ~26 px at the bottom of the page, which is more than a marker is wide. Scale
   by `1512 / innerWidth` and `797 / innerHeight`.
2. **Synthetic `mousedown`/`mousemove`/`mouseup` drags leave Leaflet's drag state latched**, after
   which `Layer._openTooltip` defers every subsequent open to a `moveend` that already happened —
   so no tooltip ever opens again. Use real `left_click_drag`. Note that real drags also carry
   inertia (`inertiaDeceleration: 2500`), so marker positions move *between* tool round trips;
   measure and act in as few calls as possible, or verify what is under the cursor at hover time.

**The mobile breakpoint was again not driven live** (same 1920-wide harness limitation as
`phaseB_rationale.md` §7). The legend's mobile placement (`bottom: 86`) and its auto-hide behind
the detail sheet are verified by code inspection only.

---

## 11. Landmines — things that look wrong but aren't

- **The icon cache key must name every input.** It is now
  `` `${tier}|${pulse}|${focused}|${lightMode}|${isPrivate}` `` (≤ 64 entries). Add a visual
  dimension without adding it here and markers silently share the wrong artwork.
- **Opacity is never baked into an icon.** It changes for nearly every pin when a species is
  focused, and a new icon identity means `setIcon()` → `_createIcon()` → `innerHTML` reset →
  every pulse restarts. It goes through `<Marker opacity>`. (Phase A comment, still true.)
- **`sightingBox()` ignores `focused` on purpose.** See §3.
- **The `'left'` branch doubling `offset.x` is correct.** See §4.
- **`interactive={false}` on the accuracy halo is load-bearing.** See §8.
- **`MapLegend` owning its `open` state is load-bearing.** See §6.
- **Both notable tiers being red is deliberate**, not an oversight — red encodes "eBird notable".
  The ring style and size are what separate them; don't "fix" it by recolouring one.
- **`dangerouslySetInnerHTML` in the legend is deliberate** and is what makes swatch/marker drift
  impossible. The markup is generated from module constants; no user or API data reaches it.
- **`reportCount` is still always 1**, so the "Reported N× this week here" block in
  `LocationRow` remains dead code. Pre-existing, out of scope, unchanged — same note as
  `phaseB_rationale.md` §9.
- **`.bird-popup` CSS is still needed** — the user dot and the crosshair search marker keep their
  popups. The crosshair's `popupAnchor` moved because it is now centre-anchored.

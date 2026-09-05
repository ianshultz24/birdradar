# Phase B — marker interaction & species detail UX

**Commit:** `6c4c330 fix: phase b round` (parent `b8ccb70`, the Phase A marker-stability work)
**Date:** 2026-08-13
**Scope:** 10 files, +1013 / −551

```
app/api/ebird/species/route.ts    |   5 +-
app/globals.css                   |  52 +++
app/page.tsx                      | 175 +++++++---
components/ChasePanel.tsx         |  70 ++--
components/Map.tsx                | 658 +++++++++++++-------------------------
components/SpeciesDetailPanel.tsx | 386 ++++++++++++++++++++++   (new)
lib/chase.ts                      | 132 +++++---
lib/ebird.ts                      |  18 +-
lib/markers.ts                    |  48 +++                      (new)
lib/species-photo.ts              |  20 ++                       (new)
```

---

## 1. The five defects

1. **Hover and click fought each other.** `HoverMarker` opened the full Leaflet popup on
   `mouseover` after a 130 ms intent delay. Because a `<Popup>` was *bound to the marker*,
   Leaflet's built-in click handler then **toggled** it — so clicking the pin you had just
   hovered closed the card. The popup also carried a `ChasePanel`, so merely skimming the
   cursor across pins fired network requests.
2. **The card clipped at viewport edges.** Leaflet popups only reposition via `autoPan`,
   which yanks the map — unacceptable for something opened by hover.
3. **Dropped-pin state was split in two.** `pinLocation` and `center` were independent
   states recombined ad-hoc at every consumer (`pinLocation ?? center` appeared in the
   circle, in `fetchData`, and in the sidebar's `userCenter`). Clearing a pin moved the
   circle immediately but left the old sightings and hotspots on the map.
4. **The sightings graph contradicted the last-seen text** ("one bar a week ago" beside
   "seen 8 hours ago").
5. There was no way to keep a species card open while panning, and on mobile the popup
   covered the map.

---

## 2. Decisions taken with the user before implementing

Asked up front because each would have produced materially different work:

| Question | Answer | Consequence |
|---|---|---|
| The card has no photo and no image source exists anywhere in the app — what should the panel do? | **Skip photos, but wire the groundwork** so a future feature is a small change, and ship nothing visible to users | `lib/species-photo.ts` returns `null`; the panel's `<SpeciesPhoto>` renders `null` |
| Graph window: 7 days as specified, or keep 14? | **Keep 14** | Only the bucketing changed; `SPARK_DAYS` is now a named constant |
| Should hotspot dots change too? | **Tooltip on hover, click opens the sidebar `HotspotPanel` directly** (no intermediate popup) | Required new mobile drawer wiring — see §3.3 |

The user also amended the plan mid-flight to require: a reusable location meta/action row
in the panel (landing site for the next two phases), a single `openDrawer()` chokepoint,
memoized `eventHandlers`, tooltip-offset flipping, and a check on the eBird dedupe key.

---

## 3. Architecture decisions and why

### 3.1 Marker grouping moved out of `Map.tsx` into `lib/markers.ts`, and up into `page.tsx`

`buildMarkerGroups(observations, dimSeenSpecies)` produces `[locKey, ClassifiedObservation[]][]`.
`app/page.tsx` memoizes it **once** and passes it *down* to `<BirdMap>`.

**Why not leave it in `Map.tsx`:** the detail panel resolves `selectedLocKey → group`. If the
map built the groups and the page built its own, a marker key could point at a group the
panel would assemble differently — a silent divergence that only shows up as the wrong bird
in the panel. One array, one memo, one truth. It also means the open panel's contents
update in place across a refetch, and the panel auto-closes if its location drops out of the
results (`selectedGroup` becomes `null`).

`visibleObservations()` is exported separately because the `dimSeenSpecies=false` filter is a
real product rule (hide seen/rare outright rather than dimming), not an implementation detail.

### 3.2 Selection state lives in `app/page.tsx`, not in `Map.tsx`

It *looks* like map-local state. It isn't: on mobile the bottom sheet and the sidebar drawer
occupy the same strip above the tab bar and **must be mutually exclusive**. That coordination
can only happen where both are visible.

`setDrawerOpen(true)` now appears at exactly **one** call site — `openDrawer()`, which always
clears `selectedLocKey` first. Enforcing the invariant at a chokepoint rather than at each
opener is deliberate: a future `setDrawerOpen(true)` added elsewhere (a drag-handle peek, a
deep link) would otherwise silently reintroduce the overlap. **If you add a drawer opener, go
through `openDrawer()`.**

### 3.3 Hotspot click opens the sidebar panel directly

`handleHotspotDetail` sets the hotspot, clears the selection, and **on mobile also opens the
drawer**. Without that last part the click would appear to do nothing, because `HotspotPanel`
renders inside the sidebar — which on mobile is a closed drawer. (`HotspotPanel` overlays
`panelContent` at `inset: 0` regardless of active tab, so no tab switch is needed.)

### 3.4 The panel is keyed on `selectedLocKey`

`<SpeciesDetailPanel key={selectedLocKey} …>` remounts on selection change, which resets the
pager index and any half-filled add-to-life-list form for free. The alternative — the
adjust-state-on-prop-change pattern used in `HotspotPanel` — needs two pieces of state and
gets it wrong the first time someone adds a third.

`ChasePanel` is additionally keyed on `speciesCode` so paging between species at one location
remounts it. It refetches, but `lib/chase.ts` caches for 3 minutes, so no network.

### 3.5 Entrance animation only

The panel mounts/unmounts rather than staying mounted with an `open` prop. Exit animation
would require retaining the last group to render during the slide-out, plus suppressing
`ChasePanel` so a closing panel doesn't fetch. Not worth it — and `lowBatteryMode` defaults
to `true`, so most users see no transition at all. Entrance uses a `requestAnimationFrame`
flip; `reduceMotion` starts at the resting position.

### 3.6 No `<Popup>` bound to bird pins *at all*

This is the actual fix for defect 1, and it's worth being explicit about why it isn't a
suppression hack. Leaflet's `Marker._openPopup` toggle only exists when a popup is bound.
Removing the binding removes the behaviour — there is no `stopPropagation`, no flag, nothing
to get out of sync.

The user-location dot and the drop-pin marker **still use popups**, which is why the
`.bird-popup` rules in `globals.css` stay.

`MapClickHandler` dismisses the panel on a bare map click. This is safe because Leaflet's
`Marker` defaults to `bubblingMouseEvents: false` (leaflet-src.js:7756) so a pin click never
reaches the map, while `Path` defaults to `true` (:8166) so clicking the search-radius circle
*does* dismiss — which is the wanted behaviour, not an accident.

### 3.7 Tooltip placement is computed, not measured

`useTooltipEdgeFlip()` derives the would-be position from the marker's container point and the
element's own `offsetWidth`/`offsetHeight`, rather than reading `getBoundingClientRect()`.

**Why:** react-leaflet portals the tooltip children in on *its own* `tooltipopen` listener and
then calls `instance.update()` from a passive effect. Measuring the element's current position
races that — on first hover you'd measure a correctly-sized box sitting at the position
computed for an empty one. Computing the answer from the anchor and the size is immune to
when Leaflet last repositioned anything. A single `requestAnimationFrame` still wraps it, so
the children have mounted and `offsetHeight` is real.

Three details that are easy to get wrong:

- **`direction: 'auto'` is not viewport-aware.** It picks left/right from the *map centre*
  (leaflet-src.js:10766). That makes horizontal clipping impossible, but both options are
  vertically centred on the anchor, so a pin within half a tooltip of the top/bottom edge
  still clips. That's the only case the flip handles.
- **The offset must flip with the direction.** Leaflet applies `options.offset` *after*
  choosing the direction, so a gap tuned for `'top'` drags a `'bottom'` tooltip up over its
  pin. `TOOLTIP_GAP_ABOVE` is `-30` because a marker's latlng sits at the **pin tip** and the
  artwork extends upward — it has to clear the tallest pin (28 px).
- **A vertical flip centres the tooltip horizontally on the pin**, which can clip in a corner.
  A horizontal nudge (`dx`) pushes it back inside.

`tooltip.update()` is safe here in a way it would not be on a `Popup`: `Tooltip._adjustPan` is
a no-op (leaflet-src.js:10738), so it cannot yank the map out from under the cursor.

### 3.8 Tooltips only render when the pointer can hover

`canHover` gates `<Tooltip>` entirely. Leaflet's `bindTooltip` wires `click` to open the
tooltip when `Browser.touch`, which would race the click that opens the panel.

### 3.9 `eventHandlers` are memoized

react-leaflet compares the handlers object by reference and does a full `off`/`on` cycle when
it changes. Focusing a species in the sidebar changes `opacity` on nearly every pin, so an
inline object literal would mean thousands of listener rebinds per sidebar click. Deps are
`[tooltipHandlers, onSelect, locKey]` — all stable. `onSelect` is frozen through the existing
`useStableCallback` hook.

This is the same class of concern as the Phase A comments in `Map.tsx` about `setIcon` and
memoized position tuples. **Treat `BirdPinMarker`'s prop list as load-bearing: primitives and
stable references only.**

### 3.10 `searchCenter` as one derived value

```ts
const searchCenter   = pinLocation ?? baseCenter;          // memoized
const searchRadiusKm = pinLocation ? 50 : min(searchRadius, 50);
const searchKey      = `${lat.toFixed(2)},${lng.toFixed(2)},${searchRadiusKm}`;
```

`center` was renamed `baseCenter` (GPS fix / deep-link coords / `DEFAULT_CENTER`). `pinLocation`
survives as its own state because the amber marker and the Clear Pin button still need to know
a pin exists. Deep links keep working: the `?lat=&lng=` branch sets `baseCenter` and skips GPS,
so `userLocation` stays `null` and `searchCenter` resolves to the deep-link coords.

**Three effects collapsed into one** keyed on `searchKey` — mount, GPS fix, pin drop, pin clear
and radius change all funnel through it. On any change after the first it clears
`observations` / `hotspots` / `targetSpecies` / `selectedLocKey`, resets `notifiedRef` and
`isFirstFetchRef`, then fetches. **Clearing the layers up front is what makes the stale-pin bug
unobservable rather than merely unlikely** — there is no window in which markers from one place
sit inside a circle around another.

`handlePinDrop` / `handleClearPin` now only move the pin. All consequences live in the effect,
so the two paths cannot drift.

`fetchData` reads `searchCenterRef` and `searchRadiusRef` and nothing else about location —
including the lifer-notification distance check, which previously had its own
`pinLocationRef ?? centerRef` expression.

**Removed `lastFetchRef.current = 0`.** The old code zeroed it to force the fetch past the
throttle. But the throttle only fires when `paramsKey === lastFetchKeyRef.current`, and a
changed `searchKey` means a changed params key — there was nothing to bypass. Worse, zeroing it
told the auto-refresh visibility catch-up (`Date.now() - lastFetchRef.current >= intervalMs`)
that the data was infinitely stale, so a tab focus right after a pin change fired a second
identical round of requests. Verified against the running app: pin drop logged
`lastKey 47.65,-122.17,25` while fetching `47.74,-122.49,50`.

**Bonus fix:** the radius circle drew `settings.searchRadius` while a dropped pin actually
searched 50 km. `searchRadiusKm` is now passed to the map and used for both the circle and the
drop-pin popup's "Searching up to N km" text.

### 3.11 Map controls step aside

The desktop panel is a fixed-width column over the right edge, where the Refresh / Center /
Drop Pin stack lives. `MapControls` takes `detailOpen` and shifts `right` by
`DETAIL_PANEL_WIDTH + 10`. On **mobile** the sheet simply covers them — which is exactly what
the sidebar drawer already does, so no special handling.

`DETAIL_PANEL_WIDTH` is exported from `SpeciesDetailPanel.tsx` and imported by `Map.tsx` so the
two can't drift.

---

## 4. The graph bug (defect 4) — three separate causes

### (a) The graph and the text came from different data

The card's "seen 8h ago" is `timeAgo(obs.obsDt)` on an observation from the merged
`recent` + `notable` feed. The graph came from a *separate* fetch of `/api/ebird/species` →
`/data/obs/geo/recent/{code}?back=30`.

**eBird facts worth remembering** (these drove the design and are not obvious from the docs):

- `/data/obs/geo/recent/{speciesCode}` returns **only the most recent record per location**.
  A bird staked out at one spot for ten days contributes exactly one bar. This endpoint can
  therefore *never* produce a truthful daily history.
- It **excludes provisional (unreviewed) records by default** — which is precisely the
  unreviewed rare-bird reports that make a pin notable in the first place. Now sends
  `includeProvisional=true`.
- `obsId` is only returned under `detail=full`. The species-history endpoint doesn't use it,
  so **`obsId` is useless as a cross-feed dedupe key**. `lib/chase.ts` keys on
  `subId|speciesCode|obsDt` instead. An `obsId`-first implementation would silently dedupe
  nothing.

**Fix: seed the history with the observations the app already holds.** `fetchChaseStats` takes
`seed: Observation[]`; `ChasePanel` takes `seedObs`; `SpeciesDetailPanel` fills it. The record
the header describes is then guaranteed to be in the array the graph is built from.

Two consequences:

- The module cache in `lib/chase.ts` now holds the **raw `Observation[]` promise**, not the
  computed `ChaseStats` — different seeds share one network fetch and each computes its own
  stats. Cache key unchanged.
- **The seed is filtered to the displayed species.** A pin can hold half a dozen species;
  folding all of their reports into one species' history would inflate every one of them.
  `seedObs` is a `useMemo` on `[group, speciesCode]` — it's an effect dependency and **must
  stay a stable reference**.

### (b) Date parsing

`parseObsDt` did `new Date(dateStr.replace(' ', 'T'))`. For `"2026-08-13 14:30"` that's correct
— an ISO date-*time* with no offset is parsed as **local**. But eBird omits the time on
checklists that lack one, and `"2026-08-13"` is a date-*only* form, which the spec parses as
**UTC midnight** — shifting it a full day earlier everywhere west of Greenwich. Now appends an
explicit `T00:00`. Also guards blank/malformed input (returns an Invalid Date) and `timeAgo`
returns `'unknown'` rather than `"NaNw ago"`.

This function is used by `timeAgo`, `mergeObservations`, `HotspotPanel` and `computeChaseStats`,
so the fix lands in all four.

### (c) Bucketing

`computeChaseStats` mixed **two incompatible notions of "day"** in one loop:
`Math.floor((nowMs - t) / DAY_MS)` (elapsed 24-hour periods → `daySpark`) and
`obs.obsDt.slice(0, 10)` (calendar date strings → `dayKeys7`/`dayKeys14`). A sighting at 11pm
last night reads as "today" in one and "yesterday" in the other. **That is the graph
contradicting the numbers printed next to it.**

Replaced with a single local-calendar day index:

```ts
let dayIndex = Math.round((startOfLocalDay(now) - startOfLocalDay(obsDate)) / DAY_MS);
```

`Math.round`, not `floor` — DST makes some local days 23 or 25 hours long. Tomorrow-dated rows
(traveller in a later timezone, clock skew) fold one day of slack into "today"; anything
further ahead is dropped. `daySet7` / `daySet14` are now `Set<number>`.

### (d) Honest caption

Even seeded and provisional-inclusive, the one-row-per-location limit means
`daysWithReports14` is a **lower bound**. The caption reads "Reported on **at least** N of the
last 14 days nearby", with a distinct zero-state. Do not "tidy" this back to a bare count —
it would be a false claim. There is no free eBird endpoint returning full per-day history for
a species in an area without ~30 calls.

---

## 5. Bugs found while testing (not in the original brief)

- **`fmtAgo` rounded while `timeAgo` floored.** A 17.6h-old sighting read "17h ago" in the
  header and "18h ago" in the odds footer — inches apart, now from the same array. `fmtAgo`
  floors to match.
- **`fmtHour(24)` printed "12pm".** The best-window search runs to a 21:00 start and adds 3,
  so a 9pm–midnight window rendered as "9pm–12pm". Now wraps with `h % 24`.
- **`ChasePanel`'s footer said "seen 8h ago"** for a 25 km radius while the header timestamp
  was for one location. Relabelled "last seen nearby …" — with seeding they can still
  legitimately differ, so the wording has to carry that.
- **The tooltip collapsed to its narrowest wrap point.** Leaflet ships
  `white-space: nowrap`; turning that off alone gives a ~65px-wide box. Needs
  `width: max-content` *with* `max-width`.

---

## 6. Verification — what was actually proven

Ran clean: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

Driven live in Chrome against both the dev server and a production build:

- Hover a pin → tooltip with species + time; **no network request fires** (checked in the
  network panel); no card opens.
- Click → panel opens, tooltip closes, map controls slide left. Clicking the same pin again
  does **not** toggle it closed. Panel survives panning and hovering other pins.
- Close via ×, via `Esc`, and via a bare map click — all three.
- Pager: `1/2 → 2/2` swaps species; the `seen`-tier bird correctly shows no sighting odds and
  "✓ On life list".
- **Edge flip both directions:** a pin dragged to the top edge rendered its tooltip *below*,
  one at the bottom edge rendered *above*, both fully visible, no map pan.
- **Pin flow:** drop a pin ~30 km away → one `recent`/`notable`/`hotspots` triple at
  `47.74,-122.49,50`. Clear it → layers clear, one triple at `47.65,-122.17,25`, counters
  return to the original area's data **with no manual refresh**.
- **Graph consistency:** on a `Lifer` with an 18h-old sighting the TODAY bar was lit, the
  header said 18h, and "last seen nearby" said 18h. Confirmed on a rare/notable species too —
  previously the worst case.
- No console errors.

**A false alarm worth recording** so nobody re-investigates it: `performance.getEntriesByType('resource')`
appeared to show **8** eBird requests per page load, suggesting a double-fetch. It does not.
Each fetch is recorded twice — once as `initiatorType: "fetch"` with `transferSize: 0`, once as
`initiatorType: "other"` with the real transfer. Temporary instrumentation inside the effect
and inside `fetchData` proved **one effect run and one `fetchData` per state change** (mount,
pin drop, pin clear). A worktree build of `b8ccb70` was stood up on a second port for
comparison during this investigation; it has been removed.

Also: local testing produces a lot of **503s from `/api/ebird/*`**. That is
`ebird-proxy.ts`'s global upstream budget (`UPSTREAM_BUDGET_PER_MIN`, default 100) doing its
job. `.env.local` configures Upstash Redis, so **the budget is shared across every local
server you have running** — dev and prod builds on different ports drain the same bucket.
Wait out the minute rather than chasing a phantom bug.

---

## 7. Known gaps — read this before assuming Phase B is fully verified

**The mobile breakpoint was never driven live.** The browser harness pins the viewport at
1920×957: `resize_window` reports success but nothing changes, OS-level window resizing (via
Win32 `MoveWindow`) targets a different Chrome window, and script-opened popups are blocked.
Desktop is verified end to end. **The mobile layout and the drawer/sheet interlock are verified
by code inspection only.** A manual pass at 390 px is still outstanding:

- Sheet sits above the tab bar and is capped at 60vh
- Opening a sidebar tab closes the sheet, and vice versa
- Hotspot click opens the drawer
- Tooltips do not appear (touch pointer)

**`bottom: 56` on the mobile sheet** matches the sidebar drawer exactly. On devices with a home
indicator the tab bar is taller than 56 px (`paddingBottom: env(safe-area-inset-bottom)`), so
both overlap it slightly. Pre-existing and consistent — fix both together or neither.

**Desktop → mobile resize with the panel open** could briefly show the sheet and drawer
together if the drawer was already open. Not handled; low value.

---

## 8. Notes for the next phases

The user flagged two follow-ups that land in this panel. It was built to receive them:

- **Location privacy** (`locationPrivate` → "Personal location (approximate)", directions
  suppressed) and
- **Drive-time badge + Chase Mode affordance**

Both belong in `LocationRow` in `SpeciesDetailPanel.tsx`. It already has its own block with a
name line and a meta row, deliberately structured so a badge and a disabled-directions state
drop in **without restructuring the layout**. Don't paint it into a corner.

For the **photo feature**: `lib/species-photo.ts` documents the intended source (Wikimedia REST
summary keyed on scientific name → `thumbnail.source`). Two constraints:
1. Proxy it through an `/api` route so it inherits `ebird-proxy.ts`'s caching, per-IP rate
   limiting and upstream budget rather than hitting Wikimedia from the browser.
2. **`next.config.ts` CSP must gain the image host** — `img-src` is currently
   `'self' data: blob: tiles.stadiamaps.com <posthog>`. A remote thumbnail will be blocked
   without it.
   The panel treats a `null` return as "no photo", not "not yet" — an async source needs its
   own loading state.

---

## 9. Landmines — things that look wrong but aren't

- **`reportCount` is always 1**, so the "Reported N× this week here" block in the panel is dead
  code. `freqMap` in `page.tsx` counts duplicates within `/data/obs/geo/recent`, which returns
  one row per species per location. Pre-existing, out of scope, left alone deliberately — not a
  Phase B regression.
- **`.bird-popup` CSS is still needed.** The user-location dot and the drop-pin marker keep
  their popups.
- **`baseCenter` vs `searchCenter`.** Nothing outside the derivation should read `baseCenter`.
  If you find yourself writing `pinLocation ?? something`, you are recreating defect 3.
- **`SPARK_DAYS` is exported from `lib/chase.ts`** and consumed by `ChasePanel` for the bars,
  the axis captions *and* the caption text. Change it in one place.
- **`InvalidateSizeController` fires for nothing today** — the panel overlays rather than
  resizes the map. It's insurance for a future layout that does resize the container. The
  original brief asked for `map.invalidateSize()` on container resize; this is that, kept
  general rather than wired to one specific trigger.

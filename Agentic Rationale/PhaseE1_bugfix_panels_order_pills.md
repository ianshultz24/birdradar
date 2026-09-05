# PhaseE1_bugfix — the hotspot panel on the wrong side, the scroll past Target Species, and the pills that went solid green

> **Heading corrected in Phase E2.** This file previously called itself
> `PhaseE2_bugfix`, which was wrong on both counts: it follows E1 and it fixes
> E1's own work, as §2b and §7.1 say throughout. There was no Phase E2 when it was
> written. The real Phase E2 is the Eastside Audubon donation prompt
> (`PhaseE2_rationale.md`); nothing in this document relates to it.

**Date:** 2026-08-31
**Follows:** `PhaseE1_bugfix_sort_drivetime.md`, `PhaseE1_fixes.md`, `phaseB_rationale.md`

**Three reports. Two of them are this project's own last fix coming back.**

- **Bug 1 — hotspots.** `HotspotPanel` rendered at `inset: 0` *inside the left
  sidebar*, covering the observation list. A bird pin opens a right-hand panel
  over the map. Same gesture, same map, two different destinations — and the one
  the hotspot took over belongs to observations. §2a.
- **Bug 2 — the scroll.** PhaseE1 §4a made the sort's effect reachable by
  **scrolling 1479 px past Target Species**. The ordering became visible; the
  panel now lurched. The cause was never the scroll's absence, it was the section
  order, and E1's own invariant #2 said so. §2b.
- **Bug 3 — the pills.** PhaseE1 §4c replaced a 5% tint with a solid `accentSoft`
  fill. It solved a real ambiguity and the user disliked the result. §2c.

§3 and §5 are the payload. **This document supersedes PhaseE1 invariants #2 and
#3** — read §7.1 before reinstating anything from that file.

---

## 1. Symptom

Verbatim, as reported:

> I noticed that when you click a hotspot, it pops up on the left sidebar — this
> makes absolutely no sense, because those are where observations are supposed to
> be, and when you click a bird observation on the map, it pops up a new sidebar
> on the right. Do the same thing with hotspots.

> It now correctly sorts, but it also just scrolls down past the Target Species,
> making the list look a little weird — when selecting different categories and
> the computer re-sorts the observations, it should be at the top of the list, and
> target species shouldn't be above that.

> Also, in the last bugfix, the category buttons somehow got changed. I liked how
> they looked before, and now they're just solid green.

All three were confirmed reproducible before any code was read. Note that Bug 2 is
**not** a regression report: the sort works. The complaint is about the mechanism
that made it work, which is a different and more useful thing to be told.

---

## 2. Root cause

### 2a. Bug 1 — the panel was placed where the component already lived

`components/Sidebar.tsx` rendered:

```jsx
{hotspotPanel && <HotspotPanel … />}      // inside panelContent
```

and `HotspotPanel`'s root was `position: absolute; inset: 0; zIndex: 10`, so it
covered `AlertsPanel` entirely. Meanwhile `app/page.tsx` rendered
`SpeciesDetailPanel` in the map column as a 340 px right-hand column.

The decision is on the record and it was never argued on its merits.
`phaseB_rationale.md` §3.3 reads, in full, that the hotspot click "opens the
sidebar `HotspotPanel` directly" — and the only *reason* given is a consequence,
not a justification: "**Without that last part the click would appear to do
nothing, because `HotspotPanel` renders inside the sidebar.**" The panel was in
the sidebar because that is where the component already was.

The same document's §3.4 and §3.6 established the opposite pattern for everything
else clicked on the map: no popup, a persistent right-hand panel, keyed on the
selection. Hotspots were the one map object that did not follow it.

The mobile wiring inherited the mistake. `handleHotspotDetail` called
`openDrawer()` — **opening** the sidebar drawer — for the sole reason that the
panel was inside it. `handleSelectSighting`, three lines above, calls
`setDrawerOpen(false)`. Two openers for two panels in the same slot, doing
opposite things.

### 2b. Bug 2 — the scroll was a workaround for the section order

`AlertsPanel` rendered, in order: Target Species → Arriving Soon → **the three
sorted sections**. The first two cannot be ordered by the sort control and never
could be — a `TargetSpecies` has a `nearbyCount`, an `ArrivingSpecies` has an
arrival date, and neither carries recency, distance or a chase score. PhaseE1
measured them at 22 cards and **1681 px — 2.13 viewport heights** — of
sort-invariant content sitting between the control and the first card it touches.

PhaseE1 fixed the *visibility* of the sort by scrolling to it
(`AlertsPanel.tsx:247-284`, 38 lines and a 40-line comment). That is a correct
diagnosis with the wrong remedy applied, and PhaseE1's own §7 invariant #2 wrote
down the right one without taking it:

> **Anything rendered above `sortedRegionRef` is sort-invariant and pushes the
> sorted content down.** … If one is added, **it belongs below the sorted
> region**, or the region needs to be reachable another way.

It chose "another way". The other way is a 1479 px jump on every click of a
three-way toggle.

### 2c. Bug 3 — a real ambiguity solved with the loudest available instrument

The pre-E1 active pill was `background: t.accentBg`, which in light mode is
`rgba(27,67,50,0.05)` — over white, ≈`#F2F4F3`. The hover state is `t.bg2`,
`#F1F3F5`. That is a difference of roughly one value step, under the cursor that
just clicked. PhaseE1 §4c is right that "did my click register?" was not
answerable from the screen.

Its fix was `t.accentSoft` (`#2D6A4F`) with white text at weight 700 — a solid
green block. It is unambiguous, and it is the only solid fill of its kind in the
panel. **The ambiguity was between two backgrounds; it did not require a third
background, it required a cue that is not a background.**

---

## 3. Ruled out

Evidence, not inspection. Do not re-derive these.

- **`lib/alerts-sort.ts` — for the second consecutive phase, not one line.**
  `npm test` is 12/12 before and after. PhaseE1 §2a already proved the comparators
  correct in Node and in the browser; this report adds live confirmation from the
  screen (§6, checks 7–8, 10). If the Alerts ordering is ever reported wrong
  again, run `npm test` **first** — it needs no server, no key and no browser.
- **A stale bundle.** Full process kill on the dev server, `.next` deleted,
  cold `npm run dev`, hard reload. All three symptoms present before the change,
  absent after, in the same session.
- **That the sort scroll might still be needed after reordering.** Measured, not
  assumed: with the sorted region first, `scrollTop` is **0** when the panel opens
  and stays where the user left it across Recent → Closest → Chase → Recent. The
  effect's own guard (`top < scroller.clientHeight * 0.5`) would have made it a
  permanent no-op, so it was removed rather than left as dead code behind a
  40-line comment explaining a measurement that no longer applies.
- **That `DETAIL_PANEL_WIDTH` might need a hotspot-specific twin.** It does not.
  Measured live: the panel's rect is `left 1580, right 1920, width 340` in a
  1920 px viewport, and `MapControls` sits at `right: 350` — exactly
  `DETAIL_PANEL_WIDTH + 10`. One constant, two panels, zero drift.
- **That keying `HotspotPanel` on `locId` might not reset its fetch state.**
  Clicked McCormick Park (109 spp, last obs 4w ago) then Snohomish Flats (136 spp,
  7w ago) without closing: title, species count and body all updated. The old
  `shownLocId` adjust-state-on-prop-change block was removed on that evidence, not
  on the assumption that the key would cover it.
- **A new console error.** The only console error in the whole session is the
  Grammarly hydration warning (`data-new-gr-c-s-check-loaded` /
  `data-gr-ext-installed` injected on `<body>` by the extension). Same one PhaseE1
  §5 recorded. Still not ours.
- **`getComputedStyle` as a readback.** Not used. PhaseE1 §7.4 records it
  disagreeing with `aria-pressed` twice; every pill assertion in §6 below reads
  `getAttribute('style')`.

---

## 4. The change

### 4a. `HotspotPanel` becomes a right-hand panel (`components/HotspotPanel.tsx`)

It adopts `SpeciesDetailPanel`'s shell **wholesale rather than approximately** —
same `DETAIL_PANEL_WIDTH` import, same `zIndex: 1002`, same mobile bottom sheet at
`bottom: 56 / maxHeight: 60vh`, same `requestAnimationFrame` slide-in, same
`reduceMotion` bypass, same Escape handler, same `role="dialog"`. Two panels that
occupy the same slot and are mutually exclusive must not have two implementations
of the same shell; that is how one of them gets a case wrong.

- The header's `←` became `✕`. A back arrow implied a stack to pop inside the
  sidebar. There is nothing behind this panel now.
- The `shownLocId` block is **deleted**. The parent keys on `locId`, so a
  different hotspot is a remount — `phaseB_rationale.md` §3.4's reasoning, applied
  to the component that §3.4 explicitly cited as the counter-example.
- The fetch effect, the dedupe, `hotspotDirectionsUrl`, the species rows and the
  `+ Add` buttons are untouched.

### 4b. One panel at a time, enforced at three call sites (`app/page.tsx`)

The mobile drawer, the species sheet and the hotspot sheet now all occupy the same
strip above the tab bar, so each opener clears the other two:

| opener | before | after |
|---|---|---|
| `handleSelectSighting` | closes drawer | closes drawer **+ clears hotspot** |
| `handleHotspotDetail` | clears sighting, **opens drawer** on mobile | clears sighting, **closes drawer** on mobile |
| `openDrawer` | clears sighting | clears sighting **+ clears hotspot** |

`openDrawer` remains the single chokepoint `phaseB_rationale.md` §3.2 insists on;
its invariant simply has a third member now.

`onCloseDetail` — wired to `MapClickHandler`'s `onDismiss` — clears both. A click
on empty map must dismiss whichever panel is open, or the hotspot panel silently
lacks a gesture the species panel has.

### 4c. The map steps aside for either panel (`components/Map.tsx`)

New `hotspotOpen` prop, and one derived `rightPanelOpen = !!selectedLocKey ||
hotspotOpen` passed as `detailOpen` to **both** `MapLegend` and `MapControls`.
Deriving it once rather than writing the expression twice is the point: the two
consumers do different things with it (`MapLegend` hides on mobile,
`MapControls` shifts left on desktop) and a fix applied to one of them only is
invisible until someone opens the other panel.

`selectedLocKey` still drives marker highlighting alone — hotspot markers have no
selected state and this change does not invent one.

### 4d. The sorted sections come first (`components/AlertsPanel.tsx`)

Target Species and Arriving Soon move **below** Seen Nearby. Rendered order is now
Lifer Opportunities → Rare → Seen Nearby → Target Species → Arriving Soon.

This deletes, rather than tunes, the entire E1 scroll mechanism:
`sortedRegionRef`, `prevSortRef`, the `useEffect` on `sortBy`, the wrapper `div`,
and `useRef` from the import.

They are kept **in full** below the fold, not collapsed and not demoted to a link.
They are still the answer to "what should I go looking for"; they simply are not
the answer to "order my sightings", and they no longer stand between the control
and the thing it controls.

### 4e. The caption stops explaining a defect that no longer exists

It read *"Orders the sightings below, not Target or Arriving"* — a sentence whose
only job was explaining why the top of the panel did not move. That is now false,
and a stale explanation is worse than none. It states the active ordering instead:
*"Newest sightings first"* / *"Nearest sightings first"* / *"Ranked by chase
odds"*, keeping the live `Scoring by chase odds…` status. `leadInCount`, whose
only reader was that sentence, is gone.

### 4f. The pills: tint restored, disambiguated by shape

| | pre-E1 | E1 | now |
|---|---|---|---|
| background | `accentBg` | `accentSoft` | **`accentBg`** |
| color | `accent` | `accentFg` | **`accent`** |
| weight | 600 | 700 | **600** |
| active marker | *none* | the fill | **`borderBottom: 2px solid accent`** |

The underline is the load-bearing part. §2c's ambiguity is between two
*backgrounds*; an underline is a different channel, so it survives the two
backgrounds being one value step apart. Every pill carries
`borderBottom: 2px solid transparent`, so making one accent-coloured changes no
heights and shifts nothing in the row — **do not "simplify" that to setting
`borderBottom` only on the active pill.** `aria-pressed` is retained.

---

## 5. Deliberately not changed

- **`lib/alerts-sort.ts`.** Not one line, for the second phase running. Both of
  the last two reports named the sort and neither cause was in it. Editing it
  would write a false cause into the history.
- **Target Species and Arriving Soon are still rendered in full, and still
  unsorted.** They genuinely have no orderable field. Moving them is the fix;
  hiding or collapsing them would be a different, unrequested change. This
  reverses `PhaseE1_bugfix_sort_drivetime.md` §5's "still come first" — that
  bullet defended the *order* while §7.2 of the same document offered moving them
  as the alternative. The alternative is what was asked for.
- **`app/page.tsx`'s "unknown drive time is never filtered".** Still right, still
  untouched. `ORS_API_KEY` is still empty; drive-time badges still render nowhere
  and the filter still shows *"routing key not configured"*. Unrelated to all
  three reports, and confirmed still displaying correctly in §6.
- **`selectedLocKey` was not generalised into a "selected map object" union.**
  Tempting, and wrong at this size: the two panels take different props, resolve
  different data, and only one highlights a marker. `rightPanelOpen` gives the two
  consumers that genuinely need the union exactly the union, and nothing else.
- **`MapClickHandler`, `HotspotLayer`, and the hotspot budget.** `MIN_HOTSPOT_ZOOM`
  / `MAX_HOTSPOT_MARKERS` / `HOTSPOT_VIEWPORT_PAD` are a measured rendering budget
  (`PhaseC_fixes.md` §4.1). Untouched.
- **`hotspotDirectionsUrl` vs `observationDirectionsUrl`.** The asymmetry is
  load-bearing (`PhaseC_rationale.md` §7.3): `Hotspot` has no `locationPrivate`
  field, so the fail-closed observation variant would mark every hotspot private.
  Moving the panel changes nothing about which function it may call.
- **`position: relative` on Sidebar's `panelContent` wrapper.** The overlay that
  needed it is gone, but removing it is unrelated churn with a non-zero chance of
  moving something else.
- **The `seen` section still ignores the chase sort** (`alerts-sort.ts:81-83`),
  and `CHASE_SCORE_CAP` / `RARE_SCORE_RESERVE` are untouched.

---

## 6. Verification

`npx tsc --noEmit`, `npm run lint`, `npm run build` all clean; **18 API routes +
`/` + manifest** emitted. `npm test` — **12/12**.

Driven live in Chrome against a cold dev server (process killed, `.next` deleted,
`npm run dev` from scratch), 166 sightings, empty life list, 1920×991.

PhaseE1 §7.1's rule was followed: **every check below is a screenshot or a
measurement of what is on screen**, not a read of card order out of the DOM.

| # | check | result |
|---|---|---|
| 1 | Click hotspot diamond | panel opens **right**, over the map; Alerts list untouched on the left |
| 2 | Panel geometry | `left 1580, right 1920, width 340`, full height, `z-index 1002` |
| 3 | Map controls | `right: 350` = `DETAIL_PANEL_WIDTH + 10`; legend unobscured |
| 4 | Hotspot with data (Meadowbrook Pond) | header + *"Recent Species (14 days) 42"* + species rows with counts, times and `+ Add` |
| 5 | Second hotspot without closing first | McCormick Park (109 spp, 4w) → Snohomish Flats (136 spp, 7w) — full remount |
| 6 | Bird pin while hotspot panel open | exactly **1** `[role=dialog]`: the species panel |
| 7 | Hotspot while species panel open | exactly **1** `[role=dialog]`: the hotspot panel |
| 8 | Esc / ✕ / click empty map | `[role=dialog]` count → **0** in all three cases |
| 9 | Alerts at `scrollTop: 0` | section order `["Lifer Opportunities","Rare — Already Seen","Seen Nearby","Target Species","Arriving Soon"]` |
| 10 | Recent → Closest → Chase | list reorders **in place**; no scroll jump; first card changes each time |
| 11 | Closest ordering | Green-winged Teal 3.7 mi · Virginia Rail 4.2 mi · Evening Grosbeak 4.2 mi |
| 12 | Chase ordering | Great Horned Owl 95% · Black Phoebe 68% — descending |
| 13 | Sort key rendering | distance in Closest only; odds chip in Chase only; caption tracks the mode |
| 14 | Search "gull", Recent | Glaucous-winged 15h · California 16h · Heermann's — **no distance** |
| 15 | Search "gull", Closest | California 5.2 mi · Franklin's 12 mi — ascending, distance shown |
| 16 | Active pill, light | `background:rgba(27,67,50,0.05); border-bottom:2px solid #1B4332; color:#1B4332; font-weight:600`, `aria-pressed="true"` |
| 17 | Inactive pills, light | `background:transparent; border-bottom:2px solid transparent` — no height shift |
| 18 | Active pill, dark | `rgba(116,198,157,0.08)` bg, border-bottom + color `rgb(116,198,157)`, weight 600 |
| 19 | Console | only the Grammarly hydration warning; no new errors |
| 20 | Drive-time filter | still correctly disabled with *"routing key not configured"* |

**Caveats.**

- **The mobile breakpoint was again not driven live.** This was attempted properly
  this time, not skipped: `resize_window` to 390×844 and 420×860 both reported
  success while `window.innerWidth` stayed 1920 and
  `matchMedia('(max-width: 639px)')` stayed false, so the harness cannot cross the
  640 px breakpoint. **`HotspotPanel`'s bottom-sheet branch and the
  `handleHotspotDetail` → `setDrawerOpen(false)` change are verified by inspection
  only.** They are the two highest-risk items in this change; check them on a real
  narrow viewport before trusting them. Same limitation as Phases B, C, D, E1.
- A `computer` `zoom` action left the page viewport overridden at 253×215 mid-session.
  It was detected via `window.innerWidth` and cleared by a reload; nothing was
  measured while it was in effect. Worth knowing: **`zoom` region coordinates are
  in viewport space while `left_click` coordinates are in screenshot space**, and
  the two differ by 1920/1519 in this harness.
- Hotspot markers were located by clicking their DOM elements, using a Mercator
  projection calibrated from two hotspots whose identity was confirmed by an
  earlier successful click. The calibration reproduced a third known hotspot to
  **3 px**, so marker identity in checks 4–5 is established, not assumed.

---

## 7. Invariants for future agents

1. **PhaseE1 invariants #2 and #3 are superseded — do not reinstate the sort
   scroll.** #2 offered two remedies ("below the sorted region, **or** reachable
   another way"); E1 took the second, this phase took the first, and they are
   mutually exclusive. #3 ("the scroll must stay instant") describes code that no
   longer exists. An agent reading `PhaseE1_bugfix_sort_drivetime.md` alone will
   conclude the scroll effect is load-bearing. **It is not; the section order is.**
2. **The sorted sections must stay directly under the sort control.** Anything
   inserted above them re-creates the original 1681 px defect exactly. A new
   section belongs below the sorted three, next to Target Species. This is the
   same invariant E1 wrote, now enforced by layout instead of by a scroll.
3. **`DETAIL_PANEL_WIDTH` is now the offset for two panels and one control
   cluster.** `SpeciesDetailPanel`, `HotspotPanel` and `MapControls`
   (`DETAIL_PANEL_WIDTH + 10`) all read the single export. A third right-hand
   panel with its own width, or a hotspot-specific copy of the constant, puts the
   controls under a panel — and only for that panel, so it will be found late.
4. **`rightPanelOpen` must go to both `MapLegend` and `MapControls`.** They
   consume it differently (hide on mobile vs. shift on desktop), so passing the
   union to one and `!!selectedLocKey` to the other is a bug that is invisible
   until a hotspot is clicked.
5. **The three openers are a set: `openDrawer`, `handleSelectSighting`,
   `handleHotspotDetail`.** Each clears what the others open. Adding a fourth
   surface to that strip means editing all three —
   `phaseB_rationale.md` §3.2's chokepoint rule now covers three states, not two.
6. **`HotspotPanel` is keyed on `locId` and has no internal reset.** The
   adjust-state-on-prop-change block was removed *because* of the key. Remove the
   key and a second hotspot silently shows the first one's species list under a
   new title — check 5 is what catches this.
7. **The pill underline is the active-state signal, not decoration.** `accentBg`
   over white (≈`#F2F4F3`) against a `#F1F3F5` hover is one value step; that
   ambiguity cost PhaseE1 a phase of misdiagnosis. Keeping
   `borderBottom: 2px solid transparent` on the inactive pills is what stops the
   active one changing the row height. Removing either is a regression to §2c.
8. **Assert on `getAttribute('style')`, never `getComputedStyle`** (PhaseE1 §7.4).
   Note SSR emits the compact form (`font-weight:600`) and the client re-render
   emits the spaced form (`font-weight: 600`) — match both. Every measurement in
   §6 obeys this.
9. **`npm test` remains the cheap first answer to "is the ordering wrong?"** Two
   consecutive phases have been reported as sort bugs and neither was in the
   comparator. If it passes, look at what the user can actually see.

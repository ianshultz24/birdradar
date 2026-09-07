# PhaseE1_fixes — the Alerts sort does nothing, and the pins that "render slightly off"

**Follows:** Phase D (`PhaseD_rationale.md`).
**Date:** 2026-08-29
**Two reports, two very different outcomes.** Bug 1 was real and had three
independent causes. Bug 2 was not reproducible and no code was changed — §3 and
§5 are where that work is recorded, and they are the reason this document exists.

---

## 1. Symptom

Verbatim, as reported:

> **ALERTS SORTING BUG:** The Alerts tab sorts identically regardless of the
> selected category. Find the sort handler and fix the comparator so each
> category changes ordering; verify the selected category state is actually wired
> into the sort call.

> **(from the geolocation item)** Also verify marker `iconAnchor` offsets so pins
> point at exact coordinates (some sightings render slightly off).

Asked which of the three plausible readings had actually been observed, the user
selected all three: *Chase Odds ≈ Recent*, *Closest doesn't reorder either*, and
*the sort resets on tab switch*.

---

## 2. Root cause

Reproduced against the live app (dev server, real eBird data, the default search
area, life list seeded to 85 of the 170 nearby species so that all three sections
were populated). The rendered card order was read straight out of the DOM per
section, per sort mode.

**Baseline — "Recent", first 8 of the lifer section:**

```
Surf Scoter, Steller's Jay, Evening Grosbeak, Virginia Rail,
Northern Flicker, Short-billed Gull, Caspian Tern, Purple Martin
```

### 2a. Cause 1 — `chase` was a no-op in two of the three sections

`sortObs(arr, allowChase = false)` (`AlertsPanel.tsx:68`) applied the chase
comparator only when `allowChase` was true, and only the lifer section passed
`true` (`:91`). `rare` and `seen` took the default `false` (`:92-93`).

Measured under "Chase Odds", both of those sections came back **byte-identical**
to the Recent baseline:

```
Rare — Already Seen : Arctic Tern, Wood Duck x Mallard (hybrid), Great Egret,
                      Great Egret, Long-tailed Jaeger          ← identical
Seen Nearby         : Anna's Hummingbird, American Crow, Dark-eyed Junco,
                      Black-capped Chickadee, Canada Goose, …  ← identical
```

Compounding it, inside the lifer section the comparator fell through to
`byRecency` for every *unscored* species (`:80-86`), so before the scores landed —
or at any time `/api/ebird/species` was rate-limited — even that section matched
Recent. **Two thirds of the list could never change, and the last third only
changed once a network round trip had completed.**

### 2b. Cause 2 — the selection did not survive a tab switch

`Sidebar.tsx:92` renders `{activeTab === 'alerts' && <AlertsPanel …/>}`. Visiting
Life List or Settings unmounted the panel, and `useState<SortMode>('recent')`
(`AlertsPanel.tsx:57`) re-initialised on the way back.

Measured: with "Chase Odds" selected, clicking Settings and then Alerts left the
active pill at **Recent** (`fontWeight: 600` on that button) and the list back at
the Recent baseline. `searchQuery` was lost the same way.

### 2c. Cause 3 — a search query silently pinned the list to recency

`searchResults` (`:159-166`) was hardcoded to recency, **and** the sort control
was hidden whenever a search was active (`:206`). Typing in the search box
therefore reverted the ordering with no control left on screen to explain it.

### 2d. What the reproduction did *not* show

**"Closest" was working.** Measured, same session, same data:

```
Closest : Lincoln's Sparrow, Swainson's Thrush, Ruby-crowned Kinglet,
          Green-winged Teal, Least Bittern, Northern Yellow Warbler, Sora, …
```

— a complete reorder against the baseline, in all three sections. The reported
"Closest doesn't reorder" is explained by 2b and 2c rather than by a fourth
defect: a user who had picked Closest, glanced at another tab or typed in the
search box, and come back would see recency ordering with no memory of having
lost the selection.

---

## 3. Ruled out

- **The React Compiler dropping `sortBy` from an inferred dependency set.** This
  was the strongest structural hypothesis — `AGENTS.md` warns that this is not
  stock Next.js, `sortObs` was a hoisted function declaration closing over
  `sortBy`, and auto-memoisation keyed on `observations` alone would reproduce
  the headline symptom exactly. **It is not enabled.** `next.config.ts` has no
  `reactCompiler` key, `babel-plugin-react-compiler` is not in `package.json`,
  and `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/reactCompiler.md`
  documents it as opt-in requiring both. Do not re-derive this.
- **A broken distance calculation.** `haversineKm` (`lib/geo.ts:6`) is correct,
  and the measured Closest ordering above proves it end to end.
- **`sortBy` not reaching the sort call.** It was read directly from the closure.
  The user's instruction to "verify the selected category state is actually wired
  into the sort call" was well-aimed at 2b — the state was wired in, it just kept
  being thrown away.
- **A NaN comparator poisoning the sort.** Plausible (`Array.prototype.sort`
  treats a `NaN` return as `+0`, which silently preserves the input order) and it
  is now structurally impossible — see §4 — but it was not the cause here.
- **Too few items per section to see a change.** The lifer section held 165
  cards.

---

## 4. The change

### 4a. `lib/alerts-sort.ts` (new) — the comparators, extracted and total

`sortObservations(arr, mode, ctx)` plus `sectionSortMode()`. The same move
`locKeyOf` made in Phase D §6, for the same reason: a comparator buried in a
900-line component cannot be reasoned about or driven from a console.

Every comparator is **total**. `byRecency` compares timestamps rather than
subtracting them, because a malformed `obsDt` yields `-Infinity` and
`-Infinity - -Infinity` is `NaN`; `closest` maps a non-finite distance to
`Infinity` (sorts last, tie-broken by recency) and degrades to recency outright
when the centre is not established. A sort that quietly does nothing is the bug
being fixed — it must not be reachable by a second route.

### 4b. Chase applies to every section that displays odds

`ObsCard` already renders a `ChasePanel` for every tier except `seen`
(`showChase = obs.tier !== 'seen'`), so the chase sort now covers `lifer`,
`lifer-rare` and `rare` — the ordering matches the numbers already on screen. The
`seen` section keeps recency **and says so**, via a new `note` line on its section
header: *"by recency — no chase odds for seen birds"*.

### 4c. The scoring budget had to be split, not prioritised

Widening the sort meant widening what needs a score. `CHASE_SCORE_CAP` went 20 →
30, sized against the eBird proxy's per-minute budget rather than the UI.

**A plain "lifers first" priority order did not work, and this was measured.**
Instrumented, the pool for the default area was:

```
{ pool: 86, byTier: { "lifer-rare": 10, "lifer": 72, "rare": 4 }, picked: 30 }
```

72 lifers swallow all 30 slots, the 4 rarities get none, and the Rare section
falls back to recency — the original bug wearing a different hat.
`RARE_SCORE_RESERVE = 8` holds slots back for it, and any unclaimed reserve is
handed back to the lifers.

**Then the reserve had to move to the front of the queue.** With four workers
scoring sequentially and 26 lifers ahead of them, the rarities did not resolve for
~35 seconds, and for that whole window the section sat in recency order —
indistinguishable from the bug. Ordering is now `[rare, lifers]`; the reserve is
small by construction, so this costs the lifer section a handful of requests and
makes the guarantee immediate rather than eventual.

### 4d. `sortBy` and `searchQuery` lifted into `Sidebar`

Sidebar is mounted for the life of the page in **both** layouts — the mobile
branch renders its drawer unconditionally and hides it with
`transform: translateY(100%)`, so closing the drawer does not unmount it. That
was checked rather than assumed: a `{drawerOpen && …}` there instead of the
transform would have fixed desktop and reproduced 2b on mobile only, where the
1920-wide harness cannot see it.

Deliberately not lifted to `app/page.tsx`: no other consumer needs the sort mode.
`chaseScores` stays local — `lib/chase.ts`'s module-level `historyCache` (3 min)
makes a remount cheap.

### 4e. The sort is now legible

Distance used to be rendered *only* in Closest mode, so in the other two modes
nothing on screen indicated a sort had run at all. Each mode now shows its own
key: distance in Closest, `timeAgo` in Recent, and a new odds chip in Chase.

The chip has three states and **only one of them shows a number**: `62% odds`,
`scoring…`, `odds unknown`. An unscored species must never borrow the look of a
scored one — before the scores land a chase-sorted list genuinely *is* in recency
order, and the chip is what makes that a visibly pending state instead of an
indistinguishable one. It also turned §4c from guesswork into a five-second
diagnosis: five `odds unknown` chips in the Rare section named the starvation.

Colours come from `oddsColor()`, never `tierTokens()` — `PhaseC_rationale.md` §11
records that tier red encodes "eBird notable" and is load-bearing.

### 4f. Search obeys the sort

The control stays visible while searching and `searchResults` runs through
`sortObservations`.

---

## 5. Deliberately not changed

- **`iconAnchor`. Nothing about the markers was touched — see §6b for the
  measurement.** The plausible-looking fix here was a two-character CSS change,
  and it would have been a fix for a bug that does not exist.
- **The `seen` section still ignores the chase sort.** This is the one remaining
  case of "a category that does not change ordering", and it is deliberate: there
  is no odds panel on a `seen` card, so ranking it by an invisible number would
  order visible cards by data the user cannot see. It differs from the bug in that
  it is one section, with a stated reason, on screen.
- **`CHASE_SCORE_CAP` was not removed.** Uncapping it would issue one
  `/api/ebird/species` call per nearby species — 86 in the reproduction, sharing
  the eBird proxy's per-minute budget with the three-endpoint search fetch. The
  cap is a budget, not a UI preference.
- **`chaseScores` was not lifted alongside `sortBy`.** It looks like the same
  problem and is not: the scores are re-derived from a module-level cache with a
  3-minute TTL, so a remount costs nothing. Lifting it would add plumbing for no
  gain.
- **`DriveTimeBadge` / the "reachable only" filter were not folded into the sort.**
  Phase D §7 records why the drive-time control is deliberately *not* a fourth
  sort button; that reasoning is untouched.
- **The `ChasePanel` in each card was not replaced by the new chip.** The panel is
  the detail (sparkline, best window, checklist counts); the chip is the sort key.
  They answer different questions and the panel is lazy, which the chip cannot be.

---

## 6. Verification

### 6a. Bug 1 — commands and measurements

`npm run lint`, `npx tsc --noEmit`, `npm run build` all clean. Both structural
greps from Phases C and D still hold (privacy chokepoint returns only
`lib/location-privacy.ts`; the coordinate-order grep returns exactly one swap site
plus one comment).

Driven live in Chrome against the dev server, same seeded life list as §2:

| check | result |
|---|---|
| Lifer section: Recent vs Closest | differs |
| Lifer section: Recent vs Chase | differs |
| Rare section: Recent vs Closest | differs |
| Rare section: Recent vs Chase | **differs** (was identical) |
| Seen section: Recent vs Closest | differs |
| Seen section: Recent vs Chase | identical **by design**, header note present |
| Rare section chips after ~10 s | `26%, 26%, 19%, 18%, 15%` — descending |
| Pick Closest → Settings → Alerts | pill still **Closest**, list byte-identical to before the switch |
| Search "gull", Recent | Short-billed (14 mi, 6h), Glaucous-winged (7.1 mi, 8h), Heermann's (14 mi, 9h) |
| Search "gull", Closest | Glaucous-winged (7.1 mi), Ring-billed (10.0 mi), Franklin's (12 mi) |
| Sort control while searching | visible |

### 6b. Bug 2 — the marker anchors are already exact

**Inspection first.** `divIconFromGlyph` (`Map.tsx:117`) sets
`iconAnchor: [box/2, box/2]`, every glyph in `lib/marker-style.ts` draws at
`cx = cy = box/2`, and `sightingBox()` is `2 * Math.ceil(extent + 1)` — always
even, so `box/2` is an integer. There is no half-pixel anchor to fix.

**One hypothesis survived inspection and was wrong.** The pulse wrapper is
`display: inline-block` (`Map.tsx:123`) and inherits
`.leaflet-container { font-size: 12px; line-height: 1.5 }`
(`node_modules/leaflet/dist/leaflet.css:274-278`). If the `<svg>` inside were an
inline replaced element, the wrapper's line box would gain the font strut's
descent, making the box ~5 px taller than the glyph and putting
`transform-origin: 50% 50%` ~2.5 px below centre — so `@keyframes pinRingPulse`'s
`scale(1.14)` would walk the marker off its coordinate. It would have affected
**only** sightings, because only they get the wrapper, which matched "*some*
sightings render slightly off" exactly.

**Measured, and the hypothesis is dead.** Tailwind v4's preflight
(`node_modules/tailwindcss/preflight.css:214-219`) sets `svg { display: block }`,
which removes the baseline the argument depended on. With Low Battery Mode **off**
and `liferPulse` **on** — mandatory, since the stock settings ship
`lowBatteryMode: true`, which sets `animation: none` on `.bird-pin-pulse` and
would have produced a clean reading on a marker that was still wrong:

```
markers: 66      pulsing: 46      animation: pinRingPulse
iconBox == svgBox for every marker (20×20, 28×28)
computed margin == -box/2 exactly ("-14px", "-14px")
anchor point − painted glyph centre = (0, 0) for every marker sampled
glyph-centre drift over 12 samples across a full 2.4 s pulse cycle: spread 0 px
```

**No code was changed.** If sightings still look misplaced, the next agent should
look at the *data* — `buildMarkerGroups` plots `group[0]`'s coordinates, and eBird
returns a hotspot's centroid rather than the observer's position — not at
`iconAnchor`, and not at the wrapper CSS.

### 6c. Harness caveats

- The mobile breakpoint was again not driven live (1920-wide window) — same
  limitation as `phaseB_rationale.md` §7, `PhaseC_rationale.md` §10 and
  `PhaseD_rationale.md` §10. §4d's claim about the mobile drawer is from the
  render path, not from a device.
- The only console error during all of the above is the pre-existing Grammarly
  hydration warning (`data-gr-ext-installed`), exactly as `PhaseC_rationale.md` §9
  records.

---

## 7. Invariants for future agents

- **Every comparator in `lib/alerts-sort.ts` must stay total.** A `NaN` return is
  spec'd to be treated as `+0`, so a single unguarded subtraction turns the sort
  into a silent no-op that looks exactly like the bug this document is about.
  Never subtract two values that can be `-Infinity`; never feed an unvalidated
  centre to `haversineKm` inside a comparator.
- **Whatever the chase sort orders, the scoring effect must score.** They are two
  halves of one contract (`tierHasChaseOdds` is the shared predicate). Widening
  one without the other is precisely how §2a happened.
- **`RARE_SCORE_RESERVE` is not defensive padding, and its position in the queue
  is not cosmetic.** Removing it starves the Rare section (measured: 72 lifers vs
  4 rarities for 30 slots). Moving it back behind the lifers delays that section
  by ~35 s, during which it is indistinguishable from unsorted.
- **The odds chip must keep three distinct states.** Rendering `0%` or a blank
  where a score is missing re-creates the exact ambiguity that hid this bug for
  four phases.
- **`sortBy` and `searchQuery` must stay above `AlertsPanel`.** It is unmounted on
  every tab change. If `Sidebar` ever becomes conditionally rendered on mobile,
  they move to `app/page.tsx` — they cannot move back down.
- **Do not re-open the `iconAnchor` question without re-running §6b's probe.** The
  anchors measure exact. But the measurement depends on Tailwind's preflight
  giving `svg` `display: block`: if the preflight is ever dropped, scoped, or
  replaced, the inline-block wrapper regains a baseline gap and
  `transform-origin: 50% 50%` stops being the glyph centre. That is the condition
  to check, not the anchor arithmetic.
- **A probe of marker geometry is meaningless with Low Battery Mode on.** It ships
  on by default and disables the animation the probe is looking for.

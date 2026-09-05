# PhaseE2_bugfix — "the sorting is still messed up" and the drive-time filter that never filtered

**Date:** 2026-08-30
**Follows:** `PhaseE1_fixes.md`, `PhaseE1_bugfix_ebird404.md`

**Two reports. Neither cause was in the code Phase E1 changed.**

- **Bug 1 — the sort.** `lib/alerts-sort.ts` was correct, is still correct, and was
  not modified. The ordering it produces starts **1681 px — 2.13 viewport
  heights — below the fold**, behind two sections the control does not govern.
  Clicking a sort button from the top of the panel changed nothing a human could
  see. §2a.
- **Bug 2 — drive time.** `ORS_API_KEY` is empty in `.env.local`. Every duration is
  `null`, unknown durations are deliberately never filtered, so "Reachable only —
  within N min" passed 100% of sightings while rendering as a live control. §2b.

§3 and §5 are the payload. Phase E1 wrote 400 lines against Bug 1's symptom and
verified them by reading card order **straight out of the DOM**, which is exactly
the measurement that cannot see this defect.

---

## 1. Symptom

Verbatim, as reported:

> I just implemented Phase E1 with Claude Code and it really didn't fix anything.
> The sorting is still messed up, changing between categories doesn't actually do
> anything and sorting by drive distances doesn't do anything either.

Clarified before any code was read: "categories" means the **Recent / Closest /
Chase Odds** buttons; "drive distances" means the **"Reachable only" toggle**.
Asked what the panel showed, the user confirmed a long list of cards, that the
clicked pill *did* appear to highlight, and that the Phase E1 UI ("Pick a Spot",
the `?` button) was present — so this was not a stale bundle.

That combination is **not reachable in the source**: `sortBy` drives the pill
styling and the per-card distance in the same render pass, from the same
variable. One of the premises had to be false. Both were, in different ways.

---

## 2. Root cause

### 2a. Bug 1 — the sort works; its effect is two screens below the fold

Measured in Chrome against the dev server, 166 sightings, empty life list:

```
panel clientHeight                                    789 px
distance from panel top to "Lifer Opportunities"     1681 px
                                             = 2.13 viewport heights
sections above it:  Target Species (10 cards) + Arriving Soon (12 cards)
```

`AlertsPanel` renders **Target Species** and **Arriving Soon** before the three
sections the sort governs. Neither can be sorted by this control and neither
should be: a `TargetSpecies` has a `nearbyCount` and an `ArrivingSpecies` has an
arrival date — there is no recency, distance or chase score on either
(`lib/ebird.ts:47-52`, `lib/forecast.ts`). They are correctly excluded.

The consequence is that **the entire visible viewport is sort-invariant.** A user
at `scrollTop: 0` clicks Closest, 22 cards of Target/Arriving do not move, no
distance appears on them because they never carry one — and the reasonable
conclusion is that the button is broken.

The comparators were verified independently, in Node, with no browser:

```
input   : Surf Scoter | Stellers Jay | Evening Grosbeak | Virginia Rail | Northern Flicker | Caspian Tern
recent  : Surf Scoter | Stellers Jay | Evening Grosbeak | Virginia Rail | Northern Flicker | Caspian Tern
closest : Stellers Jay | Northern Flicker | Virginia Rail | Caspian Tern | Surf Scoter | Evening Grosbeak
chase   : Stellers Jay | Evening Grosbeak | Surf Scoter | …          (scores 90/55/20)
```

and in the browser, in the lifer section, they were always right:

```
Recent  : Bufflehead 1h · Elegant Tern 5h · Anna's Hummingbird 5h · Osprey 5h …
Closest : Hooded Merganser 5.2 mi · Fox Sparrow 5.2 mi · Canada Goose 5.2 mi …
Chase   : Purple Finch 97% · Mallard 96% · Black Phoebe 74% · Bushtit 71% …
```

**Nothing was wrong with the ordering. It was unreachable.**

A second, compounding factor: the active pill was `accentBg` —
`rgba(27,67,50,0.05)` in light mode, a 5% wash — sitting next to a hover state of
`bg2` (`#F1F3F5`). Under the cursor that just clicked it, "active" and "hovered"
were near-indistinguishable, so the one piece of feedback that *did* work could
not be trusted either.

### 2b. Bug 2 — `ORS_API_KEY` is empty, and nothing says so

`.env.local` has every key populated except this one:

```
EBIRD_API_KEY               SET(len 12)
NEXT_PUBLIC_STADIA_API_KEY  SET(len 36)
UPSTASH_REDIS_REST_TOKEN    SET(len 62)
…
ORS_API_KEY                 EMPTY          ← here
```

The chain, every link deliberate and individually reasonable:

1. `app/api/drive-time/route.ts:498-506` — no key → `{ durations: [null, …],
   configured: false }`. Not a 500, because the specified failure mode for one
   unknown drive time is an absent badge.
2. `components/DriveTimeBadge.tsx:84-89` — `seconds === null` renders `null`.
   **No drive-time badge can appear anywhere in the app.**
3. `app/page.tsx:729` — an unknown duration is never filtered out: *"An ORS outage
   or a spent quota must not silently delete a lifer from the map."*

Individually right; composed, the filter has nothing to filter on and passes
everything. Measured live, with the toggle on at a 15-minute tolerance:

```
POST /api/drive-time  →  {"durations":[null],"configured":false}
Lifer Opportunities   →  166 before, 166 after
```

The route emits `configured: false` **specifically so this is diagnosable** — and
`configured` appeared nowhere in `components/` or `lib/` except `lib/push*.ts` and
`lib/db.ts`, which are unrelated. The signal was being sent and nobody was
listening.

---

## 3. Ruled out

Evidence, not inspection. Do not re-derive these.

- **The comparators in `lib/alerts-sort.ts`.** Executed directly under Node 24
  against a fixture where recency and distance disagree on every pair: all three
  modes produce distinct, correct orders; the `NaN`→`+0` traps hold. This is now
  permanent — `lib/alerts-sort.test.ts`, 12 assertions, `npm test`.
- **A stale bundle or a bad dev-server process.** The prime suspect, given
  `PhaseE1_bugfix_ebird404.md` §7.6 (OneDrive syncing underneath `.next`) and
  §7.1's "restart before reading route code". Eliminated properly: full process
  kill, `rm -rf .next`, cold `npm run dev`, reload with cache disabled. Symptom
  unchanged, and `grep "no chase odds for seen birds" .next` confirmed the E1 code
  compiled. **This one really was the code.**
- **`sortBy` failing to reach the render.** The raw `style` attribute on the
  pills tracks `sortBy` exactly, as does `aria-pressed`.
- **`locKeyOf` disagreeing between the list and the map.** Identical expression,
  single export (`lib/markers.ts:43-45`).
- **A React key collision reordering cards.** `mergeObservations` dedupes on
  `speciesCode|locId`, which is the card key — collisions are structurally
  impossible.
- **`getComputedStyle` as a measurement tool — it lied repeatedly in this
  session.** It reported `font-weight: 600` on *Recent* while `aria-pressed="true"`
  and the raw `style` attribute were both on *Closest*, and it reported an active
  pill that disagreed with a visibly chase-sorted list. **Read
  `getAttribute('style')`, not the computed value, when checking React output from
  an extension context.** Two false "the state isn't updating" conclusions came
  from this before it was caught.

---

## 4. The change

### 4a. The sorted region is brought into view when the mode changes

`components/AlertsPanel.tsx`. The three sorted sections are wrapped in one
`<div ref={sortedRegionRef}>`, and a `useEffect` on `sortBy` scrolls it under the
sticky header. Guarded three ways, each because the unguarded version is worse:

- **only on a change**, never on mount — opening Alerts must not yank the user
  past Target Species they came to read;
- **only when the region is below the fold** (`top < clientHeight * 0.5` returns
  early) — a user already reading the list is not jerked around;
- **offset by the sticky block's measured height**, because the search + sort
  header is `position: sticky; top: 0` and ~189 px tall. Without the offset the
  section header and its first card land underneath it and the user arrives
  mid-card, which reads as a mis-scroll. Verified: header lands at y = 189, exactly
  the sticky height.

**It is an instant scroll, and `behavior: 'smooth'` is not a stylistic option
here — it is measured to do nothing.** In this container:

```
scrollTo({top: 1479, behavior: 'smooth'})  → scrollTop 0 at 150 ms, 0 at 1.35 s
scrollTo({top: 1479, behavior: 'auto'})    → scrollTop 1479, lands and sticks
scrollTop = 1479                           → 1479, lands and sticks
```

The panel holds ~170 cards each with a lazy `IntersectionObserver` that mounts a
`ChasePanel` on entry; the resulting layout work appears to abort the animation
before it starts. A prettier scroll that silently does nothing is the exact class
of failure this whole document is about.

### 4b. The sort control says what it governs

A line under the buttons: *"Orders the sightings below, not Target or Arriving"*
(and the existing chase-odds copy when that mode is active). Without it, "I
clicked Closest and the top of the list didn't move" has no honest reading other
than "broken".

### 4c. The active pill is a solid fill, not a 5% tint

`accentSoft` background with `accentFg` text at weight 700, plus `aria-pressed`.
Unambiguous against the hover wash in both themes, and now exposed to assistive
tech and to any future automated check.

### 4d. The drive-time misconfiguration is surfaced

`lib/drive-time.ts` — the module that already owns the cache now also owns the
answer to "is routing configured at all": it reads `configured` off the response
and publishes it through `getDriveTimeConfigured()` /
`subscribeDriveTimeConfigured()`, consumed by `useSyncExternalStore`. `null` means
"not asked yet" and is treated as usable, so a working control is never disabled
on a cold load.

`DriveTimeFilter` distinguishes **two** reasons it cannot work, because they have
different owners: *"Drive times need your location"* (the user's to fix, in the
browser) and *"Drive times unavailable — routing key not configured"* (the
operator's to fix, in the environment). Collapsing them sends the user hunting
for a permission prompt that will never help.

### 4e. The filter is measured over every location, not just the plotted ones

`app/page.tsx`. Drive-time targets were built from `markerGroups`, and
`buildMarkerGroups` drops `seen` and `rare` observations when `dimSeenSpecies` is
off (`lib/markers.ts:23-30`). Those cards had no known duration and so
permanently bypassed a filter that claims to govern the list. Targets are now the
deduped `locKeyOf` set over all `observations`.

### 4f. The dead `distKm` override in search results

An explicit `distKm={haversineKm(…)}` sat **after** the `sortMetricProps` spread
and won, so search results showed a distance in all three modes — contradicting
E1 §4e's own rule that each mode renders its own sort key. Removed.

### 4g. `lib/alerts-sort.ts` finally has the assertions it was extracted for

The module's own header justifies its existence on the grounds that a buried
comparator "cannot be reasoned about, asserted on, or driven from a console" —
and then nothing asserted on it, which is why "are the comparators correct?" cost
a browser and a live eBird key to answer twice. `lib/alerts-sort.test.ts` + `npm
test`, **zero new dependencies**: Node 24 strips TypeScript natively, and
`test/ts-resolve.mjs` supplies the extensionless module resolution ESM does not do.

---

## 5. Deliberately not changed

- **`lib/alerts-sort.ts`.** Not one line. It was correct before this document and
  is correct after it; §2a proves it twice over. Editing it would have written a
  false cause into the history — the same mistake Phase E1 made at scale.
- **Target Species and Arriving Soon are still not sorted, and still come first.**
  They genuinely have no orderable field, and they are the answer to "what should
  I go looking for", which is a reasonable thing to lead with. The fix is to make
  the sort's effect *reachable*, not to demote content because a control below it
  was hard to see.
- **`app/page.tsx:729` still lets unknown drive times through.** It is right —
  failing closed on a convenience filter would delete lifers from the map during
  an ORS outage. The bug was never this line; it was that nothing said *every*
  duration was unknown.
- **`ORS_API_KEY` was not invented or worked around.** Set it in `.env.local`
  (free key at <https://openrouteservice.org/dev/#/signup>), with **no `Bearer `
  prefix** — `.env.example:28-30` records that a prefixed key reads as no key at
  all. It is read at request time, so a dev-server restart suffices; no rebuild.
- **No fourth "Drive Time" sort mode.** The user identified the *toggle* as what
  should have worked, so Phase D §7's refusal to make drive time a sort stands.
- **The `seen` section still ignores the chase sort** (`alerts-sort.ts:81-83`) and
  **`CHASE_SCORE_CAP` / `RARE_SCORE_RESERVE` are untouched.** Documented,
  deliberate, and measured against the eBird proxy's budget.
- **`iconAnchor`.** `PhaseE1_fixes.md` §6b measured 0 px deviation. Not re-opened.
- **The Grammarly hydration warning.** Still the only console error; still not ours.

---

## 6. Verification

`npx tsc --noEmit`, `npm run lint`, `npm run build` all clean; 18 routes emitted.
`npm test` — 12/12.

Both structural greps from Phases C and D still hold:

```
privacy chokepoint   → lib/location-privacy.ts:62 only
coordinate order     → app/api/drive-time/route.ts:352 (the one ORS swap) + its comment
```

Driven live in Chrome against a cold dev server (`.next` deleted, process tree
restarted), 166 sightings, empty life list:

| # | check | result |
|---|---|---|
| 1 | Click Closest at `scrollTop: 0` | scrolls to 1479; "Lifer Opportunities" lands at y=189 = sticky height |
| 2 | Click Chase, then Recent, while already there | stays at 1479 — the below-the-fold guard holds |
| 3 | Lifer order, Recent | Bufflehead 1h · Elegant Tern 5h · Anna's Hummingbird 5h |
| 4 | Lifer order, Closest | Hooded Merganser · Fox Sparrow · Canada Goose — all 5.2 mi, ascending |
| 5 | Lifer order, Chase | 97% · 96% · 74% · 74% · 74% · 71% · 64% — descending |
| 6 | Distance renders | Closest only. Recent and Chase show `timeAgo` / odds chip |
| 7 | Search "gull", Recent | Glaucous-winged 7h, California 9h, Heermann's 10h — **no distance** |
| 8 | Search "gull", Closest | Franklin's 12 mi, California 12 mi, Bonaparte's 12 mi |
| 9 | Active pill | solid `accentSoft` + white text + `aria-pressed="true"`, tracks `sortBy` |
| 10 | Drive-time filter, key absent | toggle disabled, *"routing key not configured"* shown |
| 11 | `POST /api/drive-time` | `{"durations":[null],"configured":false}` |

**Caveats.**

- **The configured=true path is unproven.** There is no ORS key in this
  environment, so badges appearing, the filter actually shrinking the list, and
  §4e's widened target set were **verified by inspection only**. First thing to do
  once the key is set: turn "Reachable only" on at 15 min and confirm the section
  count drops and the map loses the same pins.
- **The mobile breakpoint was again not driven live** — 1920-wide window, same
  limitation as Phases B, C, D and E1.
- The 1681 px / 2.13-screen figure is for this window height and this result set.
  The defect scales with the size of Target Species + Arriving Soon; it does not
  disappear on a taller screen, it just needs more sightings.

---

## 7. Invariants for future agents

1. **A sort that is correct is not a sort that works.** The comparators passed
   every DOM-order check Phase E1 ran, and the feature was still broken, because
   every one of those checks read the list programmatically. **Reading card order
   out of the DOM cannot see an ordering that is below the fold.** When verifying
   a control, verify what is *on screen* after clicking it — screenshot, or at
   minimum measure the distance from the control to the first element it changes.
2. **Anything rendered above `sortedRegionRef` is sort-invariant and pushes the
   sorted content down.** Adding a third lead-in section re-creates this bug. If
   one is added, it belongs below the sorted region, or the region needs to be
   reachable another way.
3. **The scroll must stay instant.** `behavior: 'smooth'` is measured to be a
   complete no-op in this container (§4a) — not slow, not janky, *nothing*.
   "Improving" it to smooth silently removes the feedback this fix exists to
   provide.
4. **`getComputedStyle` is not a reliable readback for React-rendered inline
   styles from an extension context.** It disagreed with `aria-pressed` and with
   the visible DOM twice in this session. Assert on `getAttribute('style')`.
   Note SSR emits the compact form (`font-weight:400`) and the client re-render
   emits the spaced form (`font-weight: 400`) — match both.
5. **`configured: false` from `/api/drive-time` must stay wired to the UI.** The
   route has always sent it; for four phases nothing read it, and the cost was a
   filter that silently declined to filter. An absent badge is an acceptable
   failure mode for one unknown duration. A control that looks live and does
   nothing is not.
6. **An empty `ORS_API_KEY` is invisible except through that flag.** Every layer
   fails soft by design, correctly and independently, and the composition is a
   no-op. If you are ever asked why drive times "don't work", check the key
   before reading any code — the same reflex `PhaseE1_bugfix_ebird404.md` §7.1
   established for `/api/*` 404s.
7. **`npm test` is now the cheap answer to "are the comparators correct?"** It
   needs no server, no key and no browser. Run it before forming any hypothesis
   about the Alerts ordering. If it passes, the ordering logic is not your bug —
   look at what the user can actually see.

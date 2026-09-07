# Phase D — drive time to sighting (OpenRouteService Matrix)

**Follows:** Phase C (`PhaseC_rationale.md`) and the map-bounds fix (`6ab550b`).
**Date:** 2026-08-17
**Scope:** 3 new modules, 9 files touched

```
app/api/drive-time/route.ts       | new   — the ORS proxy, cache, and quota breaker
lib/drive-time.ts                 | new   — banding, formatting, client batcher
components/DriveTimeBadge.tsx     | new   — the lazy badge
components/AlertsPanel.tsx        |  ++   — badge in the meta row, filter in the header
app/page.tsx                      |  ++   — driveTimes state, one filter predicate
components/SpeciesDetailPanel.tsx |   +   — badge in the slot Phase B reserved
components/Sidebar.tsx            |   +   — prop plumbing
components/SettingsPanel.tsx      |   +   — routing attribution (licensing)
lib/theme.ts                      |   +   — driveTimeTokens()
lib/markers.ts                    |   +   — locKeyOf() extracted and exported
lib/ebird.ts                      |   +   — two settings
lib/tiles.ts                      |   +   — ROUTING_CREDITS
components/Icons.tsx              |   +   — CarIcon
.env.example / .env.local         |   +   — ORS_API_KEY, ORS_DAILY_BUDGET
```

---

## 1. What was missing

BirdRadar could say whether the bird was still there (`lib/chase.ts`) and how far away it
was in a straight line (`haversineKm`). It could not say the thing a birder actually decides
on: **how long is the drive?** 12 km across a lake is an hour; 30 km down a freeway is
twenty minutes. Straight-line distance is not merely imprecise here, it is *anti-correlated*
with effort often enough to mislead.

Both prior phases reserved the landing site. `SpeciesDetailPanel.tsx:280` carried the
comment *"The drive-time badge is the remaining tenant."* `phaseB_rationale.md` §8 named
"Drive-time badge + Chase Mode affordance" as a follow-up and recorded that `LocationRow`
was deliberately structured to receive it without a layout rework. It did: the badge went
into the existing meta row and nothing was restructured.

---

## 2. Decisions taken with the user before implementing

| Question | Answer | Consequence |
|---|---|---|
| The brief asserted private locations were "excluded in the recent privacy work — verify". | **Verified false — they were deliberately *not* excluded.** Keep Phase C's rule. | Private locations stay **in** the drive-time batch. `lib/location-privacy.ts` is untouched by this phase. |
| "Chase Mode" collides with `lib/chase.ts`, `ChasePanel` and the "Chase Odds" sort. | **"Drive Time" naming, plus a "Reachable" toggle** driven by a selected tolerance. | Two controls in one row; nothing named `chase*` was touched. |
| What does the filter hide, and what about unknown drive times? | **List and map together; unknowns stay visible.** | One predicate, two consumers (§6). |
| What is "currently in view"? | **The sidebar list viewport**, batched. | Reuses `ChasePanel`'s `lazy` pattern; the map's viewport state stays local to `HotspotLayer`. |

The user then amended the plan with six corrections that materially improved it, all
implemented here: the daily budget default and its bucket semantics (§4); a whole-handler
deadline, not just a per-chunk one (§4); the `Authorization` header format (§3); an explicit
`destinations` array (§3 — the single most dangerous detail in the phase); a retry for
unroutable points instead of writing off fifty badges (§3); clearing `driveTimes` when the
*origin* moves rather than only when the search does (§6); resolving the open detail panel
from the unfiltered groups (§7); and the ORS/OSM attribution requirement (§8).

---

## 3. The ORS request — three ways to get plausible wrong answers

This is where the phase's risk is concentrated, because **every failure mode here produces
numbers that look reasonable.** A crash would be safer.

### 3.1 `[lng, lat]`, exactly once

ORS takes longitude first. eBird, Leaflet, every prop, every cache key and every function
in this repo take latitude first. The swap exists at exactly one line
(`app/api/drive-time/route.ts:341`) and the invariant is greppable:

```bash
grep -rn "lng, lat\]\|lng,lat\]" app components lib
```

must return that line and one comment in `lib/drive-time.ts`. A second swap site, or a
swap moved into a caller, silently transposes the map.

### 3.2 `destinations` must be explicit — the origin is otherwise a destination

`sources` and `destinations` are index arrays into `locations`, and **both default to
`all`**. With `locations: [origin, ...chunk]` and only `sources: [0]` given, `destinations`
silently becomes every index *including index 0*. The returned row then has length N+**1**,
with `durations[0][0]` = origin→origin = `0`, and `chunk[i]` living at `durations[0][i+1]`.

Reading it as `durations[0][i]` shifts every badge onto the previous location. Nothing
about the result looks wrong — the durations are all real durations, just attached to the
wrong birds. This is the defect most likely to ship undetected, so it is guarded twice:

```ts
destinations: chunk.map((_, i) => i + 1),   // explicit; excludes the origin
```

and a length assertion on the way back — a row whose length is not exactly `chunk.length`
is discarded rather than indexed around. **Refusing to guess at the alignment is the point:
an absent badge is recoverable, a shifted one is not.**

### 3.3 The `Authorization` header, measured rather than assumed

The brief specified `Authorization: Bearer ${ORS_API_KEY}`. ORS does not document it that
way — its own examples, forum answers and Python client all pass the key **bare**. The code
sends it bare.

**What was actually measured against the live API** (rather than repeated from the brief):

| request | status | body |
|---|---|---|
| no `Authorization` header | **401** | `{"error":"Authorization field missing"}` |
| invalid key, bare | **403** | `{"error":"Access to this API has been disallowed"}` |
| invalid key, `Bearer ` prefixed | **403** | same |

Two things follow, and the second corrects an earlier draft of this very document:

- **401 and 403 mean different things and both had to be handled** (§4.2).
- **A probe with an invalid key cannot establish whether the prefix matters** — both forms
  return the same 403. An earlier comment in this file asserted that a prefixed key fails
  with "api_key missing"; that was not reproducible and has been removed. Bare is used
  because it is the documented form, not because the alternative was proven to fail.
  Anyone with a valid key can settle it in one curl; until then, do not restate it as fact.

---

## 4. Protecting a quota nobody can pin down

### 4.1 The published numbers disagree with each other

ORS publishes matrix quotas inconsistently — 500, 2,000 and 2,500 requests/day all appear
across its own pages, and the widely quoted **2,000/day figure in the brief is the
*directions* endpoint**, not matrix. Its restrictions page documents only the request
*size* limit (3,500 origin×destination pairs), not a rate.

The design therefore cannot depend on knowing the ceiling:

- `ORS_DAILY_BUDGET` defaults to **450** — under the *lowest* published figure. A breaker
  set at 1,500 would be inert if the real ceiling is 500: it would never fire, and ORS
  would simply start returning 403. **A breaker above the real limit is worth nothing.**
- Chunks are **50 destinations**, sequential. 50 is conservative by choice, not forced —
  3,500 pairs is the documented hard limit — but ORS's per-minute limiter is the real
  constraint and parallel chunks would trip it.
- Every layer caches. Per-destination server cache (§5), per-destination client cache, and
  in-flight deduplication.

### 4.2 The bucket is a rolling 24 h, and 403 is overloaded

ORS's daily limit resets 24 h after the key's **first** request, so the window slides. A
UTC-date bucket drifts out of phase with it, and the two errors are not symmetric: counting
ahead of ORS wastes quota you have, counting behind it means hammering a key ORS has
already cut off. `INCR` + `EXPIRE 86400` on the first write reproduces ORS's own semantics.

**ORS returns 403 for both a spent quota and a rejected key.** The status alone cannot be
trusted to mean "quota". That matters because the naive handling — trip the breaker for an
hour — punishes the far more common case: an operator with a typo in `ORS_API_KEY` fixes it
and *still* sees no badges, with nothing on screen to say why, until a module-level timer
they cannot see expires. So the body is inspected:

```ts
const looksLikeAuth = /disallowed|authorization|api.?key/i.test(body);
await tripBreaker(looksLikeAuth ? AUTH_LOCKOUT_S : retryAfterSeconds(res));
```

Auth-shaped rejections lock out for **60 s** — long enough to stop a request storm, short
enough that a corrected key recovers on its own. Quota-shaped ones use `Retry-After`, or
one hour.

`429` (per-minute limit) is fatal for the current request but **leaves its destinations
uncached**, so the next batch retries them cleanly rather than finding them poisoned.

### 4.3 Negative caching is load-bearing

A destination that cannot be routed to, or a chunk that failed, is cached as `null` for
**2 minutes** — not the 15-minute fresh TTL. Both halves matter. Without negative caching,
a permanently unroutable point is re-billed on every scroll burst. With a 15-minute
negative TTL, a transient ORS blip hides a badge for a quarter of an hour.

### 4.4 The handler has a deadline, not just the requests

Each ORS call has an 8 s timeout; sequential chunks had no collective ceiling. The eager
path (§6) fetches every location group in the result set, which on a busy migration day is
several hundred groups — 6+ chunks, ~48 s, past any serverless limit. That would surface as
a **platform-level 500**, breaking the one contract this route otherwise keeps.

`HANDLER_DEADLINE_MS` (9 s) is checked *before* each chunk, and `export const maxDuration =
15` sits in the same file so the two cannot drift. Past the deadline the remaining
destinations stay `null`; the client's next scroll re-requests only what is still missing,
so the work resumes rather than being lost.

---

## 5. The cache key is per destination, not per destination set

The brief specified "origin rounded to 3 decimals + the sorted destination set". This ships
**one entry per destination** instead, under the same origin rounding and TTL.

Per-destination keying strictly dominates. As the user scrolls the sidebar, batch #2
overlaps batch #1 by ~90%; a set-level key treats that as a total miss and re-bills every
point in it. Per-destination keying bills only the genuinely new ones — on a quota this
tight, that is the difference between the feature working all day and working for an hour.
Set-level keying is trivially recoverable on top of this if it is ever wanted.

Origin rounds to 3 dp (~110 m), destinations to 4 dp (~11 m). **The rounded values are used
for the outgoing request as well as the key**, so a cache entry can never describe a request
that was not made.

Redis stores `{ v: <duration|null> }`, never a bare value: `redis.get` returns `null` for a
miss, so a bare cached `null` would be indistinguishable from one, and every cached failure
would become a re-billed lookup. Every Redis call is wrapped — an Upstash outage degrades to
per-instance memory, exactly as `lib/ebird-proxy.ts` does.

---

## 6. State: one predicate, two consumers

`driveTimes: Map<locKey, number | null>` lives in `app/page.tsx`, for the same reason
`markerGroups` does (`phaseB_rationale.md` §3.1) — the list, the map and the panel must
resolve one `locKey` to one number.

**`locKeyOf()` was extracted from `buildMarkerGroups` and exported** (`lib/markers.ts`).
The map filters *groups* and the list filters *observations*, so both need the location
identity; two hand-rolled copies of `obs.locId || \`${obs.lat},${obs.lng}\`` is exactly how
the two would come to disagree about what they are showing.

The filter is one memoized predicate consumed by both derivations, and it is `null` when
inactive — which is what lets both pass their input through **by identity**. That matters:
a new array re-renders every marker (`phaseB_rationale.md` §3.9), and the default
configuration must cost the map nothing.

Unknown drive times **stay visible**. Failing closed is right for privacy and wrong for a
convenience filter — an ORS outage or a spent quota must not silently delete a lifer from
the map.

### 6.1 Origin is the GPS fix, not `searchCenter`

A dropped pin moves *where you search*; it does not move *where you are driving from*. With
geolocation denied there is no origin, so no badges render anywhere and the filter is
disabled with an explanatory line — correct behaviour, not a bug, and it satisfies the
brief's "only once the user's origin is known".

`driveTimes` is keyed on `locKey` alone, so unlike the client cache it carries no origin.
Drive a few miles without touching the search area and every entry would silently be
measured from where you *were*. It is therefore cleared on **two** triggers: `searchKey`
(alongside `observations`/`hotspots`) and the origin rounded to 3 dp — the same rounding the
caches use, so sub-110 m GPS jitter cannot thrash it.

### 6.2 The filter cannot be lazy, and the two paths do not need wiring together

A "hide anything over 30 minutes" that only knew about cards you happened to scroll past
would hide an arbitrary subset. So turning the filter **on** fetches the whole result set
eagerly; with the filter **off**, fetching stays lazy and viewport-driven.

`DriveTimeBadge` fetches for itself rather than being handed a value, and that is not a
second source of truth: both paths go through the module-level cache in `lib/drive-time.ts`.
With the filter on, the page's eager batch lands first and every badge below it resolves
from that same cache with **no second request**. Adding a callback to lift badge results
into page state would create the divergence it appeared to prevent.

**The eager effect keys on a signature of the *unfiltered* groups.** Building the groups
from an already-filtered set would make that signature depend on `driveTimes`, and the
effect would oscillate: refetch a shrinking set → locations go unknown → become visible
again → refetch. `visibleMarkerGroups` is filtered *from* `markerGroups` and never fed back
into it.

---

## 7. UI

**List badge** sits in `ObsCard`'s meta row beside distance and `timeAgo`. It owns its own
ref, `IntersectionObserver` (`rootMargin: '150px'`) and fetch — the same shape as
`ChasePanel`'s `lazy` mode, so the card's layout needed no observer plumbing. Batching one
level down means a fifty-card scroll burst is one POST.

**Filter** is one row in the sticky header: a switch labelled with the tolerance it will
apply ("Reachable only — within 30 min"), and a 15/30/45/60/90 chip group that appears when
it is on. Deliberately *not* a fourth sort button — the "Chase Odds" sort sits inches above
it and means something entirely different (`lib/chase.ts`: will the bird still be there).

**Detail panel** gets the badge in `LocationRow`'s meta row — the slot the Phase C comment
reserved. It resolves the open panel from the **unfiltered** `markerGroups`: Phase B closes
the panel when its `locKey` leaves the array, so reading the filtered array would slam shut
the panel the user is reading the moment they enable the filter. That reads as a crash, not
a filter. **Filtering governs what is listed and plotted, not what stays open.**

A private location shows a drive-time badge **and** no Directions button. That pairing is
the whole point of Phase C §7.4, not an oversight.

---

## 8. Attribution is a licensing constraint

ORS is OpenStreetMap-derived; its terms and ODbL both require credit, and every matrix
response carries `metadata.attribution` as a standing reminder. `ROUTING_CREDITS` lives in
`lib/tiles.ts` beside `TILE_CREDITS` — same file, so the two licensing obligations sit
together and neither can be dropped without noticing the other — and renders in
Settings → Credits under "Drive times". Phase C put attribution legibility on a licensing
footing (§6); this is the same rule. **Do not trim it.**

---

## 9. Verification — what was actually proven

`npm run lint`, `npx tsc --noEmit`, `npm run build` all clean. `/api/drive-time` builds as a
dynamic route.

**Both structural greps hold:**

- Privacy chokepoint returns `lib/location-privacy.ts` and nothing else. Phase D adds no
  navigation URL, so §7.7 is intact.
- Coordinate-order grep returns exactly one swap site plus one comment.

**Route driven directly** (dev server, `curl`):

| case | result |
|---|---|
| valid request, `ORS_API_KEY` empty | `200 {"durations":[null,null],"configured":false}` — not a 500 |
| `origin: [999, -122.17]` | `400 {"error":"Invalid origin"}` |
| `destinations: []` | `400` with the 1–200 message |
| body `not json` | `400 {"error":"Invalid JSON"}` |
| `GET` | `405` |

**The failure path was driven end to end against the live ORS API** with a deliberately
invalid key:

- First call after a cold server start: **3.67 s** — a real network round-trip to ORS,
  returning `200 {"durations":[null,null]}`. The 403 was absorbed; nothing threw.
- Immediately after, a call with a **different origin** (so not a cache hit): **0.24 s**.
  The breaker short-circuited it with no ORS call. That is the intended behaviour and the
  timing is the evidence — a cache hit could not explain it, because the key differed.

**Live in Chrome** (dev server): page renders, no new console errors. The only error is the
pre-existing Grammarly hydration warning (`data-gr-ext-installed`), exactly as
`PhaseC_rationale.md` §9 records. The filter renders in its **disabled** state with the
"Drive times need your location" hint, because the automation context grants no geolocation.
Settings → Credits shows all three blocks, with `© openrouteservice · © OpenStreetMap
contributors` under DRIVE TIMES.

---

## 10. Known gaps — read before assuming Phase D is verified

**The ORS success path has never executed.** There is no valid `ORS_API_KEY` on this
machine — `.env.local` has the variable with an empty value for the user to fill in. Every
failure branch is proven; **not one real duration has been computed.** Specifically
unverified:

1. **The `[lng, lat]` order.** §3.1.
2. **The `destinations` index alignment.** §3.2. This is the one that produces
   *plausible-looking wrong answers*.
3. Whether ORS's success responses carry `x-ratelimit-*` headers at all (its error
   responses were checked and do not). `readRemaining()` is a guarded refinement on top of
   the local budget, never a replacement for it.

**First thing to do with a real key** — and do not skip the third probe, it is the only one
that catches a shifted array:

```bash
curl -s -X POST localhost:3000/api/drive-time -H 'content-type: application/json' \
  -d '{"origin":[47.65,-122.17],"destinations":[[47.66,-122.12],[47.61,-122.33]]}'
```

- Durations plausible (Marymoor ≈ 10 min, downtown Seattle ≈ 25 min). Absurd or transposed
  values mean §3.1.
- Re-run immediately: single-digit ms, no ORS request.
- **Send three destinations whose true drive times are obviously different (≈5 / ≈25 / ≈50
  min) and check each lands on the right index.** A leading `0`, or every value shifted one
  place, means §3.2 regressed.

**The enabled filter state was not driven live.** Geolocation cannot be stubbed before the
mount effect runs in this harness, so `driveOrigin` was always `null`. The badge, the
tolerance chips, the colour bands in both themes, and list/map filter agreement are verified
by inspection only. A manual pass with location permission granted is outstanding.

**The mobile breakpoint was again not driven live** — same 1920-wide harness limitation as
`phaseB_rationale.md` §7 and `PhaseC_rationale.md` §10. The filter row is a full-width block
in the existing sticky header, so it should behave, but that is inspection, not evidence.

**In-memory caches and the breaker are per serverless instance.** Redis backs both when
configured (`.env.local` has Upstash credentials), and without it a multi-instance
deployment gets a weaker budget than `ORS_DAILY_BUDGET` implies. This is the same trade-off
`lib/ebird-proxy.ts` documents.

---

## 11. Landmines — things that look wrong but aren't

- **The single `[lng, lat]` swap site is load-bearing.** §3.1. Never swap in a caller.
- **`destinations: chunk.map((_, i) => i + 1)` is not redundant.** Removing it makes the
  origin a destination and shifts every badge. §3.2.
- **The length check that discards a mismatched row is not defensive clutter** — it is the
  only thing standing between §3.2 regressing and shipping wrong numbers silently.
- **The `Authorization` header takes the bare key.** §3.3. And do not restore the claim
  about what a `Bearer` prefix does — it was not reproducible.
- **`ORS_DAILY_BUDGET` defaults to 450, not 2,000.** §4.1. Raising it above the real ceiling
  makes the breaker inert.
- **403 is not synonymous with "quota spent".** §4.2. The body check is what keeps a typo'd
  key from looking like a broken feature.
- **429 deliberately does not negative-cache.** §4.2.
- **Negative caching at 2 minutes, not 15.** §4.3. Both numbers matter, in opposite ways.
- **`driveTimes` never reaches marker props.** It affects the map only through *which groups
  are in the array*. Passing the map down would re-render every marker on every batch
  arrival — `phaseB_rationale.md` §3.9.
- **`visibleMarkerGroups` is filtered from `markerGroups`, never fed back.** §6.2. Feeding it
  back makes the eager fetch oscillate.
- **The detail panel resolves from the unfiltered groups.** §7. This is not an inconsistency
  with the map; it is what stops the filter from closing an open panel.
- **`DriveTimeBadge` fetching for itself is not a second source of truth.** §6.2. Both paths
  share one module cache. Do not "fix" it with a callback.
- **Red here is not tier-red.** `PhaseC_rationale.md` §11 records that red encodes "eBird
  notable". The drive-time chip is a filled chip with a car glyph in the meta row, never in
  the tier-badge position, and it uses `driveTimeTokens()` — not `tierTokens()`, not
  `oddsColor()`.
- **Band boundaries are half-open and defined once** in `driveTimeBand()`: `<15` green,
  `<30` yellow, `<60` orange, else red. A 30-minute drive is yellow. The brief left exactly
  30 and exactly 60 undefined; do not re-derive them at a call site.
- **`ROUTING_CREDITS` is a licensing obligation, not decoration.** §8.
- **Private locations get drive-time badges on purpose.** `PhaseC_rationale.md` §7.4. If a
  future phase adds turn-by-turn or a route polyline, *that* is navigation and goes behind
  `navigableTargets()` — the duration does not.
- **`reportCount` is still always 1**, so the "Reported N× this week here" block remains dead
  code. Pre-existing, out of scope, unchanged — same note as Phases B and C.

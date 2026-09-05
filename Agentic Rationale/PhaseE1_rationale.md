# Phase E1 — onboarding, Pin Drop discoverability, geolocation gating

**Follows:** Phase D (`PhaseD_rationale.md`).
**Date:** 2026-08-29
**Scope:** 5 new modules, 9 files touched. The Alerts sort defect has its own
document — `PhaseE1_fixes.md`.

```
lib/onboarding.ts                 | new   — first-visit flag, versioned
components/OnboardingModal.tsx    | new   — the 4-step intro
lib/geolocation.ts                | new   — permission gating and resolution policy
app/api/geo-estimate/route.ts     | new   — coarse location, Vercel headers
lib/alerts-sort.ts                | new   — see PhaseE1_fixes.md
app/page.tsx                      |  ++   — PENDING_CENTER, locationResolved, startLocation()
components/Map.tsx                |  ++   — neutral view, "Pick a Spot", ? button, hint pill
components/AlertsPanel.tsx        |  ++   — see PhaseE1_fixes.md
components/Sidebar.tsx            |   +   — owns sortBy/searchQuery; locationResolved plumbing
components/SettingsPanel.tsx      |   +   — "Precise location"; push gated on a real location
components/Icons.tsx              |   +   — HelpCircleIcon
lib/ebird.ts                      |   +   — preciseLocation setting
.env.example                      |   +   — IP_GEO_URL (dev convenience)
```

---

## 1. What was wrong

Four phases had added pin search, chase odds, push alerts, sync codes and drive
times, with **no first-run explanation of any of it**. A new user landed on a map
of coloured dots. Three of the four items in this phase follow from that; the
fourth is worse.

**The app asserted a location it had never established.** `app/page.tsx:44` held
`DEFAULT_CENTER = [47.65, -122.17]` — Bellevue, WA — and the mount effect fired a
three-endpoint eBird fetch centred there for *every* visitor, in parallel with the
geolocation permission prompt. A user in Texas was shown Seattle-area birds
labelled "nearby", before they had answered a question the app had only just
asked. There was no `navigator.permissions` check anywhere in the repo.

The brief described this as "the app estimates location before permission is
granted". Worth stating precisely, because it changed the design: **there was no
estimation.** There was a hardcoded constant. IP estimation had to be built from
nothing, and only as the *opt-in* alternative.

---

## 2. Decisions taken with the user before implementing

| Question | Answer | Consequence |
|---|---|---|
| The brief said Pin Drop was "hidden" — **it is not.** `Map.tsx:1106` renders a "Drop Pin" button. | **Promote and rename the existing control.** One affordance, not two. | §3. No new state machine; `isPinMode` / `handleMapClick` / `onPinDrop` are untouched. |
| What does the map show while permission is pending? | **Continental zoom, no fetch, no radius circle, no markers.** | §4.2. Nothing on screen claims to be the user's area. |
| Where does an IP estimate come from, given `connect-src 'self'`? | **Vercel's own geo headers**, via our route, plus an `IP_GEO_URL` dev override. | §4.3. No key, no third party, no new CSP entry. |
| Which sort symptom was actually observed? | All three of the offered readings. | `PhaseE1_fixes.md` §2. |
| Button label — "Search Here" reads as *my current location*, the opposite of what it does. | **"Pick a Spot".** | §3. |

The user also amended the plan with six corrections, all implemented: the
hydration hazard in reading the onboarding flag (§2.1); showing unscored chase
species as unscored (`PhaseE1_fixes.md` §4e); confirming the mobile mount premise
before relying on it (`PhaseE1_fixes.md` §4d); using a sentinel rather than a
region as the pending placeholder (§4.2); `Cache-Control: no-store` on the
estimate route (§4.3); and disabling Low Battery Mode before probing marker
geometry (`PhaseE1_fixes.md` §6b). Every one of them caught something real.

### 2.1 The onboarding flag cannot be read in a `useState` initializer

`hasSeenOnboarding()` returns `true` on the server so the modal stays out of the
SSR payload — but hydration re-runs initializers on the *client*, where `window`
exists, so a first-time visitor would compute `open = true` against a server
payload that rendered nothing. That is a hydration mismatch, and React discards
the mismatched tree. It is read in a mount effect instead.

This repo already carries one benign hydration warning (Grammarly's
`data-gr-ext-installed`, `PhaseC_rationale.md` §9). A second one would land in a
channel that is already being tuned out.

---

## 3. Pin Drop: promotion, not construction

The control existed and was third in a bottom-right stack behind Refresh and
Center, labelled with its mechanism rather than its purpose. It is the app's only
way to look somewhere you are not.

- **First in the stack**, with Clear Pin directly beneath it.
- **"Pick a Spot"**, not "Drop Pin" and not "Search Here" — "here" most naturally
  reads as *my current location*, which is the opposite of what the button does.
- **`CrosshairIcon`**, so the button glyph matches the crosshair `pinSearchGlyph()`
  actually paints and the legend row that calls it "Custom search location". The
  button, the marker and the legend now agree.
- **A hint pill while armed** — *"Tap the map to search there"*. Arming pin mode
  previously changed only the cursor (`CursorController`), which says nothing at
  all on a touch screen: the user tapped, saw no change, and tapped again to turn
  it off.

It is also the escape hatch offered by the neutral-state overlay (§4.2), which is
the moment it is most useful and least discoverable.

---

## 4. Geolocation

### 4.1 One module owns the policy

`lib/geolocation.ts` decides; `app/page.tsx` only commits the answer.

```
precise ON  + granted  → precise GPS fix
precise ON  + prompt   → ask; NO estimate; neutral view until answered
precise ON  + denied   → NO estimate; neutral view + notice
precise OFF            → no getCurrentPosition at all; /api/geo-estimate
```

**Precise mode never IP-estimates, including on denial.** A fallback that fires
when the user says no restores the original wrong-location behaviour under a new
name, and does it to the one user who has explicitly refused. Turning "Precise
location" off is how a user opts into an estimate; nothing else is.

`navigator.permissions.query({ name: 'geolocation' })` is wrapped in try/catch —
Safari has shipped the Permissions API for years while throwing `TypeError` for
that descriptor specifically, and a bare await would reject and take the whole
resolution path with it. Anything unreadable resolves to `'prompt'`: the branch
that asks and estimates nothing.

`PermissionStatus.onchange` is subscribed, so granting permission from the URL bar
upgrades the position without a reload.

### 4.2 The pending state, and why the placeholder is `[0, 0]`

`locationResolved` is **derived**, not stored:

```ts
const locationResolved = baseResolved || pinLocation !== null;
```

A dropped pin resolves the app; *clearing* that pin takes it straight back to the
neutral view. A stored boolean would have stayed true over a placeholder centre
and fetched it. While it is false: no eBird request (the `searchKey` effect and
the auto-refresh timer both return early), no radius circle, no markers, no push
subscription, and the map opens on `NEUTRAL_VIEW` — a continental view that claims
nothing.

`searchCenter` stays typed `[number, number]` rather than becoming nullable.
Making it nullable would push `| null` into `AlertsPanel.userCenter`,
`SettingsPanel.alertCenter`, `MapProps.searchCenter` and every `haversineKm` call
site — a large diff whose only job is to encode a fact one boolean already
encodes. **The invariant is that nothing reads `searchCenter` while
`locationResolved` is false.**

**The placeholder is `PENDING_CENTER = [0, 0]`, and it must not become a real
place.** Bellevue is the exact value that produced the bug, so a read that slips
past the invariant would fail *plausibly* — a Texan sees Washington birds and it
looks like the fix regressed rather than like a new leak. `[0, 0]` is in the Gulf
of Guinea: eBird returns nothing and every distance from it is absurd, so a leak
announces itself. Swapping it back to a populated coordinate is not a cleanup.

`InitialLocationController` was widened from `userLocation` to *any* established
centre, because `MapContainer`'s `center`/`zoom` are frozen at mount by
react-leaflet and cannot carry the neutral → located transition. Keyed on the GPS
fix alone, a user who denied permission and dropped a pin — or one running with
Precise location off — stayed staring at the whole continent while their sightings
loaded three zoom levels below the viewport.

### 4.3 `/api/geo-estimate`

A server route because `next.config.ts` pins `connect-src 'self'`: a browser call
to any IP-geo service is blocked by CSP before it leaves the page. Structural, not
stylistic — the same reasoning as `/api/drive-time`.

- **Vercel's `x-vercel-ip-latitude` / `-longitude` / `-city`.** Free, no key, no
  third party, no extra round trip, available on all plans including Hobby. The
  city header is percent-encoded, and `decodeURIComponent` can throw on a
  malformed sequence — guarded, because a cosmetic label must not take the route
  down.
- **`Cache-Control: no-store` on every response, and `dynamic = 'force-dynamic'`.**
  This response varies per requester. One that reached a shared cache would hand
  one visitor's city to the next — a privacy leak strictly worse than the
  wrong-location bug this route exists to fix, and invisible in dev, where there
  is no CDN and no second user.
- **`IP_GEO_URL`** is a development convenience, empty by default and documented
  as such. Vercel's headers do not exist on localhost, so without it the OFF path
  can only ever be observed returning `null` locally.
- **No coordinate is invented.** With no source available the route returns
  `{ coords: null }` and the client stays in the neutral view. Falling back to a
  default region is the bug.

### 4.4 Two defects found while verifying, not while planning

**Turning Precise location OFF left the precise fix on screen.** The first
implementation merged the new answer into the old state, so the blue "you are
here" dot, the accuracy halo and a search centred on the exact GPS position all
survived a toggle whose entire meaning is *stop using that*. `startLocation` now
re-establishes location from scratch on every call, and a failed resolution drops
back to the neutral view rather than keeping a stale answer. A dropped pin
survives, because `locationResolved` derives from it — the user's own choice is
not thrown away.

**A re-resolution did not move the map.** `InitialLocationController` fires once
by design, so toggling Precise location refetched around a new centre and left the
viewport over the old one — sightings in Austin, map in Seattle. Later
resolutions now set `flyToTarget`, reusing the existing `MapController` path.
Guarded twice: not on the first resolution (that is the controller's instant
`setView`, and a competing `flyTo` would animate against it), and not while a pin
is dropped (the base centre moving underneath must not yank the viewport off the
user's chosen spot).

---

## 5. Onboarding

Four steps, skippable at every one, re-openable from a `?` button on the map.
Esc closes, focus is trapped, `role="dialog"` + `aria-modal`. Centred card on
desktop, bottom sheet on mobile. Honours `lowFi` like `MapControls` and
`MapLegend`.

**The swatches come from `legendRows()` / `pinSearchGlyph()` via `LegendEntry` and
`MarkerSwatch`** — the same descriptors the real Leaflet icons are built from.
Hand-drawing them is exactly the drift that put light-mode greens in the dark-mode
legend before Phase C, and an onboarding screen that teaches the wrong glyph is
worse than no onboarding screen.

**The flag stores a version integer, not `true`,** so a later phase can re-show
the intro by bumping `ONBOARDING_VERSION` instead of inventing a second key.
Anything unparseable reads as version 0: a spurious extra modal is recoverable,
suppressing onboarding for someone who never saw it is not.

### 5.1 The ordering against the permission prompt is load-bearing

On a first visit the modal opens **before any geolocation call**, and the location
flow starts only when it is dismissed (`pendingLocationRef`). A browser permission
sheet stacked behind a modal the user has not read yet is how permissions get
denied by reflex — and a denied geolocation permission cannot be re-requested from
the page. Returning visitors run the flow immediately on mount.

---

## 6. Verification — what was actually proven

`npm run lint`, `npx tsc --noEmit`, `npm run build` all clean.
`/api/geo-estimate` builds as a dynamic route. Both structural greps from Phases C
and D still hold.

Driven live in Chrome against the dev server:

| # | case | result |
|---|---|---|
| 1 | `localStorage.clear()`, reload | Modal opens; **no geolocation prompt**; continental view; **zero `/api/*` requests** |
| 2 | Step a→d, "Start birding" | Modal closes, flag written, location flow runs, 165 sightings load |
| 3 | Reload | No modal; flow runs immediately |
| 4 | `?` button | Modal re-opens at step 1; does **not** re-trigger the location flow |
| 6 | Precise OFF, no source | `{"coords":null,...}`; neutral view holds; does **not** snap to a default region |
| 6b | Precise OFF, source configured | `{"coords":[30.2672,-97.7431],"label":"Austin","source":"ip-geo-url"}`; map flew to Austin, 169 sightings, **GPS dot and halo gone** |
| 6c | Response headers | `cache-control: no-store` present |
| 7 | "Pick a Spot" → tap map | Hint pill shown while armed; crosshair dropped; Clear Pin appeared; search re-ran from the pin (169 → 207) |
| 11 | Marker anchor probe | 0 px deviation, 0 px pulse drift — see `PhaseE1_fixes.md` §6b |

The Alerts-sort cases are in `PhaseE1_fixes.md` §6a.

**6b was exercised against a local `data:` URL, not a third-party service** — the
success branch is proven without disclosing the developer's IP to anyone.

---

## 7. Known gaps — read before assuming Phase E1 is verified

1. **The `denied` branch has never executed.** The Chrome automation profile
   granted geolocation, so the "Location is blocked" overlay copy, the
   "Use approximate area" button in the notice, and the `permission === 'denied'`
   short-circuit in `resolveLocation` are **verified by inspection only**. The
   `prompt` branch of the same overlay was seen rendering behind the onboarding
   modal, so the component itself works.
2. **The Vercel header path has never executed.** Only the `IP_GEO_URL` branch has.
   `x-vercel-ip-latitude` parsing, the percent-decoded city label, and the
   `source: 'vercel'` response are unproven until a deployment. **First thing to
   do on a preview deploy:** `curl -i <url>/api/geo-estimate` and check both the
   coordinates and that `cache-control: no-store` survived the platform.
3. **Safari's `permissions.query` throw is handled but untested.** No Safari in
   this harness.
4. **The mobile breakpoint was again not driven live** — same 1920-wide limitation
   as Phases B, C and D. The modal's bottom-sheet layout and the claim that
   `Sidebar` is never unmounted on mobile are both from the render path.
5. **Onboarding copy has not been read by a real first-time user.** It is short by
   design; whether it is *useful* is a question this harness cannot answer.

---

## 8. Landmines — things that look wrong but aren't

- **`PENDING_CENTER = [0, 0]` is deliberate and must not become a real place.**
  §4.2. Making it plausible makes a leak invisible.
- **`locationResolved` is derived, not stored.** §4.2. Storing it re-opens the
  clear-the-pin hole.
- **Precise mode never falls back to an IP estimate, even on denial.** §4.1. This
  is the whole point of the phase, not an unhandled case.
- **`no-store` on `/api/geo-estimate` is a privacy control, not a caching
  preference.** §4.3.
- **`IP_GEO_URL` is empty on purpose.** It is a dev override; production uses the
  Vercel headers.
- **Onboarding opens before the permission prompt on a first visit.** §5.1.
  Reordering these to "load faster" trains users to deny location.
- **The try/catch around `permissions.query` is not defensive clutter.** §4.1.
  Safari throws.
- **`startLocation` clearing `userLocation` on every call is not redundant.** §4.4.
  Merging is what left the GPS dot up after the user turned precise location off.
- **The `flyToTarget` on re-resolution is guarded against the first resolution and
  against a dropped pin.** §4.4. Both guards were added because removing either
  produces a visible bug.
- **Onboarding swatches come from `lib/marker-style.ts`.** §5. Do not inline SVG
  copies.
- **An IP estimate deliberately sets no `accuracyM`.** A city-level "accuracy"
  would paint the halo in `Map.tsx` over half a state and call it precision.
- **`reportCount` is still always 1**, so the "Reported N× this week here" block
  remains dead code. Pre-existing, out of scope, unchanged — same note as Phases
  B, C and D.

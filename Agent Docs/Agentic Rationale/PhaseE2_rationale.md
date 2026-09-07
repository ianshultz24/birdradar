# Phase E2 — the Eastside Audubon donation prompt

**Follows:** Phase E1 (`PhaseE1_rationale.md`) and its two bugfix rounds.
**Date:** 2026-08-31
**Scope:** 4 new modules, 3 files touched.

```
lib/donation.ts                   | new   — URL, thresholds, pure policy, storage
lib/donation.test.ts              | new   — 18 assertions on the pure policy
lib/analytics.ts                  | new   — track(), the repo's first custom event
components/DonationBanner.tsx     | new   — the banner
app/page.tsx                      |  ++   — session count, engagement count, policy
components/SettingsPanel.tsx      |   +   — permanent "Support" group above Credits
Agentic Rationale/PhaseE1_bugfix_panels_order_pills.md | heading fix only
```

**On the name.** That last file called itself `# PhaseE2_bugfix`. There was no
Phase E2 when it was written — it follows E1 and fixes E1's work, which its own
§2b and §7.1 say repeatedly. The heading is corrected, with a note in place, so
that no future agent reads it as a predecessor to this document. **Any other
reference to "E2" in a file whose name begins with `PhaseE1` is the same error and
should be treated as noise, not as history.**

---

## 1. What this is

BirdRadar is free and is built to support Eastside Audubon, and until now the app
said neither thing. Phase E2 adds an ask, on the explicit condition that it is
earned: a non-blocking banner after real engagement, plus a permanent link in
Settings for anyone who wants to give without being asked.

The brief:

- Banner, not modal. Appears on the **3rd session** OR after **5+ sightings viewed
  in one session**, and **never in the first session** — don't stack on onboarding.
- Dismiss snoozes 14 days in localStorage. A permanent "Support Eastside Audubon"
  link lives in Settings regardless.
- PostHog: `donation_prompt_shown` / `_clicked` / `_dismissed`.
- One config constant for the URL, with a TODO until John supplies the real link.

---

## 2. Decisions taken with the user before implementing

| Question | Answer | Consequence |
|---|---|---|
| What counts as "viewing a sighting"? There are two gestures wired to two different handlers. | **Both** — detail-panel opens and Alerts-list card taps. | §4. And a correction to the plan's own claim about them: §4.1. |
| The brief defines the snooze for Dismiss but is silent on Donate. | **Same key, 365 days.** Someone who just gave is not asked again in two weeks. | §5.2. One key, two expiries — there is no second flag that can disagree. |
| Do the banner and the Settings link share a UTM string? | **One base URL + `donationUrl(campaign)`.** Banner `donate_prompt` as specced; Settings `donate_settings`. | §3. |

Assumptions made without asking, recorded so they can be reversed cheaply:

- The banner is suppressed while location is unresolved and while the "Couldn't get
  your location" notice is up (§5.1). Both turned out to matter more than expected —
  see §7, case 7.
- The banner shows at most once per session. **Ignoring it writes nothing**: only
  Dismiss and Donate snooze. Reloading brings it back, because ignoring is not
  consent and is not a decision.

---

## 3. The URL is the only thing here that is not finished

`EAS_DONATION_BASE` in `lib/donation.ts` is a placeholder
(`https://eastsideaudubon.org/donate`). It is **not exported** — `donationUrl()`
is the only way to reach it — so no call site can link to the bare page and drop
the attribution on the way. When John supplies the real link, one string changes.

**Open question for John, and it decides whether the UTMs do anything at all.**

- If EAS hands over **a page on their own site**, UTMs work normally and their
  analytics attribute the visit.
- If it is a raw **Stripe Payment Link** (`buy.stripe.com/…`), they largely do not.
  Stripe accepts the five standard UTM codes, but they surface only on the
  *post-payment redirect URL*, and only when the link's confirmation behaviour is
  set to redirect rather than Stripe's default confirmation page. They are not
  attached to the Checkout Session and are not in the `checkout.session.completed`
  webhook — so EAS cannot reconcile a gift back to BirdRadar from them. The
  parameter that does reach Stripe's records is `client_reference_id`, which is on
  the Session and in that webhook.

`donationUrl()` therefore sets `client_reference_id=birdradar_<campaign>`
**alongside** the UTMs, pre-emptively. It is an ignored query parameter on an
ordinary web page and the only surviving attribution on a Payment Link, so it is
correct either way and costs one line. Drop it if John confirms a hosted page.

**`donation_prompt_clicked` in PostHog is the attribution BirdRadar controls end to
end.** Everything downstream of the click depends on EAS's configuration, not on
this code. Do not report the two as the same number when the results are written up.

### 3.1 `new URL()` + `searchParams`, never concatenation

The entire design of that constant is that an unknown URL gets pasted over it
later, and donation platforms routinely hand out links that already carry a query
string (`…/donate?form=…`, or a Stripe link with `client_reference_id` pre-set from
the Dashboard's URL-parameters dialog). A hardcoded `?` produces a second one and
every parameter after it dies silently — a failure nobody notices until a quarter
of the attribution is missing. A malformed paste returns the base unmodified rather
than throwing inside a click handler: a link that works without attribution beats a
button that does nothing. `lib/donation.test.ts` asserts there is exactly one `?`.

### 3.2 The copy needs John's sign-off before it ships

*"BirdRadar is free and supports Eastside Audubon."* is short and accurate, and it
speaks on a named 501(c)(3)'s behalf in a solicitation context. EAS — not this
codebase — owns how they are represented when money is being asked for. One line in
the same email that asks for the Stripe URL covers both. **This is an open action
item, not a completed one.**

---

## 4. What "5 sightings" actually counts

Two gestures in this app mean "I looked at that":

- `handleSelectSighting(locKey)` — a map marker opens `SpeciesDetailPanel`.
- `handleFocusSpecies(code)` — an Alerts-list card flies the map and focuses a
  species.

Both now call `noteViewAction(key)`, which adds to a `Set` on a ref and mirrors its
size into state.

### 4.1 The plan claimed these dedupe against each other. They do not, and the code says so

The plan for this phase said the two call sites were "deduped into one `Set`" so a
marker tap and a list tap for the same bird would count once. **That is false and it
was corrected before implementation.** `loc:<locKey>` and `sp:<speciesCode>` are
different strings for the same bird; a single Set dedupes *within* each namespace
only. A user who taps a pin and then the same species in the list scores 2.

The two ways out were: key both sites on species code (true dedup), or keep the
mixed keys and describe the counter honestly. **The second was taken**, because the
first is not actually available — a marker group is a *place* holding many species
and has no single species code, and expanding a group tap into all its species
codes would score one tap as twelve.

So the field is called `viewActions`, not `sightingsViewed`, at every level from
`PromptInputs` down to the PostHog property. The brief's "5+ sightings" is
implemented as **five distinct view actions**, and a location tap and a species
focus are genuinely two different engagement signals. Anyone unifying the keys later
must raise the threshold in the same change.

---

## 5. The policy

`shouldShowDonationPrompt` is a pure function and holds the entire rule:

```
sessionCount >= 2         AND
now >= snoozedUntilMs     AND
(sessionCount >= 3 OR viewActions >= 5)
```

**The first-session guard is checked first and separately from the triggers.**
Folding it into the trigger expression is how "never during the first session"
quietly becomes "usually not during the first session". A session-1 user with
twenty view actions sees nothing, and there is a test that says so.

### 5.1 Four suppressions on top, none of them clutter

- **`onboardingOpen`** — the reason the first-session rule exists. The intro
  re-opens from the map's `?` button in *any* session, so this cannot be inferred
  from the session count.
- **`locationNotice`** — that notice occupies the bottom-centre band on desktop
  (measured at y≈776 during verification), and asking for money while telling the
  user the app cannot find them is the worst available moment.
- **`!locationResolved`** — nothing has been fetched; the user has been shown
  nothing to be grateful for.
- **`donationSettledRef`** — one ask per session, answered or not.

### 5.2 Sessions, and the consequence of how they are counted

`nextSessionState` advances only when `now - lastStartMs >= SESSION_GAP_MS`
(30 min). Two things follow, and the second is the one to know:

1. **`startSession()` is idempotent under StrictMode's double-invoked mount effect**
   without a guard flag. Two calls at the same timestamp cannot double-count. There
   is a test named for this.
2. **The stamp is refreshed on every mount, so the gap is measured between page
   loads, not from the start of the visit.** Someone using the app hard all
   afternoon, reloading every twenty minutes, stays on session 1 and is never asked.
   That is the conservative direction and almost certainly right — they get asked
   tomorrow — but it is real behaviour for exactly the launch-week user this ships
   for. **If the prompt looks under-triggered in PostHog, this is why. It is a
   recorded choice, not a bug.**

`startSession()` is called **before** the deep-link branch in the mount effect,
which returns early. Counting it after would have silently excluded every visit
arriving from a push notification — i.e. the most engaged users.

### 5.3 Corrupt storage fails closed here, and open in `onboarding.ts`

Unparseable session state reads as "no sessions yet", so the visit becomes session 1
and the banner stays hidden. `lib/onboarding.ts` deliberately does the opposite
(unparseable reads as version 0, showing the modal again).

Both are right. A spurious extra intro modal is recoverable; a spurious extra
request for money is not. Same reasoning for the snooze: a corrupt value is treated
as a fresh dismissal, so it suppresses and self-heals in 14 days, and unreadable
storage suppresses outright, because there would be nowhere to write a dismissal to
and the banner would return on every load with no way to stop it.

---

## 6. Placement, which was wrong once and measured twice

The map's bottom band is fully occupied: `MapLegend`'s chip at `left: 10` and
`MapControls`' stack at `right: 10`, both at `bottom: isMobile ? 86 : 30`, both at
`zIndex: 1001`. The banner joins that tier and that offset.

- **Desktop** has ~1080 px between them, so a centred banner clears both — measured
  at 188 px and 205 px of clearance, and 46 px with the legend *expanded* to its
  268 px cap.
- **Mobile has no such gap**; those two controls span the width. The banner goes to
  the top of the map column instead (`top: 52`, under the StatusBar chip at
  `top: 12`), which is the only unoccupied band on that layout.

It renders **inside the map column**, not at page level, so "centred" means centred
over the map rather than over the map plus the 380 px sidebar.

### 6.1 The panel collision, found by measuring rather than by predicting

The first implementation centred on the map column unconditionally. With a species
panel open at 1463 px wide, the banner's right edge overlapped the panel by **17 px**
and the panel (`zIndex: 1002`) clipped the dismiss button. Centring in the map column
is not the same as centring in the *visible* map once a 340 px column is laid over it.

The fix shifts the banner left by `DETAIL_PANEL_WIDTH / 2`, re-centring it in what
remains — the same move `MapControls` makes with the same import
(`right: DETAIL_PANEL_WIDTH + 10`, `Map.tsx:1205`). Verified after: banner centre
752, visible-map centre 752, 153 px clear of the panel, dismiss button hit-testing
to itself.

It takes `rightPanelOpen = selectedLocKey !== null || hotspotPanel !== null` — the
**union**, matching what `Map.tsx` derives for `MapLegend` and `MapControls`.
Passing only `selectedLocKey` would leave the banner clipped by the hotspot panel
alone, which is precisely the class of bug invariant #4 of
`PhaseE1_bugfix_panels_order_pills.md` describes.

### 6.2 The attribution check, and why its premise did not hold

The plan called for confirming the banner does not obscure the Stadia/OSM and
OpenRouteService credits, on the grounds that they sit at the map's bottom edge.
**They do not.** `Map.tsx:890` sets `attributionControl={false}` and Phase C moved
both credit blocks into Settings → Credits; `MapLegend.tsx:99-102` records exactly
this. The banner renders inside the map column and cannot reach the sidebar.

The obligation is real, so it was checked rather than waived: Settings → Credits was
confirmed intact and legible with the banner up, showing Stadia Maps / OpenMapTiles
/ OpenStreetMap, openrouteservice / OpenStreetMap contributors, and eBird.

---

## 7. Verification — what was actually proven

`npm test` **30/30** (12 pre-existing + 18 new). `npx tsc --noEmit`, `npm run lint`,
`npm run build` all clean; **18 API routes + `/` + manifest**, unchanged from E1.

One test failed on first run and it was the *test* that was wrong: the StrictMode
fixture started 60 s before `now`, i.e. inside the gap, so the first call correctly
declined to advance. Fixing the fixture rather than the code is the point of the
note — the gap logic was right.

Driven live in Chrome against a cold dev server (`.next` deleted), 178 sightings,
1463 px viewport. Geolocation is unavailable in this Chrome profile, which handed us
case 7 for free; the resolved-location cases use the push-notification deep link.

| # | case | result |
|---|---|---|
| 1 | `localStorage.clear()`, reload | Session 1 written; onboarding modal; **no banner** — and still none after dismissing it |
| 2 | Session 2, engagement 0→5 | Silent at 0, 1, 2, 3, 4 view actions; **appears on the 5th, with no reload** |
| 3 | Session 3, 0 engagement | Banner on load once location resolves |
| 4 | Dismiss | Closes; snooze = **exactly 14 days**; reload at session 5 with 8 view actions → **still hidden** |
| 5 | Donate | Closes; snooze = **365 days**; href carries `utm_source=birdradar`, `utm_medium=app`, `utm_campaign=donate_prompt`, `client_reference_id=birdradar_donate_prompt`; `target=_blank`, `rel="noopener noreferrer"` |
| 6 | Reload without answering | Banner **returns**; `birdradar_donate_snooze` still `null` |
| 7 | Session 3+, location unresolved | Session advanced 3→4, trigger well past threshold, **no banner** |
| 8 | Geometry, desktop | Banner centre 922 = map-column centre 922; `bottom: 30`; 188 px clear of the Legend chip, 205 px clear of MapControls |
| 8a | Legend expanded | 46 px clear |
| 8b | Right-hand panel open | **Before the fix: 17 px overlap, dismiss button clipped.** After: 153 px clear, centre re-centred to the visible map, dismiss hit-tests to itself |
| 8c | Attribution | Settings → Credits intact and legible: all three basemap credits, both routing credits, eBird. Group order `… Marker Legend → Support → Credits` |
| 9 | Settings → Support | Present with `utm_campaign=donate_settings` **while the 14-day snooze was live** |
| 10 | PostHog | `donation_prompt_shown`, `donation_prompt_clicked`, `donation_prompt_dismissed` — **captured by name**, once each, in order, and **none on the snoozed load** |
| 11 | Console | Only the Grammarly hydration warning (`data-gr-ext-installed`). No new errors |

**How check 10 was actually done, because the obvious route fails.** PostHog gzips
and batches its payloads, so the network tool shows a 200 POST and nothing legible.
Patching `fetch` / `XHR` / `sendBeacon` from the page captured **nothing**, and
`window.posthog` reads as `undefined` — the extension's `javascript_tool` runs in an
**isolated world**, so page globals are neither visible nor patchable. The route that
works is posthog-js's own debug mode: `localStorage.setItem('ph_debug','true')`,
reload, then `read_console_messages` for `[PostHog.js] send "<event>"`. **Worth
knowing for any future phase that needs to assert on an analytics event.**

---

## 8. Known gaps — read before assuming Phase E2 is verified

1. **The real donation URL has never been loaded.** `EAS_DONATION_BASE` is a
   placeholder; §3's Stripe-vs-hosted-page question is unanswered, and
   `client_reference_id` is a pre-emptive bet on the Payment Link case.
2. **The copy has not been approved by Eastside Audubon.** §3.2.
3. **The mobile breakpoint was again not driven live** — same limitation as Phases B
   through E1: the harness reports `resize_window` success while `window.innerWidth`
   stays 1463. **The banner's entire mobile placement — `top: 52`, full width, and
   the claim that it never meets the bottom sheets — is verified by inspection
   only.** It is the highest-risk item in this change, precisely because the desktop
   collision in §6.1 proves this class of assumption gets caught by measurement and
   not by reading.
4. **The 30-minute gap has not been observed crossing in real time.** Every session
   advance in §7 was produced by writing an old `lastStartMs`. The arithmetic is
   asserted in `donation.test.ts`; the wall-clock behaviour is not.
5. **`getSnoozedUntil`, `startSession` and `snoozeDonation` have no unit tests** —
   Node has no `localStorage`. Their storage-independent core is
   `nextSessionState`, which is tested; the wrappers were exercised live in §7
   instead.

---

## 9. Landmines — things that look wrong but aren't

- **`viewActions` is not a count of distinct birds, and must not be renamed to
  suggest it is.** §4.1. Unifying the two key namespaces without raising the
  threshold halves the engagement bar.
- **The first-session guard is a separate statement from the triggers.** §5.
  Folding it into the boolean expression is the whole rule, quietly weakened.
- **Corrupt storage fails *closed* here and *open* in `lib/onboarding.ts`.** §5.3.
  The inconsistency is deliberate; "fixing" it in either direction breaks one of them.
- **`SESSION_GAP_MS` is what makes `startSession()` StrictMode-safe.** §5.2. Adding
  a guard flag is redundant; *removing* the gap makes three reloads three sessions.
- **`startSession()` sits before the deep-link early return.** §5.2. Moving it down
  looks tidier and silently stops counting push-notification visits.
- **`EAS_DONATION_BASE` is not exported on purpose.** §3. Exporting it lets a call
  site link without the attribution parameters.
- **`donationUrl` uses `searchParams`, not concatenation.** §3.1. The one-`?` test
  exists to catch a regression to string building.
- **The banner reads `DETAIL_PANEL_WIDTH` from `SpeciesDetailPanel`.** §6.1 and
  invariant #3 of `PhaseE1_bugfix_panels_order_pills.md`. A local `340` drifts, and
  only while a panel is open, so it is found late.
- **`rightPanelOpen` is the union of both panels**, not `selectedLocKey`. §6.1.
- **The banner is `role="status"`, not `role="dialog"`, and traps nothing.** It is a
  banner. Giving it a backdrop or a focus trap makes it the modal the brief ruled out.
- **Ignoring the banner writes no snooze.** §2. Making a dismissal out of a reload
  would silence the prompt for users who never saw it.
- **The Settings link fires no PostHog event and is never gated.** The brief names
  three prompt-scoped events; a fourth would put un-asked-for data in EAS's funnel,
  and gating the link would let the only permanent path to giving disappear.
- **`lib/analytics.ts` tests `NEXT_PUBLIC_POSTHOG_KEY` rather than inspecting the
  client.** It is the same condition `app/providers.tsx` uses to skip `init`, and
  the env var must stay a complete `process.env.NEXT_PUBLIC_POSTHOG_KEY` member
  expression — Next inlines it by textual substitution, so destructuring silently
  disables analytics in production with no error (`lib/tiles.ts` records the same
  hazard).
- **`reportCount` is still always 1**, so "Reported N× this week here" remains dead
  code. Pre-existing, out of scope, unchanged — same note as Phases B through E1.

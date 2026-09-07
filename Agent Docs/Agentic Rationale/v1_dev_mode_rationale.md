# v1 Developer Mode + maintenance toggle

**Date:** 2026-09-07
**Follows:** `PhaseE3_bugfix_typography.md`
**Spec:** `Agent Docs/Agentic Rationale/Spec Plans/v1dev_mode_spec_plan`
**Scope:** 21 new files, 10 modified. No existing behaviour changed for a
visitor without a `br_dev` cookie.

This is a feature, not a bugfix, but it takes the bugfix format because §3 and
§5 are still where the value is — five of the spec's own environment
assumptions were wrong about this repo, and four plausible-looking
implementations would have been actively harmful.

---

## 1. Symptom

Not a defect report. From the spec:

> Add a Developer Mode to this app: a password-gated in-site panel for testing
> against production, plus a one-click switch that puts the public site into a
> maintenance state with a custom reason.

The standing problem it answers is visible in every rationale doc in this
directory. Phases B, C, D, E1, E2 and E3 each end with a "known gaps" section
saying some variant of *verified by inspection only*. The mobile breakpoint has
never been driven live in any phase. `/api/geo-estimate`'s Vercel-header branch
has never executed. The ORS success path has never computed one real duration.
All of those need a real deployment, and there has been no safe way to poke at
production while real users are on it.

---

## 2. Root cause — what the repo actually contained

The spec said *"verify these against the repo — do not assume"*. Five of its
seven environment assumptions did not hold.

| Spec assumption | Reality |
|---|---|
| Next 16, `proxy.ts`, Node runtime, `node:crypto` | ✅ Correct. Next **16.2.10**; `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` confirms `middleware` → `proxy` at v16.0.0 and *"Proxy defaults to using the Node.js runtime"*. |
| *"If the repo has a `middleware.ts`, migrate it"* | ❌ **Neither file existed.** Nothing to migrate — corroborating `PhaseE1_bugfix_ebird404.md` §3, which recorded `middleware-manifest.json` as `{"middleware":{},"functions":{}}`. |
| Matcher excludes `/ph/` (PostHog proxy) | ❌ **No such proxy exists.** `next.config.ts:17` puts `us.i.posthog.com` directly in `connect-src`, and `.env.local` has `NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com`. See §7. |
| Matcher excludes `/api/health` | ❌ Did not exist. Created — and made load-bearing rather than a dead entry (§4.3). |
| Matcher excludes `/api/cron/*` | ❌ **Wrong paths.** The crons are `/api/alerts/run` and `/api/forecast/build`, driven by `.github/workflows/{alert-watcher,forecast-build}.yml` on a bearer `CRON_SECRET`. |
| Matcher excludes `robots.txt` / `sitemap.xml` | ❌ Neither existed. Both created (§4.7). |
| §9 "sensitive-species chokepoint" | Maps to **`lib/location-privacy.ts`** — eBird's `locationPrivate` personal-location flag, fail-closed at `isPrivateLocation()`. There is no separate sensitive-species module. |

### 2a. Service worker audit (spec §7) — the answer was already on the record

`public/sw.js` registers `install`, `activate`, `push` and `notificationclick`
and **has no `fetch` listener at all**. No precached shell, no navigation
handler, no Cache API use anywhere in the file.

Navigations therefore always reach the network, always reach `proxy.ts`, and a
`503` can never be served from cache. The spec's "navigations must be
network-first" requirement is satisfied **vacuously**, and no caching strategy
was rewritten — as instructed.

This is a pre-existing invariant, not a new finding:
`PhaseE1_bugfix_ebird404.md` §7.4 already records *"`public/sw.js` has no
`fetch` handler and must not grow one casually."* This change adds a second
reason not to, and writes it into `public/sw.js` itself.

---

## 3. Ruled out

Evidence, not inspection. **Do not re-derive these.**

- **That `next.config.ts`'s security headers would be lost on a
  proxy-returned response.** This was the single biggest open risk — a
  maintenance page served without CSP would be a security regression hiding
  inside a reliability feature. The proxy docs put `headers` at step 1 of the
  execution order and Proxy at step 3, which *suggests* they survive, but
  suggestion is not evidence. **Measured** against a live 503:

  ```
  HTTP/1.1 503 Service Unavailable
  Content-Security-Policy: default-src 'self'; script-src …
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  ```

  They survive. **No headers are set explicitly on the maintenance response**,
  and none should be added — a second copy would drift from `next.config.ts`.

- **That the maintenance page would need a CSP change.** It does not.
  `next.config.ts:15` already ships `style-src 'self' 'unsafe-inline'`, so the
  inline `<style>` is permitted, and inline SVG is markup rather than a fetched
  resource so `img-src` never applies. Confirmed by a clean console on the live
  503. `phaseB_fixes.md` §5 flags CSP as the easy thing to miss here; this is
  the answer, not an invitation to loosen anything.

- **That `export const dynamic = 'force-dynamic'` was needed on `/dev`.**
  `cookies()` already opts a route into dynamic rendering — confirmed by the
  build output, which lists `ƒ /dev` with no such export. And `dynamic` is not
  in Next 16's route-segment-config table at all (only `dynamicParams`,
  `runtime`, `preferredRegion`, `maxDuration`).
  `PhaseE1_bugfix_ebird404.md` §5 already identified the one surviving instance
  in this repo, at `app/api/geo-estimate/route.ts`, as dead config awaiting its
  own cleanup. A second was not added.

- **That making `/` dynamic was the way to get ops state to the client.** It is
  a client component that builds static. Server-rendering it would have put a
  Redis read on every render and still only updated the banner on reload. The
  build confirms `/` is **still `○ Static`** after this change.

- **That "you can see the app while `state === down`" implies a dev bypass.**
  It does not, and this was corrected during planning. A non-dev tab that was
  already open when the switch was flipped sees exactly the same thing.
  Inferring the bypass banner from visibility would tell ordinary users the
  site was down for everyone but them. The banner is gated on
  `/api/dev/session` instead.

- **That the auto-lift could be a fire-and-forget `redis.del`.** Two problems:
  it logs nothing, so the audit trail shows a site going down and never coming
  back; and an unconditional delete can clobber a manual write that landed
  microseconds earlier. Both are solved by one compare-and-delete keyed on
  `setAt` (§4.1).

- **That `Retry-After: 900` was fine as a constant.** A two-hour window telling
  clients to return in fifteen minutes is untrue six times over — and the only
  reason to serve a real 503 rather than a rewritten 200 is that these headers
  are believed. Measured: a 30-minute auto-lift now yields `retry-after: 1798`;
  `OPS_FORCE_DOWN` with no `until` yields `900`.

- **That the cache tier's age could be reported for Redis hits.** The Redis
  tier stores the payload raw (`redis.set('br:fresh:' + key, data)`), so age is
  not recoverable without changing the value shape — which would invalidate
  every existing shared cache entry on deploy. Measured instead:
  `memory-fresh` carries `x-br-cache-age: 424`; after a server restart the same
  key returns `redis-fresh` with **the age header absent entirely**, which the
  overlay renders as `—`. Never `0`.

---

## 4. The change

### 4.1 `lib/ops/state.ts` — resolution, and an auto-lift that logs

Redis key `br:ops:mode`, audit list `br:ops:log` (`LPUSH` + `LTRIM 0 99`).

Resolution order: `OPS_FORCE_DOWN=1` → `down` (checked **before** the cache, so
it is free and immune to a stale cached `live`); else Redis behind a 15 s
module-scope cache; **any error → `live`**.

Fail-open is the safety property of the entire feature and the one regression
that takes the site *down* rather than leaving it up. It is not merely asserted
— `lib/ops/state.test.ts` drives it with a client that throws.

**Auto-lift is a logged state change.** An expiry is a transition out of
`down`, and "log every toggle" has to cover the transitions nobody typed. A Lua
`EVAL` deletes the key only if the stored `setAt` still matches the value just
read, so exactly one instance of many wins and a concurrent manual write is
never destroyed. The comparison is numeric (`obj['setAt'] ~= tonumber(ARGV[1])`)
because Lua 5.1's `tostring` renders `1757203200000` as `"1.7572032e+12"` — a
string compare would never match.

If `EVAL` is rejected, the fallback is an unconditional `del` plus a
head-of-log dedupe on `liftedSetAt`. Both paths are tested for the two-racer
case.

### 4.2 `lib/dev/auth.ts` — one helper, three call sites

`readDevSession(jar)` is callable from `proxy.ts`, route handlers and server
components because all three expose the same `get(name) → { value }` shape.

- Cookie: `${exp}.${base64url(HMAC_SHA256("br_dev.v1." + exp, secret))}`,
  httpOnly, sameSite lax, 7-day expiry, `secure` in production.
- The **`br_dev.v1.` prefix is domain separation**, and
  `lib/dev/auth.test.ts` has the only test that proves it does anything: a MAC
  computed over the bare `exp` must not verify.
- `passwordMatches` hashes both sides to 32 bytes *before* `timingSafeEqual`.
  Comparing raw strings would throw on a length mismatch — and a throw that
  only happens on a length mismatch is itself a length oracle.

### 4.3 The trust model — the load-bearing decision

Spec §5: *server-side, ignore `br_dev_flags` entirely unless `br_dev` verifies*.
`br_dev` is httpOnly so the client cannot read it, and `/` must stay static so
the server cannot tell it. Resolution:

```
client boot → br_dev_flags present?  no  → zero extra requests, ever
                                     yes → GET /api/dev/session
/api/dev/session → readDevSession() fails → { dev: false }   (flags discarded)
                 → verifies              → { dev: true, flags }
```

`readDevFlags()` returns `null` unless the session verifies, so there is no
exported path to the flags that skips the check. Measured with a forged
`br_dev_flags` and no `br_dev`:

```
x-br-* debug headers on an eBird response : 0   (5 with a real session)
x-dev-nocache honoured                    : no  (budget unchanged)
GET  /api/dev/debug                       : 401
POST /api/dev/ops                         : 401
```

`/api/health` (new, public) carries the ops state to the client. `/dev`,
`/api/dev/*` and `/maintenance` are `noindex` by meta tag or `X-Robots-Tag`,
disallowed in the new `app/robots.ts`, and absent from the new `app/sitemap.ts`.

### 4.4 `proxy.ts`

Matcher excludes static assets, the metadata files, `/sw.js`, `/api/health`,
`/api/dev/*` and **the two real cron paths**. When `down`: a valid `br_dev`
passes through with an added `x-dev-bypass: 1` request header; `/api/*` or an
`Accept: application/json` client gets `503` JSON; everything else gets the
page. Responses are **built directly, never `NextResponse.rewrite`**.

### 4.5 `lib/ops/maintenance-page.ts`

Fully self-contained — inline CSS, inline SVG, no font, no script, no network.
Asserted, not just intended: `lib/ops/maintenance-page.test.ts` fails the build
on any `<script>`, `<link>`, `<img>`, `@import`, `url(` or `/_next/` reference.
Live response is 4,164 bytes with zero of each.

The wingbeat is 3.6 s ease-in-out, ±13°, pivoting at each wing's shoulder via
`transform-box: fill-box`. The static SVG is authored at the **resting** pose,
so `@media (prefers-reduced-motion: reduce) { animation: none }` leaves a
deliberate composition rather than a frozen frame.

### 4.6 `lib/ebird-proxy.ts` — bypass and debug headers

`cacheGetFresh`/`cacheGetStale` now return `{ data, tier }`; `CacheEntry` gains
`storedAt` for the memory tier. **The Redis value shape is unchanged** (§3).
`proxyEbird` honours `x-dev-nocache: 1` and attaches `x-br-*` headers, both
gated on `readDevSession`. A bypassed response is forced to
`Cache-Control: no-store` so a forced refresh can never populate a shared CDN
cache.

### 4.7 Cron behaviour (spec §6)

`/api/alerts/run` reads the ops state and, when `down`, completes the eBird
fetches (ingest and cache warming are the point of running it) then stops before
any `sendPush` — and **writes no `br:alerted:` markers**, because a marker for
an alert nobody received would swallow it permanently. Returns
`200 { skipped: true }` so GitHub Actions records neither failure nor retry.
Measured: `{"ok":true,"skipped":true,…}`.

`/api/forecast/build` is ingest-only and sends nothing, so it has nothing to
skip. It reports `opsState` for symmetry. **The asymmetry is deliberate** — see
§5.

---

## 5. Deliberately not changed

Each of these is a plausible-looking change that would be wrong.

- **`lib/location-privacy.ts` — not one line.** Developer Mode introduces no
  path around the fail-closed chokepoint. No dev flag, header or cookie is read
  inside it or by any caller. Nothing in `/api/dev/debug`, the `x-br-*` headers,
  the overlay or `br:ops:log` carries observation data at all — no coordinates,
  no location names, no `locId`s. The structural grep still returns that one
  file and nothing else.
- **`next.config.ts` — untouched.** The CSP already permits the maintenance
  page (§3). Loosening it is the failure mode `PhaseE1_bugfix_ebird404.md` §5
  warns about.
- **`lib/alerts-sort.ts` — not one line, for the fourth phase running.**
- **`public/sw.js` gained a comment and nothing else.** Its lack of a `fetch`
  handler is now load-bearing for two features; the comment says so.
- **`/api/forecast/build` still rebuilds during an outage.** Skipping it would
  mean coming back from maintenance with a *staler* forecast than going in,
  which is the opposite of the spec's intent ("continue ingest and caching").
- **The flags cookie is written from the client, not through a route.** It is
  non-httpOnly by design and the server never trusts it — spec §5's whole point
  is that anyone can set it. A dedicated endpoint to write a cookie the server
  treats as hostile anyway would be ceremony that implies a guarantee it does
  not provide.
- **`Lock` does not revoke the token.** It clears the cookie in that browser.
  The session is a stateless HMAC with no server-side list — which is precisely
  what lets `proxy.ts` verify it without a Redis round trip per request. The
  kill switch is rotating `DEV_MODE_SECRET`, and on Vercel that needs a
  redeploy. Both the panel copy and `.env.example` say so.
- **The health poll is 5-minutely and suspended while hidden**, not 30 s. It is
  a *backstop*; the primary signal is the `503 { error: 'maintenance' }` that an
  active client already receives from traffic it is making anyway. `proxy.ts`
  now runs on every non-excluded request, which is a change in the shape of this
  app's function usage — adding a per-30-second invocation from every idle tab
  on top of that is how a Hobby plan's 1M invocations become a surprise.
- **Drive-time's own cache is not bypassed by `x-dev-nocache`.** It bills a real
  ORS quota whose ceiling nobody can pin down (`PhaseD_rationale.md` §4.1).
- **The degraded banner does not use the bottom-centre band.** The location
  notice owns it (`PhaseE2_rationale.md` §5.1). Measured: banner at `top: 52`,
  StatusBar bottom at 45 — a 7 px gap, no overlap.
- **`lib/brand.ts` reaches only the maintenance page and `/dev`.** The ~20 other
  literals keep theirs; the rename gets its own commit. `public/sw.js` could not
  import it anyway.
- **`html, body { overflow: hidden }` was not relaxed for `/dev`.** See §5.2 —
  this was reported as a bug and fixed the other way round.

### 5.2 The `/dev` page could not scroll — fixed inside the route, not the layout

Reported after the first pass: *"I can't actually scroll on the /dev page even
though I can see there's stuff lower on the page."*

The document is pinned by **two** independent sources saying the same thing:
`app/globals.css:9-18` (`html, body { height: 100%; overflow: hidden }`) and the
`h-full overflow-hidden` classes on `<body>` at `app/layout.tsx:59`. The panel
shell used `minHeight: 100vh`, which inside an `overflow: hidden` body is not
scrollable — it is simply clipped. Measured after the fix: content is 1491 px
against a 771 px viewport, i.e. 720 px was unreachable.

**The tempting fix is to relax the body rule, and it would be wrong.** That rule
is what makes the product surface work: `app/page.tsx` is a fixed `100vh` flex
shell whose sidebar and panels scroll internally, and `MapControls`,
`MapLegend`, the banners, the mobile drawer and both bottom sheets are all
positioned against the viewport. A scrollable body would give the map a
scrollbar and detach every one of those — a real regression on the main screen,
traded for a scrollbar on an operator tool.

So the fix is scoped entirely to the route: an outer element with a definite
`height: 100%` and `overflowY: auto` becomes its own scroll container, with an
inner `minHeight: 100%` + `boxSizing: border-box` wrapper so the short unlock
form still centres while the long panel grows and scrolls. Verified: 720 px of
scroll range, reaches the bottom, returns to top, and the `Session` section at
the foot of the page is reachable.

### 5.1 One deviation from the approved plan, stated plainly

The plan listed `lib/ratelimit.ts` under "not modified". It **was** modified —
additively. Spec §5 requires the debug overlay to show "remaining per-IP rate
limit", and that number is not obtainable without asking the limiter.

`peekRateLimit()` is a new export that consumes nothing, is called only after
`readDevSession()` has verified, and changes no existing function. The
alternative was printing the configured maximum and labelling it "remaining" —
a number that looks like a measurement and is not one, which is exactly the
failure `PhaseE1_fixes.md` §4e names for the odds chip.

---

## 6. Verification

### 6.1 Static gates

```
npx tsc --noEmit   clean
npm run lint       clean
npm run build      clean — 24 API routes + / + /dev + /maintenance
                          + manifest + robots.txt + sitemap.xml
npm test           82/82  (30 pre-existing + 52 new)
```

Build confirms two things the design depends on: **`/` is still `○ Static`**,
and **`ƒ Proxy (Middleware)`** is registered.

Both structural greps hold:

```
privacy chokepoint → lib/location-privacy.ts only
coordinate order   → the one ORS swap site + its comment
```

### 6.2 New tests

`lib/dev/auth.test.ts` (16) and `lib/ops/state.test.ts` (23) exist because every
case below was otherwise covered by a curl probe run once, by hand — and a curl
probe does not run again after the commit. `lib/ops/maintenance-page.test.ts`
(13) exists because a `<script>` added to that page later would look completely
fine locally, where nothing is broken.

Highlights: a MAC without the `br_dev.v1.` prefix does not verify; an expired
token does not verify even with a genuine MAC; a throwing Redis client resolves
`live`; two racing resolvers produce exactly one `br:ops:log` entry; a lift does
not clobber a manual write that landed first.

### 6.3 Driven live (dev server, real Upstash, real eBird key)

**Route registration** — the `AGENTS.md` discriminator was applied first:
`/api/totally-fake` → 404 while every new route answered 401/405/200. All seven
new handlers dispatch.

| # | check | result |
|---|---|---|
| 1 | `POST /api/dev/unlock` wrong password | `401`, no `Set-Cookie` |
| 2 | 6th attempt inside the window | `429` (two were consumed by earlier probes; the limiter fires on the 6th cumulative) |
| 3 | `GET /api/dev/unlock?password=…` | `405` — no GET handler exists |
| 4 | correct password | `200`; `br_dev` **HttpOnly**, `br_dev_flags` **not** HttpOnly, `analytics:false` seeded |
| 5 | forged `br_dev_flags`, no `br_dev` | `{"dev":false}` |
| 6 | one flipped character in the MAC | `{"dev":false}` |
| 7 | `/maintenance` without / with cookie | `404` / `200` |
| 8 | `GET /` while down | `503`, HTML, `Cache-Control: no-store` |
| 9 | `Retry-After` with a 30-min auto-lift | **1798** — derived, not 900 |
| 10 | `Retry-After` under `OPS_FORCE_DOWN` | **900**, and no ETA block rendered |
| 11 | `next.config.ts` headers on the 503 | CSP + nosniff + DENY all present |
| 12 | `/api/ebird/recent` while down | `503 {"error":"maintenance","reason":…,"retryAfter":1798}` |
| 13 | `GET /` with `Accept: application/json` | same JSON body |
| 14 | excluded paths while down | `/api/health`, `/robots.txt`, `/sitemap.xml`, `/sw.js`, `/manifest.webmanifest`, `/favicon.ico`, `/icon-192.png` all **200** |
| 15 | `GET /` with `br_dev` while down | `200`, real app |
| 16 | `POST /api/alerts/run` while down | `200 {"skipped":true,…}` |
| 17 | auto-lift (`until` patched into the past) | `/` → 200, `br:ops:mode` **deleted**, log gained `{"state":"live","reason":"auto-lift","liftedSetAt":1788819863137}` |
| 18 | maintenance page self-containment, live | 4,164 B; 0 × `<script>`, `<link>`, `<img>`, `_next/`, `@import`, `url(` |
| 19 | `/dev` unlock form → panel | renders; auto-lift select defaults to **2 hours** |
| 20 | confirm step | *"Every visitor will see a banner; nothing will be blocked, lifting automatically after 2 hours."* |
| 21 | degraded banner geometry | `top: 52`, StatusBar bottom 45 → **7 px gap, no overlap** |
| 22 | debug overlay | mounts; shows the cache-bypass warning |
| 23 | bypass request headers | `x-br-cache: bypass`, budget 100→99, rate 30→29, response `Cache-Control: no-store` |
| 24 | immediate repeat | `memory-fresh`, `x-br-cache-age: 424` |
| 25 | after a server restart (memory cleared, Redis warm) | `redis-fresh`, **age header absent** — the overlay's `—` |
| 26 | forged flags: headers / bypass / debug / ops | 0 headers · ignored · 401 · 401 |
| 27 | console | clean — React DevTools notice and `[HMR] connected` only |

**The wingbeat was observed running**, which prior phases could not do for their
animations: 6 distinct transform matrices sampled over ~1.3 s,
`transform-box: fill-box` resolved, origin at the shoulder. Worth recording —
`PhaseC_fixes.md` §3.1 and `ind_bugfix_A.md` §6 established that
`requestAnimationFrame` never fires in the occluded automation tab, but **CSS
animations are driven by the style/compositor path, not rAF**, so they *are*
observable here. That trap does not apply to this kind of animation.

### 6.4 Known gaps — read before assuming this is fully verified

1. **The mobile breakpoint was again not driven live.** Same limitation as
   Phases B → E3: `resize_window` reports success while `window.innerWidth`
   stays 1920. The degraded banner and the debug overlay at 390 px are
   **inspection only**. The banner spans `left: 10` to `right: 10` and would be
   the first thing to check on a device.
2. **`prefers-reduced-motion: reduce` was not forced in the browser.** The CSS
   rule is asserted by unit test and the resting pose is authored deliberately,
   but the rendered static pose was not seen. Needs DevTools → Rendering.
3. **Light mode of the maintenance page was not seen.** The test profile
   preferred dark. The `prefers-color-scheme` block is asserted present; its
   appearance is unverified.
4. **The non-dev auto-reload was not driven end to end.** Reaching it requires
   a tab loaded as a non-dev *before* the switch flips, then either an API call
   or a 5-minute poll. The constituent parts are verified (the 503 is served,
   the reload is guarded by a fired-flag and by `session !== 'none'`), but the
   sequence was not observed. **This is the highest-value remaining manual
   check.**
5. **The push-alert catch-up is bounded but was not measured.** The local DB has
   zero subscriptions, so `skipped: true` was returned over an empty set. The
   bound is structural — `findNewLifers` reads eBird's `back=7` window and
   `MAX_ALERTS_PER_RUN` caps each run — so a six-hour outage and a six-day one
   have the same ceiling. Confirm with a real subscription before trusting it.
6. **Multi-instance propagation was not observed.** One dev server means one
   module cache. The 15 s TTL and the two-racer auto-lift are covered by unit
   tests against a shared fake store, not by two live instances.
7. **`DEV_MODE_SECRET` was generated locally and appended to `.env.local`.** It
   must be set in Vercel for Production and Preview, where a change needs a
   **redeploy**.

---

## 7. Flagged, not implemented — the PostHog `/ph/` proxy

Recorded because this work surfaced it and it has a deadline. **Nothing here
acts on it.**

The spec's matcher named `/ph/` as a PostHog reverse proxy. **No such proxy
exists in this repo**: `next.config.ts:17` lists `us.i.posthog.com` directly in
`connect-src`, `.env.local` has
`NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com`, and there are no rewrites
in `next.config.ts` at all. The exclusion was therefore correctly dropped.

But that contradicts a decision recorded elsewhere as settled: a self-hosted
proxy at `/ph/` with `NEXT_PUBLIC_POSTHOG_HOST` pointing at
`https://radar.ianshultz.com/ph`. Either it was never built or it was removed
during the phase work.

It matters more than a stale note. The proxy exists because blocklists match
`us.i.posthog.com` by name; capturing direct means an unknown fraction of
sessions is never counted, skewed toward the desktop-with-uBlock end of the
distribution. **The undercount cannot be backfilled**, so it wants fixing before
the September distribution push rather than after the metrics freeze.

Its own commit, its own rationale doc, and a decision about which record is
wrong.

---

## 8. Invariants for future agents

1. **Fail open is the safety property of the whole feature.** Any error reading
   the ops state resolves to `live`. A regression here takes the public site
   down; there is a test named for it.
2. **`OPS_FORCE_DOWN` is checked before the module cache**, so it is free and
   cannot be masked by a stale cached `live`. It also must never auto-lift.
3. **The auto-lift's compare-and-delete on `setAt` is load-bearing twice** —
   single-writer for the audit log, and protection against clobbering a
   concurrent manual write. The Lua comparison must stay numeric.
4. **`br_dev_flags` is a hint, never an authority.** Every server path checks
   `br_dev` first. `readDevFlags()` returning `null` without a session is the
   enforcement mechanism; do not add a second path to the flags.
5. **The bypass banner is gated on `/api/dev/session`, never on visibility.**
   §3. Inferring it from "the app rendered" is wrong for an already-open tab.
6. **`Retry-After` is derived from `until`.** A constant is a lie for every
   window that is not fifteen minutes.
7. **The maintenance page may fetch nothing, ever.** No script, no link, no img,
   no `url()`, no `/_next/`. There is a test that fails the build otherwise, and
   it exists because such an addition looks fine everywhere except in the one
   situation the page is for.
8. **The `br_dev.v1.` MAC prefix is domain separation**, and the test for it is
   the only thing proving it works.
9. **`x-dev-nocache` still spends the shared eBird upstream budget.** It is a
   debugging tool, not a free refresh — `UPSTREAM_BUDGET_PER_MIN` is shared
   across every instance and every local server (`phaseB_rationale.md` §6).
10. **The Redis cache value shape must stay raw.** Wrapping it to carry a
    timestamp would invalidate every shared entry on deploy. `—` is the correct
    reading for an unknown age; `0` is not.
11. **`/sw.js` must stay excluded from the matcher, and must not grow a `fetch`
    handler.** Both features in `public/sw.js`'s new comment depend on it.
12. **The two cron paths must stay excluded from the matcher**, or GitHub
    Actions logs a failure every five minutes for the length of every outage.
13. **`/` must stay static.** Check the build output. If it becomes `ƒ`,
    something started reading cookies or headers on the render path.
14. **Any full-page route under `app/` must bring its own scroll container.**
    `html, body { overflow: hidden }` comes from two places (§5.2) and is
    load-bearing for the map. `minHeight: 100vh` on a page does not scroll — it
    clips. `/dev` shows the pattern: outer `height: 100%` + `overflowY: auto`,
    inner `minHeight: 100%` + `boxSizing: border-box`.
15. **Local dev and production share one Upstash instance** if the same
    credentials are in both `.env.local` and Vercel. `br:ops:mode` is a shared
    key, so **a `down` toggle from localhost takes deployed traffic down too**
    once this ships. That is not hypothetical — `phaseB_rationale.md` §6 already
    records the eBird upstream budget being shared the same way. Either use a
    separate Upstash database for local development, or treat `/dev` on
    localhost as a live production control.
16. **`reportCount` is still always 1**, so "Reported N× this week here" remains
    dead code. Pre-existing, out of scope, unchanged — same note as Phases B
    through E3.

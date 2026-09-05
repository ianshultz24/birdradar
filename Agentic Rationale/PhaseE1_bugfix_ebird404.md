# PhaseE1_bugfix_ebird404 — "the eBird API no longer works"

**Date:** 2026-08-30
**Follows:** `PhaseE1_fixes.md`
**Touches:** nothing. **No file in `app/`, `components/`, or `lib/` was changed.**

The fix was restarting the dev server. That sentence is the whole reason this
document exists: the symptom pointed hard at Phase E1's code, the report named the
eBird endpoints specifically, and every one of those leads is wrong. §3 and §5 are
the payload.

---

## 1. Symptom

Verbatim, as reported:

> It appears the eBird API no longer works after implementing Phase E1. I loaded it
> up in localhost and the console returned these error messages: A tree hydrated but
> some attributes of the server rendered HTML didn't match the client properties.
> […]
> ```
> :3000/api/ebird/hotspots?lat=47.74&lng=-122.11&dist=25:1  Failed to load resource: the server responded with a status of 404 (Not Found)
> :3000/api/ebird/notable?lat=47.74&lng=-122.11&dist=25:1   Failed to load resource: the server responded with a status of 404 (Not Found)
> :3000/api/ebird/recent?lat=47.74&lng=-122.11&dist=25:1    Failed to load resource: the server responded with a status of 404 (Not Found)
> ```

Two reports in one, and they are unrelated to each other. The hydration warning is
noise — see §3. The 404s are real, and they are not about eBird.

---

## 2. Root cause

**The running `next dev` process had lost route dispatch for every App Router route
handler under `app/api/**`, for the life of that process.** Source, `.next` cache,
`node_modules`, and `.env.local` were all innocent and all unchanged by the fix.

### 2a. The symptom is not eBird-scoped — it is `app/api`-scoped

Probed against the live server (PID 17528, started 19:16 local):

```
/                          200  text/html                    ← app page
/manifest.webmanifest      200  application/manifest+json    ← ALSO a route handler (app/manifest.ts)
/api/ebird/recent          404  text/html
/api/ebird/notable         404  text/html
/api/ebird/hotspots        404  text/html
/api/ebird/taxonomy        404  text/html
/api/geo-estimate          404  text/html
/api/drive-time            404  text/html
/api/forecast              404  text/html
/api/sync/pull             404  text/html
/api/alerts/subscribe      404  text/html
─────────────────────────────────────────
/api/totally-fake          404  text/html   ← indistinguishable from the real ones
/nope                      404  text/html
```

All 16 handlers under `app/api/**` were dead. A route handler *outside* `app/api/`
served fine. The user only noticed the three the map calls on mount
(`app/page.tsx:391-393`).

The 404 was rendered by the App Router **page** pipeline, not the route-handler
pipeline: the response carried `Vary: rsc, next-router-state-tree,
next-router-prefetch, next-router-segment-prefetch` and a full app-shell HTML body.
The request was never recognised as an app-route.

### 2b. Next's own view of the app was correct the whole time

`.next/dev/types/routes.d.ts`, regenerated at that server's startup, lists every one
of the 16:

```ts
type AppRouteHandlerRoutes = "/api/alerts/run" | "/api/alerts/subscribe" |
  "/api/drive-time" | "/api/ebird/hotspot-obs" | "/api/ebird/hotspots" |
  "/api/ebird/notable" | "/api/ebird/recent" | "/api/ebird/species" |
  "/api/ebird/spplist" | "/api/ebird/taxonomy" | "/api/forecast" |
  "/api/forecast/build" | "/api/geo-estimate" | "/api/sync/create" |
  "/api/sync/pull" | "/api/sync/push"
```

More than that: the routes still **compiled on demand**. Probing ten endpoints caused
`.next/dev/server/app-paths-manifest.json` to be rewritten containing exactly those
ten, each with a real `route.js` stub and every referenced chunk present on disk
(`.next/dev/server/chunks/app_api_ebird_taxonomy_route_ts_*.js` et al). So the
filesystem scan found the route, the matcher matched it, Turbopack compiled it — and
then the response was a 404 page render anyway. Discovery and dispatch had come
apart inside that process.

### 2c. What actually fixed it

Kill the process tree (`npm run dev` 34176 → `next dev` 37756 → `start-server.js`
17528 → turbopack worker 28952) and run `npm run dev` again.

**`.next` was deliberately left in place** so the restart would be a clean single-
variable experiment. Same source, same cache, same env, same command — and all 16
routes came back. That isolates the fault to the state of the previous *process*,
not to anything on disk and not to anything Phase E1 wrote.

---

## 3. Ruled out

Every hypothesis below was eliminated by evidence, not by inspection. Do not
re-derive these.

- **Anything in the eBird layer.** `app/api/ebird/*/route.ts` are unmodified since
  the last commit — `git status` shows Phase E1 never touched them — and
  `lib/ebird-proxy.ts` is likewise untouched. The client requests exactly the paths
  that 404'd (`app/page.tsx:391-393`). This was the single strongest-looking lead and
  it is worth nothing.
- **A missing or expired `EBIRD_API_KEY`.** `.env.local` has it and is unmodified
  since Aug 17. And the shape is wrong: `fetchEbirdCached` returns
  `{ ok: false, status: 500 }` for an absent key (`lib/ebird-proxy.ts:181`), never a
  404. No path in `proxyEbird` can produce 404 — its only statuses are 200, 400, 429,
  503 and the upstream's own.
- **Rate limiting / the upstream budget.** Those return 429 and 503 with
  `Retry-After`, not 404.
- **Missing or corrupt dependencies.** `@upstash/redis`, `@upstash/ratelimit`,
  `@neondatabase/serverless` and `web-push` each `require()` **and** `import()`
  cleanly from Node in this project. This mattered because `lib/ratelimit.ts` →
  `lib/redis.ts` is imported by all 16 failing routes and by none of the working
  entries — a perfect correlation that turned out to be a coincidence of the fact
  that *every* API route imports it.
- **A compile failure.** Disproved twice over: the routes compiled during the failing
  session (§2b), and no chunk referenced by the emitted `route.js` was missing.
- **`middleware` / `proxy.ts` / rewrites.** No `proxy.ts` or `middleware.ts` exists;
  `.next/dev/server/middleware-manifest.json` is `{"middleware":{},"functions":{}}`;
  `next.config.ts` declares only `headers()`, no rewrites or redirects.
- **The service worker.** `public/sw.js` registers `install`, `activate`, `push` and
  `notificationclick` only. **It has no `fetch` handler**, so it cannot intercept an
  API call. A stale SW is the standard suspect for "requests 404 in the browser but
  the route exists"; here it is structurally impossible.
- **A Pages Router `pages/api` shadow.** There is no `pages/` directory and
  `.next/dev/server/pages-manifest.json` is `{}`.
- **The wrong server on port 3000.** `netstat` gave PID 17528; `.next/dev/lock` names
  the same PID; its command line is `next dev` from this directory. There is also an
  `Example/` folder at the repo root — it holds four `.txt` files, not a second app.
- **`export const dynamic = 'force-dynamic'` in `app/api/geo-estimate/route.ts:36`.**
  The one genuinely anomalous thing Phase E1 added to the API layer: this Next
  version's route-segment-config table
  (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/index.md`)
  lists only `dynamicParams`, `runtime`, `preferredRegion`, `maxDuration`, and
  records `dynamic` as removed in v16.0.0 *under Cache Components* — which
  `next.config.ts` does not enable. It is dead config, not a fault: `/api/geo-estimate`
  returns 200 after the restart with the export still in place. Left alone (§5).
- **The hydration mismatch in the console.** The diffed attributes are
  `data-new-gr-c-s-check-loaded="14.1324.0"` and `data-gr-ext-installed` on `<body>`
  — **Grammarly's browser extension**, writing into the DOM before React hydrates.
  React's own message names this case ("if the client has a browser extension
  installed which messes with the HTML"). It is not caused by this codebase, cannot
  be fixed in it, and has nothing to do with the 404s. It reproduces in a clean
  session and should be ignored, or checked against an incognito window with
  extensions off.
- **A frozen `appPathRoutes` map — the mechanism this document originally proposed,
  and it is WRONG.** `base-server.js:407` does assign `this.appPathRoutes =
  this.getAppPathRoutes()` exactly once in the constructor, from whatever
  `app-paths-manifest.json` held at that instant, with no reassignment anywhere in
  `next/dist/server/`; `getOriginalAppPaths()` (`:1479-1488`) returning `null` makes
  `renderPageComponent` (`:1494`) treat the request as `isAppPath: false` and fall
  through to `render404` (`:1134`) — which matches the observed `Vary` headers
  exactly. **The prediction it makes is false.** At restart the on-disk manifest
  contained ten routes and not `/api/ebird/spplist` or `/api/ebird/hotspot-obs`; if
  the map were frozen from that file, those two would still have 404'd. Both returned
  200 on their first request to the new server. Dev must refresh or bypass that map
  somewhere the greps did not reach. The precise internal mechanism of the stuck
  process is **not established** — do not repeat this trail expecting it to close.

---

## 4. The change

**No code changed.** The operation was:

1. `Stop-Process` on 34176, 37756, 17528, 28952 (the `npm run dev` → `next dev` →
   `start-server` → turbopack-worker tree). Confirmed zero `node.exe` remaining.
2. `npm run dev`.

`.next` was **not** deleted, and that was a deliberate choice rather than an
oversight — see §2c. Deleting it would have restored service just as well and taught
nothing about where the fault lived.

---

## 5. Deliberately not changed

- **`lib/ebird-proxy.ts` in its entirety.** The validation, the per-IP limiter, the
  deployment-wide `UPSTREAM_BUDGET_PER_MIN` circuit breaker, the L1+Redis cache and
  the 24-hour stale fallback are all load-bearing and all innocent. There is nothing
  to "harden" here in response to this report. Editing it to chase a 404 would be
  editing the one file that provably cannot emit one.
- **`app/api/ebird/*/route.ts`.** Unmodified since the last commit and correct.
- **`.env.local` / `.env.example`.** The key is present and valid — the restarted
  server pulled 152 live observations with it.
- **`export const dynamic = 'force-dynamic'` (`app/api/geo-estimate/route.ts:36`).**
  Tempting to delete as "the E1 thing that looks wrong", and it is redundant — the
  route reads request headers and sets `no-store` on every response, so it is dynamic
  by construction. But it is provably not the fault (§3), and removing it as part of
  this fix would have written a false cause into the git history. If it goes, it goes
  as a separate cleanup with its own justification.
- **The hydration warning.** Not ours to fix (§3). Do not add
  `suppressHydrationWarning` to `<body>` in `app/layout.tsx` on account of this
  report — that would suppress *real* future mismatches on the root element to
  silence someone's browser extension.
- **`next.config.ts`.** The CSP is why `/api/drive-time` and `/api/geo-estimate` are
  server routes at all (`connect-src 'self'`). It did not cause this and must not be
  loosened.

---

## 6. Verification

All against the restarted dev server on :3000.

**Live data through the three endpoints from the report:**

```
/api/ebird/recent?lat=47.74&lng=-122.11&dist=25   → 200, JSON array, 152 records
   first: {"speciesCode":"annhum","comName":"Anna's Hummingbird",
           "obsDt":"2026-08-30 15:28","locId":"L40914567", …}
/api/ebird/notable?lat=47.74&lng=-122.11&dist=25  → 200, JSON array, 51 records
/api/ebird/hotspots?lat=47.74&lng=-122.11&dist=25 → 200, JSON array, 607 records
/api/ebird/taxonomy                               → 200, JSON array, 11167 records
```

**All 16 handlers dispatch — each answering with its own semantics rather than 404:**

```
                        GET   POST
/api/ebird/recent       400   405     ← 400 = "lat and lng are required"; correct
/api/ebird/notable      400   405
/api/ebird/hotspots     400   405
/api/ebird/species      400   405
/api/ebird/spplist      400   405
/api/ebird/hotspot-obs  400   405
/api/ebird/taxonomy     200   405
/api/forecast           400   405
/api/forecast/build     405   401     ← 401 = CRON_SECRET enforced
/api/geo-estimate       200   405
/api/drive-time         405   400
/api/sync/create        405   200
/api/sync/pull          405   400
/api/sync/push          405   400
/api/alerts/subscribe   200   400
/api/alerts/run         405   401
─────────────────────────────────
/api/totally-fake       404   404     ← the control still 404s
```

A 405 means the path matched and the method did not — which is the proof the route
is registered. Before the restart every cell in that table read 404.

**Caveats.**

- The probe `POST /api/sync/create` returned 200, which means it **created one
  anonymous sync code row** in the Neon database. It is unreferenced and harmless,
  but it exists.
- Not verified by me: the browser end of the loop — markers on the map, the Alerts
  tab populating, a console free of `/api/` 404s. The API-level evidence above covers
  the reported failure, but load `localhost:3000` and confirm. Expect the Grammarly
  hydration warning to still be there; that is correct and not a regression.
- `npm run build` was not run. Dev is verified; a production build is untested by
  this work.

---

## 7. Invariants for future agents

1. **An `/api/*` 404 in dev is a server-state symptom until proven otherwise.** The
   discriminator is cheap and decisive: if the route appears in
   `.next/dev/types/routes.d.ts` and `/api/nonexistent-path` returns a byte-identical
   404, the router is not seeing your handler and the handler is not the problem.
   Restart `next dev` **before** reading a single line of route code. This cost about
   an hour of investigation that produced no code change.
2. **Check the blast radius before believing the report's framing.** "The eBird API
   is broken" was one probe away from "every route handler is broken", and those are
   different bugs with different suspects. Probe a route outside the accused
   subtree — `/manifest.webmanifest` is a route handler and served fine throughout,
   which is what proved the fault was `app/api`-scoped rather than route-handler-wide.
3. **`lib/ebird-proxy.ts` cannot return 404.** Its statuses are 200, 400, 429, 503
   and the upstream's. If you are looking at a 404 from `/api/ebird/*`, the request
   did not reach that file.
4. **`public/sw.js` has no `fetch` handler and must not grow one casually.** Its
   absence is what makes "a stale service worker is caching the 404s" a one-line
   elimination instead of a debugging session. If offline caching is ever added,
   this entire class of bug becomes ambiguous again — say so in that change.
5. **`data-gr-ext-installed` / `data-new-gr-c-s-check-loaded` in a hydration diff
   means Grammarly, not a bug.** Do not chase it, and do not silence it with
   `suppressHydrationWarning` on `<body>`.
6. **This repo lives inside a OneDrive-synced folder.** `.next` is written
   continuously by Turbopack while OneDrive syncs underneath it. That is not proven
   to have caused this, but it is the most plausible environmental contributor to a
   dev server coming up in a bad state, and it makes "restart first" cheaper than it
   would be in a normal checkout. Excluding `.next` from OneDrive sync is worth doing.

**NOTE FOR AGENTS: THIS DOCUMENT SHOWS AN OUTPUT BY A CODING MODEL SHOWING THE THINGS THAT STILL NEED TO BE DONE ON THE USER'S END TO FINALIZE THE PLATFORM AFTER IMPLEMENTING PHASE E2. THIS WAS WRITTEN BEFORE COMMITTING PHASES D, E1, AND E2**

1. Blocking: none of the last two weeks of work exists outside this machine

  Your last commit is 6ab550b on 2026-08-17 ("fix: map bounds"), and HEAD == origin/main — zero unpushed commits. But the working tree has 15 modified
  files, 5 deletions, and 14 untracked source files, including:

  app/api/drive-time/route.ts      lib/drive-time.ts       lib/onboarding.ts
  app/api/geo-estimate/route.ts    lib/geolocation.ts      lib/alerts-sort.ts
  components/OnboardingModal.tsx   lib/donation.ts         lib/analytics.ts
  components/DriveTimeBadge.tsx    components/DonationBanner.tsx
  test/ts-resolve.mjs + both .test.ts files + all of "Agentic Rationale/"

  That's all of Phase D, all of E1, both E1 bugfix rounds, and E2. If Vercel deploys from this repo, production is running Phase C-era code — no onboarding,
  no geolocation fix, no drive times, no donation prompt, and still the hardcoded-Bellevue bug that E1 existed to kill. The fixes/ → Agentic Rationale/
  rename is also uncommitted, so the deletions and additions need to go in the same commit.

  Nothing below matters until this is committed and pushed.

  ---
  2. Features that are dark until you do something

  Drive times — completely non-functional

  ORS_API_KEY is the only empty variable in your .env.local. Every drive-time badge, the "reachable only" filter, and the tolerance chips render nothing;
  Settings shows "routing key not configured". Sign up at openrouteservice.org/dev/#/signup, then mind three documented traps:

  - Passed as a bare Authorization header with no Bearer  prefix — a prefixed key is rejected as "api_key missing", i.e. it looks like no key at all.
  - Never NEXT_PUBLIC_ — CSP connect-src 'self' blocks browser-side ORS calls anyway.
  - Must also be set in Vercel for Production and Preview.

  Then run the probe from PhaseD_rationale.md §10 — do not skip the third one:

  curl -s -X POST localhost:3000/api/drive-time -H 'content-type: application/json' \
    -d '{"origin":[47.65,-122.17],"destinations":[[47.66,-122.12],[47.61,-122.33]]}'

  Send three destinations with obviously different true times (≈5 / ≈25 / ≈50 min) and check each lands on the right index. Not one real duration has ever
  been computed by this code — the [lng, lat] ordering and the destination index alignment are both unverified, and a shifted array produces
  plausible-looking wrong answers rather than an error.

  Push alerts have no scheduler until you add two GitHub secrets

  .github/workflows/alert-watcher.yml (every 5 min) and forecast-build.yml (daily 08:17 UTC) both need repository secrets under Settings → Secrets and
  variables → Actions:

  ┌─────────────┬──────────────────────────────────────────────────────┐
  │   Secret    │                        Value                         │
  ├─────────────┼──────────────────────────────────────────────────────┤
  │ APP_URL     │ e.g. https://birdradar.vercel.app, no trailing slash │
  ├─────────────┼──────────────────────────────────────────────────────┤
  │ CRON_SECRET │ must match the CRON_SECRET env var in Vercel exactly │
  └─────────────┴──────────────────────────────────────────────────────┘

  Without them each workflow fails on step 1 with an explicit error. Two gotchas: a mismatch surfaces as a 401, which the workflow is written to fail loudly
  on; and GitHub auto-disables scheduled workflows after 60 days without a commit to the repo — relevant given this repo just sat for two weeks.

  Vercel environment variables

  Everything set in .env.local must also exist in Vercel, for Production and Preview separately. They split into two classes and the difference bites:

  - Build-time inlined — NEXT_PUBLIC_STADIA_API_KEY, NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST. Next substitutes these textually at build. An
  existing deployment will never pick up a newly-added one — you must trigger a fresh deploy. If production 401s on tiles after you set the key, this is
  why.
  - Request-time — EBIRD_API_KEY, ORS_API_KEY, ORS_DAILY_BUDGET, VAPID_*, DATABASE_URL, CRON_SECRET, UPSTASH_REDIS_REST_*, EBIRD_UPSTREAM_BUDGET_PER_MIN.
  Effective on restart, no rebuild.

  IP_GEO_URL should stay empty in production — it's a localhost-only dev convenience; prod uses Vercel's own geo headers.

  Stadia domain allowlist

  Dashboard → Manage Properties → Authentication Configuration → add your production domain. This one fails silently in the worst way: a non-allowlisted
  origin gets HTTP 401 plus a watermark tile that is still a valid PNG, so Leaflet renders it without complaint — the map looks loaded and is simply wrong.
  Preview deploys get random subdomains that domain auth won't cover; the api_key covers them provided the key isn't domain-restricted.

  No database setup needed — lib/db.ts creates all three tables (alert_subscriptions, forecast_cache, sync_data) with CREATE TABLE IF NOT EXISTS on first
  query.

  ---
  3. One thing I'd verify before your next deploy

  app/api/forecast/build/route.ts declares maxDuration = 300, and app/api/alerts/run/route.ts declares 60. Vercel Hobby caps function duration at 60 s (300
  s is a Pro feature). If you're on Hobby, the forecast build is over the ceiling — check whether the deploy rejects it or silently clamps it, because a
  clamped 300→60 would make long region rebuilds die mid-run and retry forever. I couldn't determine your plan from the repo.

  ---
  4. Only a real deployment can close these

  3. One thing I'd verify before your next deploy

  app/api/forecast/build/route.ts declares maxDuration = 300, and app/api/alerts/run/route.ts declares 60. Vercel Hobby caps function duration at 60 s (300 s is a Pro feature). If you're on Hobby, the forecast
  build is over the ceiling — check whether the deploy rejects it or silently clamps it, because a clamped 300→60 would make long region rebuilds die mid-run and retry forever. I couldn't determine your plan
  from the repo.

  ---
  4. Only a real deployment can close these

  Carried forward from E1 and E2 as explicitly unproven:

  1. /api/geo-estimate has never run against Vercel's headers — only the IP_GEO_URL dev branch has. First thing on a preview deploy: curl -i <url>/api/geo-estimate, and check both the coordinates and that
  cache-control: no-store survived the platform. That header is a privacy control, not a caching preference — a cached response hands one visitor's city to the next.
  2. The geolocation denied branch has never executed — the Chrome automation profile grants permission. The "Location is blocked" overlay copy and the denied short-circuit are inspection-only.
  3. The mobile breakpoint has never been driven live in any phase, B through E2. The harness reports resize_window success while innerWidth stays 1463. Highest-risk items to check on a real phone:
  HotspotPanel's bottom sheet, handleHotspotDetail's drawer-close, and the donation banner's mobile placement (top: 52, full width) — that last one is new and untested, and the desktop version of the same
  assumption turned out to be wrong by 17 px.
  4. Safari's permissions.query throw is handled but untested — no Safari in the harness.
  5. iOS push requires Add to Home Screen first. The UI already detects and explains this; you just can't test it in desktop Chrome.

  ---
  5. Eastside Audubon — needs a human, not code

  - The donation URL is a placeholder (https://eastsideaudubon.org/donate). Get the real link from John.
  - Ask which kind it is. If it's a raw Stripe Payment Link, UTMs never reach the checkout.session.completed webhook — EAS won't be able to reconcile a gift back to BirdRadar from them. I pre-set
  client_reference_id, which does survive, but confirm.
  - Get sign-off on the copy. "BirdRadar is free and supports Eastside Audubon." speaks for a named 501(c)(3) in a solicitation context.

  ---
  6. Small stuff

  - fc.json and fc2.json are committed debug artifacts sitting in your repo root — raw US-WA forecast dumps from Phase D. Delete them.
  - README.md is literally one line: # birdradar. For a project with 15 env vars, 2 cron workflows, 3 external dashboards, and the silent-failure modes above, that's the gap that will cost you most when you
  come back to this in six months — or hand it to anyone else.
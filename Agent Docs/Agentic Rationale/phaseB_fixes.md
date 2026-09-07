# Stadia Maps 401 — basemap tiles were never authenticated

**Reported as:** "Stadia Maps is no longer working, error 401 Invalid Auth — platform-breaking."
**Date:** 2026-08-14
**Follows:** `6c4c330 fix: phase b round` — see `phaseB_rationale.md`
**Scope:** 5 files (`lib/tiles.ts` new, `components/Map.tsx`, `.env.example`, `.gitignore`, this doc)

---

## 1. What was actually happening

Every basemap tile request from `birdradar.vercel.app` returned **HTTP 401** and Stadia served a
**14,885-byte "invalid auth" watermark PNG** in place of the tile.

The watermark is a *valid image*. Leaflet has no idea anything went wrong — it decodes it and
paints it like any other tile. So the map appears to load and is simply wrong. **You cannot
detect this failure by looking at whether the map rendered.** Check status codes, or look for the
14,885-byte response size — that byte count is the fastest fingerprint.

## 2. Root cause

Stadia's keyless allowance is **origin-scoped**, not global. Measured directly against
`tiles.stadiamaps.com/tiles/alidade_smooth/11/327/713.png`, varying only the `Referer` header:

| Referer | Result |
|---|---|
| *(none)* | **401** — 14885 B watermark |
| `http://localhost:3000/` | 200 — 9345 B real tile |
| `http://127.0.0.1:3000/` | 200 |
| `http://192.168.1.50:3000/` | 200 — private LAN is fine |
| `https://birdradar.vercel.app/` | **401** |
| public referer + `?api_key=<bogus>` | **401** — confirms the param is parsed, not ignored |

`components/Map.tsx` requested tiles with **no API key and no registered domain**. That is exactly
the case Stadia rejects. Localhost and LAN worked; the public domain never could.

## 3. It was not a Phase B regression

The tile URL was byte-identical to what shipped in `33c82c1 initial build` and had never been
touched since — `git log --all -S "tiles.stadiamaps.com"` returns that one commit and nothing
else. Phase B (`6c4c330`) changed no tile code.

This was never "no longer working." It had **never** worked on a public origin. It went unnoticed
because all development happens on `localhost`, which is precisely the origin Stadia exempts.

## 4. The "deleted API key" — nothing was deleted

A content scan of **every blob reachable from every ref** found exactly three files that have ever
contained the string "stadia" anywhere in history:

```
app/globals.css     — a comment noting the background colours track alidade_smooth
components/Map.tsx  — the keyless tile URLs
next.config.ts      — the CSP img-src entry
```

No `STADIA` environment variable, no `api_key=`, in any commit, on any branch, ever. Stashes were
empty; the only unreachable objects were a merge-conflicted `README.md`.

A key *could* have sat in `.env.local` invisibly — `.gitignore` matched `.env*`, so that file has
no history and never will. **But it would have been inert regardless: no committed code has ever
read a Stadia key.** The consumption path did not exist. That is the gap this fix closes, and it
is why "the key went missing" and "the tiles 401" are actually the same single fact.

Side effect of that same `.env*` rule, found while checking: **`.env.example` was itself untracked
and had never been committed.** A fresh clone got no env documentation at all. Now un-ignored via
`!.env.example`.

## 5. The fix

### `lib/tiles.ts` (new)

`getTileLayer(lightMode)` → `{ url, attribution }`. Appends `?api_key=…` **only when the key is
non-empty**, so a keyless checkout still works on localhost and the repo stays runnable for anyone
without an account.

The key is read as the complete literal `process.env.NEXT_PUBLIC_STADIA_API_KEY`. Next inlines
`NEXT_PUBLIC_*` by **textual substitution at build time** — destructuring `process.env` or
computing the variable name defeats the substitution and silently yields `undefined`.

### `components/Map.tsx`

The inline `tileUrl` ternary and `tileAttrib` literal are replaced by a `useMemo` on `[lightMode]`,
consistent with §3.9 of `phaseB_rationale.md` — things flowing into map children stay stable
references. The `<TileLayer>` JSX is otherwise untouched.

### Missing-key guard

Because the failure is silent, `lib/tiles.ts` emits a one-time `console.warn` when there is no key
**and** the hostname isn't loopback / RFC 1918 / `.local`. Regex verified against 17 host cases
including the near-misses `172.15.0.1`, `172.32.0.1`, `evil-localhost.com` and
`192.168.1.50.attacker.com`.

### No CSP change needed

`next.config.ts:16` already lists `https://tiles.stadiamaps.com` in `img-src`, and CSP host-source
matching ignores query strings. Recorded explicitly because §8 of the rationale doc flags CSP as an
easy thing to miss.

---

## 6. Manual steps (outside the repo)

1. **Stadia dashboard** → Manage Properties → Authentication Configuration → add
   `birdradar.vercel.app`; copy an API key.
2. **`.env.local`** → `NEXT_PUBLIC_STADIA_API_KEY=<key>`.
3. **Vercel** → Settings → Environment Variables → same var for **Production and Preview** →
   **then trigger a fresh deploy.**

Step 3's redeploy is not optional. `NEXT_PUBLIC_*` is baked in at build time; an existing
deployment will never pick up a newly-added variable. If production still 401s after you set the
env var, this is why.

**Preview deployments** get random subdomains (`birdradar-git-<branch>-<user>.vercel.app`). Stadia's
docs don't document wildcard domain entries, so domain auth alone won't cover them; the `api_key`
will, provided the key isn't domain-restricted.

---

## 7. Verification — what was actually proven

`npm run lint`, `npx tsc --noEmit`, `npm run build` all clean.

- **Key inlining proved, not assumed.** Built with `NEXT_PUBLIC_STADIA_API_KEY=zz-inline-probe-9876`
  and grepped the emitted client chunk. Found the constructed URL with the key substituted in:
  `` `https://tiles.stadiamaps.com/tiles/${lightMode?"alidade_smooth":"alidade_smooth_dark"}/{z}/{x}/{y}.png${t}` ``
  where `t` = `` `?api_key=${encodeURIComponent("zz-inline-probe-9876")}` ``. The minifier
  constant-folded the empty-key branch away, which also confirms the conditional works.
- **Keyless path intact.** Dev server with no key set: 24 tile requests, all **200**, all without
  `?api_key=` — the localhost exemption still applies and local dev is unaffected.
- **Both themes.** Light → `alidade_smooth` (200). Toggled Light mode off → 20 requests to
  `alidade_smooth_dark`, all **200**. Real tiles in both, no watermarks, attribution intact.
- No console errors; the missing-key warning correctly stays silent on localhost.
- `git check-ignore` and `git status` confirm `.env.example` is now visible to git.

---

## 8. Landmines

- **A bad key does *not* fail on localhost.** Measured: `localhost` + `api_key=not-a-real-key`
  returns **200**, same as no key at all — the origin exemption wins before the key is judged.
  **You therefore cannot validate a Stadia key from local dev.** The only real test is a public
  origin:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Referer: https://birdradar.vercel.app/" \
    "https://tiles.stadiamaps.com/tiles/alidade_smooth/11/327/713.png?api_key=$KEY"
  # 200 = good, 401 = key wrong or revoked
  ```

  Run this *before* concluding anything else is broken.
- **The 401 tile is a valid PNG.** "The map looks fine" proves nothing. Check status codes.
- **`NEXT_PUBLIC_*` is build-time.** Env var without redeploy = no change.
- **The key is public by design.** It ships in the JS bundle; that's how Stadia intends browser
  usage to work, and the domain allowlist is the actual control. Don't proxy it through an `/api`
  route to "hide" it, and don't treat exposure as a secret-rotation emergency beyond quota abuse.
- **Retina tiles are deliberately not enabled.** `{r}` / `@2x` would serve 512 px tiles at
  materially higher credit cost against the free tier's 200k/month. The `.leaflet-container`
  background colours in `globals.css` were also sampled from the 256 px tiles — change both
  together or neither.
- **Free tier is non-commercial.** 200,000 credits/month, no credit card. If BirdRadar ever
  monetizes, this needs a paid Stadia plan.

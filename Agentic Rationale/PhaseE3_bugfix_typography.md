# PhaseE3_bugfix — the font that changed when you clicked a hotspot

**Date:** 2026-09-05
**Follows:** `PhaseE2_rationale.md`, `PhaseE1_bugfix_panels_order_pills.md`
**Scope:** 1 new export in `lib/theme.ts`, 5 components adopting it.

```
lib/theme.ts                      |  ++  — new `text` role layer (17 roles)
components/AlertsPanel.tsx        |   ~  — reference; ONE visible change
components/HotspotPanel.tsx       |  ++  — the reported bug
components/LifeListPanel.tsx      |  ++  — the reported bug
components/SpeciesDetailPanel.tsx |   +  — the sibling that must not drift
components/Sidebar.tsx            |   ~  — role adoption, zero visual change
```

**This is not a font-loading bug.** All three fonts load correctly in every panel,
before and after. §3 records how that was established, because it is the first thing
the next agent will suspect and it is the wrong tree.

---

## 1. Symptom

Verbatim, as reported:

> UI (mostly text and fonts) is inconsistent. I really like the fonts and stylistic
> choices used in Recent/Closest/Chase Odds, but when you click on a hotspot on the
> map or on life list, it turns to a different font that makes it look not very good.
> Ensure fonts are consistent throughout.

Two things worth noting about how this was reported.

- **"Recent/Closest/Chase Odds" is not three views.** Those are the three sort modes
  of one panel, `AlertsPanel`. The user named the sort control because that is what is
  visible at the top of the panel they like; the thing they like is the whole Alerts
  list underneath it. That reading is what made `AlertsPanel` the reference.
- **"a different font" is literally true in one place and figuratively true in two
  others.** `LifeListPanel` really does switch typeface. `HotspotPanel` and
  `LifeListPanel` also switch *weight* within the same typeface, and at 13px a
  variable-font weight step reads as a different face to anyone not measuring it.
  Both were fixed; only one of them is a font change.

---

## 2. Root cause

### 2a. There was no typographic role system, only three fonts

`lib/theme.ts:33-35` exported three font strings and nothing else:

```ts
display: "var(--font-display, 'Space Grotesk', sans-serif)",
sans:    "var(--font-dm-sans, 'Plus Jakarta Sans', sans-serif)",
mono:    "var(--font-jb-mono, 'IBM Plex Mono', monospace)",
```

A font is not a decision. *Which* font a species name gets is the decision, and it
was made 161 separate times: one inline `fontFamily:` per text node across 15
components, each with its own hard-coded `fontSize`, `fontWeight` and sometimes
`letterSpacing`. There is no `tailwind.config.*` in the repo, no `@theme` block in
`app/globals.css`, and no size or weight scale anywhere — roughly 200 inline size
literals including fractional ones (`9.5`, `10.5`, `11.5`, `12.5`).

Nothing in that arrangement can keep two panels agreeing, and they stopped agreeing.
The measured state before this change:

| | AlertsPanel | HotspotPanel | LifeListPanel |
|---|---|---|---|
| species name | 13 / **600** / display | 13 / **500** / display | 13 / **500** / display |
| line 2 | sans italic 11.5 `fg2` | sans italic **11** | **IBM Plex Mono** 10.5 `fg3` |

### 2b. The typeface change: prose set in monospace

`LifeListPanel.tsx:525` (pre-change) rendered the row subtitle — built at `:506` as
`` `${formatDate(meta.firstDate)} · ${meta.firstLocation}` ``, e.g. *"Jan 5, 2024 ·
Marymoor Park"* — with `fontFamily: t.mono`.

That is a full-width prose string in IBM Plex Mono, sitting directly under a Space
Grotesk name, in a panel whose sibling list renders the equivalent line in Plus
Jakarta Sans italic. Everywhere else in the app mono is reserved for short numeric
readouts: distances, `timeAgo`, `×N` counts, odds percentages. This was the one place
a sentence got it, and it is the largest single contributor to the report.

### 2c. The weight change: Space Grotesk 500 vs 600

`HotspotPanel.tsx:231` and `LifeListPanel.tsx:521` used `fontWeight: 500` for the
species name; `AlertsPanel.tsx:798` used `600`.

**This matters because of how the fonts are loaded.** `app/layout.tsx:10-22` loads
Space Grotesk and Plus Jakarta Sans with **no `weight` array**, so `next/font` emits
the variable fonts and every weight in their range is a genuine, separately-shaped
instance. A 500 and a 600 of Space Grotesk at 13px differ in stroke and in advance
width — side by side with the Alerts list, that reads as two typefaces.

### 2d. `LifeListPanel` disagreed with itself

`:392` rendered a species name in **sans** at weight 500 in the search dropdown;
`:521`, 130 lines below, rendered the same species name in **display**. Whichever one
was right, the panel could not be internally consistent while both existed.

### 2e. Three smaller divergences, same cause

- `LifeListPanel.tsx:312,320` — stat value at **26px**, against `Sidebar.tsx:305`'s
  **20px** for the identical stat-tile pattern a few inches up the same column.
- `SpeciesDetailPanel.tsx:165` — tier badge at `letterSpacing: 0.04em` against
  `AlertsPanel.tsx:806`'s `0.02em`, for the same badge, in two panels that are
  visible simultaneously.
- `HotspotPanel.tsx:195` — section count in `t.accent`, where `AlertsPanel`'s
  `SectionHeader` (`:680`) uses `dotColor ?? t.fg3` and this section has no dot.
- `HotspotPanel.tsx:251` — `borderRadius: 5` on the "+ Add" pill, the only 5 in the
  app; every other pill is 4.
- `LifeListPanel.tsx:284` — the panel root set **no `fontFamily` at all**, inheriting
  from `globals.css:16`, while `HotspotPanel.tsx:127` and `SpeciesDetailPanel.tsx:143`
  both state theirs.

---

## 3. Ruled out

Evidence, not inspection. **Do not re-derive these.**

- **A font-loading failure.** This is the obvious hypothesis and it is wrong. All
  three families are loaded by `next/font/google` at `app/layout.tsx:10-30` and the
  variables are applied on `<html>` at `:56`. Verified live in both panels *before*
  the fix: `getComputedStyle` reported `"Space Grotesk"` on the Hotspot species name
  and `"IBM Plex Mono"` on the Life List subtitle — the fonts resolved exactly as
  written. The bug was in what was written.
- **The stale `--font-dm-sans` / `--font-jb-mono` variable names.** Those names lie —
  they hold Plus Jakarta Sans and IBM Plex Mono, per the comments at
  `app/layout.tsx:17,24` — but they lie *consistently*, in `layout.tsx`,
  `lib/theme.ts:33-35,51-53`, `app/globals.css:16,83,137,157,202` and `app/page.tsx:98`.
  A misleading name resolves to the right font. Not the cause. See §5.
- **Leaflet's `.leaflet-container { font-family: "Helvetica Neue" }`**
  (`node_modules/leaflet/dist/leaflet.css:275`, which wins on specificity and on
  import order — `globals.css` is imported at `layout.tsx:4`, `leaflet.css` at `:5`).
  Real, and irrelevant here: `HotspotPanel` and `SpeciesDetailPanel` render as
  siblings of `<Map>` in the map *column* (`app/page.tsx:1179-1190`, `:1158-1173`),
  not inside `.leaflet-container`. Confirmed by readback — Helvetica Neue appears
  nowhere in either panel.
- **A Tailwind class conflict.** There are none to conflict with. Tailwind v4 is
  imported (`globals.css:1`) but contributes only `h-full overflow-hidden` on
  `<html>`/`<body>`. Zero `font-*`, `text-*` or `tracking-*` utilities exist in
  `app/` or `components/`.
- **A stale bundle.** Full `node` process kill, `.next` deleted, cold `npm run dev`.
  All symptoms present before the change and absent after, in the same session.
- **A dark-mode-only divergence.** `lib/theme.ts:51-53` is byte-identical to `:33-35`.
  Confirmed by measurement in both modes (§6, checks 2 and 8).
- **A new console error.** The only error in the whole session is the Grammarly
  hydration warning (`data-gr-ext-installed` / `data-new-gr-c-s-check-loaded`
  injected on `<body>` by the extension). Same one Phases E1 and E2 recorded. Still
  not ours.

---

## 4. The change

### 4a. `lib/theme.ts` — a `text` role layer

Seventeen roles, each a function of the theme returning a `CSSProperties` fragment
that call sites spread: `panelTitle`, `rowTitle`, `rowSub`, `rowMeta`, `cardTitle`,
`sectionLabel`, `sectionCount`, `metaChip`, `actionPill`, `tierPill`, `microCaps`,
`caption`, `statLabel`, `statValue`, `body`, `control`, `emptyState`.

**Every value is lifted from `AlertsPanel` or `Sidebar` as they rendered before this
change**, because that is the look the user asked the other panels to match.
Adopting a role at the reference site is therefore a no-op by construction, and a fix
everywhere else. §7 invariant 2 is the consequence of that choice.

Two roles exist specifically because the distinction was being lost:

- **`rowSub`** — line 2 when it is a *scientific name*: sans, **italic**, 11.5, `fg2`.
- **`rowMeta`** — line 2 when it is *prose*: sans, **not italic**, 11.5, `fg2`.

`LifeListPanel`'s subtitle is prose, so it takes `rowMeta`. Collapsing these two into
one role is how the italic ends up on a date, or the date ends up back in mono.

**Named `text`, not `type`.** `import { type } from './theme'` is one character from
TypeScript's `import { type Foo }` type-only modifier. It parses today; it is not
worth leaving in a file every component imports.

### 4b. The mono weights are written as 700, and that is a zero-pixel change

`app/layout.tsx:25-30` loads IBM Plex Mono with a **discrete** `weight: ['400','500','700']`.
CSS font matching resolves a requested 600 upward, so **every `fontWeight: 600` on
`t.mono` in this codebase has always rendered as 700** — `AlertsPanel.tsx:680,803`,
`HotspotPanel.tsx:195,251`, and roughly fifteen more. The roles say 700 so the source
matches the screen. Nothing moved.

This asymmetry is the whole reason §2c is a real bug and this is not: Space Grotesk
and Plus Jakarta Sans are variable, so *their* 500/600/700 are all genuine.

### 4c. `AlertsPanel` — reference, one visible change

Roles spread at thirteen sites, all no-ops. The single real edit is `:385`: the focus
banner rendered a species name in `t.mono` while every other species name in the app
is `t.display`. It now takes `rowTitle`.

The sort pills (`:334-343`) and the drive-time toggles (`:582`, `:636`) **deliberately
do not take `control`**. Their `fontWeight: active ? 600 : 400` is half the
active-state signal; a role that supplies a fixed weight would erase it. A comment at
the pill block records this.

### 4d. `HotspotPanel` — the reported bug

`:231` weight 500 → `rowTitle` (600). `:234` → `rowSub` (11 → 11.5, `fg2`).
`:141` keeps `fontSize: 14` but takes `panelTitle`'s 700 / `-0.02em` / `lineHeight 1.2`
— 14 rather than the role's 17 because a *place* name is long and 17px ellipsises most
of one in a 340px column. `:144` → `metaChip`. `:195` → `sectionCount` (accent → `fg3`).
`:202`, `:207`, `:212` → `emptyState`, taking "Loading…" out of mono. `:246-252` →
`actionPill`, radius 5 → 4.

### 4e. `LifeListPanel` — the reported bug

`:525` mono → `rowMeta`: **the largest visible fix in this change.** `:521` weight
500 → `rowTitle`. `:392` dropdown name → `rowTitle`, resolving §2d in favour of
display. `:312`,`:320` → `statValue`, 26 → 20. `:284` root gains an explicit
`fontFamily: t.sans`. `:360` and `:443` — the taxonomy-loading hint and the import
toast — leave mono for sans. Buttons take `control` at their existing sizes so no
button width moves.

### 4f. `SpeciesDetailPanel` — the sibling that must not drift

`:161-166` → `tierPill`, `0.04em` → `0.02em`. `:335-338` location meta → `metaChip`,
11.5 → 10.5. `:356` "Reported N× this week here" → `rowMeta`, out of mono.
`:320`,`:330` → `cardTitle`, which also gives those two an explicit family for the
first time. `:168-171` and `:222-225` were already the reference values and take
`panelTitle` / `microCaps` unchanged.

### 4g. `Sidebar` — role adoption only

`statLabel` / `statValue` on the stat strip, so it and `LifeListPanel`'s tiles are
provably the same object rather than two objects that happen to agree. Brand takes
`statValue` at 18. Live badge takes `metaChip`. Both tab bars keep their own weights
(§4c's rule). **No pixel changes in this file.**

---

## 5. Deliberately not changed

- **The `--font-dm-sans` / `--font-jb-mono` misnomers.** §3. Renaming is a four-file
  lockstep edit (`layout.tsx:11,19,26`; `theme.ts:33-35,51-53`;
  `globals.css:16,83,137,157,202`; `page.tsx:98` — the only hard-coded copy of a raw
  var string outside `theme.ts`) for zero visual gain, and a partial rename silently
  drops a font to its fallback with no error.
- **The other ten components.** `SettingsPanel` (38 `fontFamily` sites), `Map`,
  `MapLegend`, `StatusBar`, `ChasePanel`, `OnboardingModal`, `NotificationToast`,
  `DonationBanner`, `DriveTimeBadge`, `Icons`. Scope was agreed as the five panels in
  the reported flow. The roles are exported and ready for them.
- **The sort pills' and tab bars' state weights.** §4c. `PhaseE1_bugfix_panels_order_pills.md`
  §7.7: the pills' `borderBottom: 2px solid transparent` on the *inactive* state is
  what stops the active one changing row height. No role touches `borderBottom`, and
  none was applied to a pill.
- **Section order in `AlertsPanel`.** Invariant 2 of that same document. This change
  moves no JSX; every edit is inside an existing `style` object.
- **`AlertsPanel`'s mono caption** (`:356`, *"Newest sightings first"*) and the
  Arriving-Soon note (`:514`). These are prose in mono and they survive, because they
  are in the panel the user likes and they are *captions* — centred, ≤10.5px, muted.
  `caption` exists to name that pattern rather than to abolish it. The rule this
  change enforces is narrower and defensible: **mono is not for a line the user reads
  as content.** A row subtitle is content; a caption under a control is not.
- **`textTransform: 'uppercase'` on the stat labels.** `AlertsPanel` writes its caps
  into the string (`SIGHTING ODDS`); the stat labels cannot, because their text is
  data-driven (`'Year New'` / `'Lifers'`). `statLabel` keeps `textTransform`,
  `microCaps` does not. That difference is deliberate and documented on the roles.
- **`DETAIL_PANEL_WIDTH`, both panel shells, `zIndex: 1002`, the mobile sheet
  branches.** Typography only. No layout box changed.
- **No shared `<PanelShell>` component.** The duplicated `shellStyle` at
  `HotspotPanel.tsx:95-117` / `SpeciesDetailPanel.tsx:112-133` is a real smell — and
  `HotspotPanel.tsx:22-24` says in a comment that the two must not drift, which is
  exactly the enforcement mechanism that failed here. Extracting it is a layout
  refactor with its own regression surface and was not asked for. `lib/theme.ts` now
  enforces the *typographic* half of that comment for real.
- **`tabular-nums`.** Absent repo-wide. IBM Plex Mono is fixed-width; the numeric
  chips align without it.
- **`lib/alerts-sort.ts`.** Not one line, for the third phase running.

---

## 6. Verification

`npx tsc --noEmit`, `npm run lint`, `npm run build` all clean — **18 API routes + `/`
+ manifest**, unchanged from E2. `npm test` — **30/30**.

Driven live in Chrome against a cold dev server (`node` killed, `.next` deleted,
`npm run dev` from scratch), 166 sightings, 163 species, a 5-species seeded life list,
1512×797.

Font family is the one thing `getAttribute('style')` cannot answer — the inline value
is a `var()` reference, so only the computed style says which face won. Family and
size assertions below use `getComputedStyle`; the pill assertion in check 10 uses
`getAttribute('style')` per `PhaseE1_bugfix_panels_order_pills.md` §7.8, whose rule
came from a disagreement about *weight and pressed state*, not about family.

| # | check | result |
|---|---|---|
| 1 | Alerts tab | unchanged; species name `Space Grotesk 13px 600 rgb(17,24,39)`, sci name `Plus Jakarta Sans 11.5px 400 italic rgb(107,114,128)` |
| 2 | Life List row | title `Space Grotesk 13px 600` (was 500); subtitle **`Plus Jakarta Sans 11.5px 400`** (was IBM Plex Mono 10.5) |
| 3 | Life List stat tiles vs Sidebar stat strip | all five values `Space Grotesk 20px 700` (Life List was 26) |
| 4 | Hotspot panel (University of Washington, 106 spp) | row title `Space Grotesk 13px 600` — **byte-identical to the Alerts row title**; sci name identical; section label `Plus Jakarta Sans 11px 600 rgb(55,65,81)` identical |
| 5 | Hotspot section count | `IBM Plex Mono 11px 700 rgb(156,163,175)` — `fg3`, matching AlertsPanel; was `t.accent` |
| 6 | Hotspot "+ Add" | `IBM Plex Mono 10px 700`, `border-radius: 4px` (was 5) |
| 7 | Species panel tier pill vs Alerts tier pill | both `IBM Plex Mono 9.5px 700`, tracking **`0.19px`** each (= 0.02em); the panel was `0.38px` |
| 8 | Species panel | title `Space Grotesk 17px 700 -0.34px`; sci name `Plus Jakarta Sans 12px italic`; location `Plus Jakarta Sans 12.5px 600` |
| 9 | Dark mode, checks 2 and 4 repeated | families/sizes/weights identical; only colours differ (`rgb(250,250,250)` / `rgb(161,161,170)`) |
| 10 | Sort pills | active `border-width: medium medium 2px`, `border-color: … rgb(27,67,50)`, `font-weight: 600`; inactive same 2px with `transparent` — **no height shift**, invariant intact |
| 11 | Console | only the Grammarly hydration warning. No new errors |

**Caveats.**

- **The mobile breakpoint was again not driven live.** Same harness limitation as
  Phases B through E2: `resize_window` reports success while `window.innerWidth` does
  not move. `HotspotPanel`'s bottom-sheet branch and `Sidebar`'s mobile tab bar
  (`:216-230`) are verified by inspection only. The risk here is lower than in prior
  phases because no layout box changed — but it is not zero: the Life List stat value
  (26 → 20) and the Hotspot row subtitle (11 → 11.5) both change text metrics inside
  rows whose heights are content-driven.
- **The seeded life list was five species with hand-written metadata**, not an
  imported eBird CSV. It exercised `firstDate`/`firstLocation`/`totalCount` rendering,
  which is all check 2 needs, but no long-name overflow case was tested against the
  new 11.5px subtitle.
- **`SpeciesDetailPanel`'s `reportCount` line (`:356`) was not seen on screen.**
  `reportCount` is still always 1, so the branch is dead — a standing note since
  Phase B. It was changed by inspection.

---

## 7. Invariants for future agents

1. **The role values are lifted from `AlertsPanel` and `Sidebar`, and that is the
   contract.** If `AlertsPanel`'s appearance is ever intentionally changed, the roles
   in `lib/theme.ts` must be re-derived from it in the same commit. Otherwise the
   reference and the roles disagree, and the drift restarts from the other end — with
   the roles, which now look authoritative, being the wrong half.
2. **Mono weights in the roles read 700 because IBM Plex Mono is loaded at discrete
   weights** (`app/layout.tsx:28`). Do **not** "restore" them to 600, and do **not**
   add `'600'` to the font load to make 600 real — that would make every mono chip in
   the app lighter than it is today. Space Grotesk and Plus Jakarta Sans are variable
   and their intermediate weights *are* real; that asymmetry is the whole diagnosis
   in §2c.
3. **`rowSub` and `rowMeta` are two roles on purpose.** Italic sans for a scientific
   name, upright sans for prose. Merging them puts an italic on a date or a date back
   in mono.
4. **A role must never overwrite a value that encodes state.** The sort pills, both
   tab bars and the Life/Year toggle carry `fontWeight: active ? 600 : 400`, and
   `PhaseE1_bugfix_panels_order_pills.md` §7.7 makes the pills' `borderBottom` load-
   bearing. No role sets `borderBottom`, and none was applied to those controls.
   Adding `control` to a sort pill silently deletes the active-state signal.
5. **`HotspotPanel.tsx:141` overriding `panelTitle` to `fontSize: 14` is deliberate.**
   It is a place name in a 340px column; at the role's 17px most of one ellipsises.
   The override is one property, and the family/weight/tracking still come from the
   role.
6. **`HotspotPanel.tsx:22-24`'s "these two panels must not drift" comment is now
   partly enforced by code.** The typographic half lives in `lib/theme.ts`. The
   *shell* half — `shellStyle`, `zIndex`, the mobile sheet — is still comment-only and
   is still how a divergence gets in. That is the next thing to extract if this class
   of bug recurs.
7. **`AlertsPanel`'s `EmptyState` prop is `label`, not `text`.** It was renamed
   because the module now imports `text` from `lib/theme`. A merge that reintroduces
   `text` as a prop name shadows the role layer inside that component, and TypeScript
   will report it as a style-object error somewhere unrelated.
8. **`getComputedStyle` is the correct instrument for font *family*.** The inline
   value is a `var()` reference, so `getAttribute('style')` returns the variable, not
   the face. Keep §7.8's rule for weight and pressed state; it does not apply here.
9. **`npm test` is still the cheap first answer to "is the Alerts ordering wrong?"**
   Three consecutive phases have been reported against this panel and none of the
   causes were in `lib/alerts-sort.ts`.

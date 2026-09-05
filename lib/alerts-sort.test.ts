import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sortObservations,
  sectionSortMode,
  tierHasChaseOdds,
  type SortMode,
} from './alerts-sort';
import type { ClassifiedObservation, PriorityTier } from './ebird';

/**
 * Assertions for the Alerts ordering.
 *
 * `lib/alerts-sort.ts` justifies its own existence on the grounds that "a
 * comparator buried in a 900-line component cannot be reasoned about, asserted
 * on, or driven from a console" — and then nothing asserted on it. When the sort
 * was reported broken a second time, there was no way to answer "are the
 * comparators correct?" without a browser and a live eBird key. These exist so
 * that question costs one command.
 *
 * Run with `npm test`. Node 24 strips the types natively; `test/ts-resolve.mjs`
 * supplies the extensionless module resolution that ESM does not do.
 */

const CENTER: [number, number] = [47.74, -122.11];

function obs(
  comName: string,
  lat: number,
  lng: number,
  obsDt: string,
  tier: PriorityTier = 'lifer',
): ClassifiedObservation {
  return {
    speciesCode: comName.toLowerCase().replace(/\W/g, '').slice(0, 8),
    comName,
    sciName: `Scientificus ${comName}`,
    locName: `Location of ${comName}`,
    locId: `L${comName.length}${lat}`,
    obsDt,
    lat,
    lng,
    obsId: `OBS${comName.length}`,
    locationPrivate: false,
    subId: `S${comName.length}`,
    tier,
  };
}

/** Near centre, oldest. Far from centre, newest. So recency and distance
 *  disagree on every pair — a fixture where the modes MUST differ. */
const ROWS: ClassifiedObservation[] = [
  obs('Surf Scoter', 47.80, -122.39, '2026-08-30 15:28'),
  obs('Stellers Jay', 47.66, -122.12, '2026-08-30 14:02'),
  obs('Evening Grosbeak', 47.96, -122.14, '2026-08-30 11:15'),
  obs('Virginia Rail', 47.70, -122.36, '2026-08-29 18:40'),
  obs('Northern Flicker', 47.75, -122.26, '2026-08-29 09:05'),
  obs('Caspian Tern', 47.71, -122.38, '2026-08-28 16:20'),
];

const names = (rows: ClassifiedObservation[]) => rows.map((o) => o.comName);
const sort = (mode: SortMode, rows = ROWS, ctx = { center: CENTER, scores: new Map<string, number>() }) =>
  names(sortObservations(rows, mode, ctx));

// ─── The headline contract ───────────────────────────────────────────────────

test('each mode produces a different order', () => {
  const scores = new Map([['surfscot', 20], ['stellers', 90], ['eveningg', 55]]);
  const recent = sort('recent');
  const closest = sort('closest');
  const chase = sort('chase', ROWS, { center: CENTER, scores });

  assert.notDeepEqual(recent, closest, 'closest must not match recent');
  assert.notDeepEqual(recent, chase, 'chase must not match recent');
  assert.notDeepEqual(closest, chase, 'chase must not match closest');
});

test('recent is newest first', () => {
  assert.deepEqual(sort('recent'), [
    'Surf Scoter', 'Stellers Jay', 'Evening Grosbeak',
    'Virginia Rail', 'Northern Flicker', 'Caspian Tern',
  ]);
});

test('closest is nearest first', () => {
  assert.deepEqual(sort('closest')[0], 'Stellers Jay');
  assert.deepEqual(sort('closest').at(-1), 'Evening Grosbeak');
});

test('chase ranks by score descending, unscored last', () => {
  const scores = new Map([['surfscot', 20], ['stellers', 90], ['eveningg', 55]]);
  const out = sort('chase', ROWS, { center: CENTER, scores });
  assert.deepEqual(out.slice(0, 3), ['Stellers Jay', 'Evening Grosbeak', 'Surf Scoter']);
  // The three unscored keep recency among themselves, below everything scored.
  assert.deepEqual(out.slice(3), ['Virginia Rail', 'Northern Flicker', 'Caspian Tern']);
});

test('chase with no scores yet degrades to recency, not to input order', () => {
  const shuffled = [ROWS[4], ROWS[0], ROWS[3], ROWS[1], ROWS[5], ROWS[2]];
  assert.deepEqual(
    sort('chase', shuffled, { center: CENTER, scores: new Map() }),
    sort('recent', shuffled),
  );
});

// ─── Totality: a NaN comparator return is spec'd as +0, i.e. a silent no-op ───
// This is the trap the whole module is built around. A sort that quietly does
// nothing is indistinguishable from the bug it was written to fix.

test('a malformed obsDt does not turn the sort into a no-op', () => {
  const rows = [
    obs('Bad Date A', 47.60, -122.20, 'not-a-date'),
    obs('Good Late', 47.70, -122.30, '2026-08-30 10:00'),
    obs('Bad Date B', 47.61, -122.21, ''),
    obs('Good Early', 47.71, -122.31, '2026-08-25 10:00'),
  ];
  const out = sort('recent', rows);
  assert.deepEqual(out.slice(0, 2), ['Good Late', 'Good Early'], 'valid rows must still order');
  assert.deepEqual(out.slice(2).sort(), ['Bad Date A', 'Bad Date B'], 'malformed rows sink');
});

test('a non-finite coordinate does not poison the closest sort', () => {
  const rows = [
    obs('Far', 47.99, -122.99, '2026-08-30 10:00'),
    obs('Broken', Number.NaN, Number.NaN, '2026-08-30 11:00'),
    obs('Near', 47.74, -122.11, '2026-08-30 09:00'),
  ];
  const out = sort('closest', rows);
  assert.deepEqual(out, ['Near', 'Far', 'Broken'], 'unmeasurable sorts last, the rest still order');
});

test('closest with no established centre degrades to recency', () => {
  const shuffled = [ROWS[3], ROWS[0], ROWS[5], ROWS[1]];
  const out = names(
    sortObservations(shuffled, 'closest', { center: null, scores: new Map() })
  );
  assert.deepEqual(out, sort('recent', shuffled));
  assert.notDeepEqual(out, names(shuffled), 'must not be the input order');
});

test('sortObservations never mutates its input', () => {
  const input = [...ROWS];
  const snapshot = names(input);
  sortObservations(input, 'closest', { center: CENTER, scores: new Map() });
  sortObservations(input, 'chase', { center: CENTER, scores: new Map() });
  assert.deepEqual(names(input), snapshot);
});

// ─── Section policy ──────────────────────────────────────────────────────────

test('only the seen section opts out of the chase sort', () => {
  assert.equal(sectionSortMode('chase', 'seen'), 'recent');
  for (const tier of ['lifer', 'lifer-rare', 'rare'] as PriorityTier[]) {
    assert.equal(sectionSortMode('chase', tier), 'chase');
  }
});

test('other modes pass through every tier untouched', () => {
  for (const mode of ['recent', 'closest'] as SortMode[]) {
    for (const tier of ['lifer', 'lifer-rare', 'rare', 'seen'] as PriorityTier[]) {
      assert.equal(sectionSortMode(mode, tier), mode);
    }
  }
});

test('tierHasChaseOdds matches the sections the chase sort reorders', () => {
  // These are two halves of one contract: scoring a narrower set than the sort
  // consumes is exactly how "Chase Odds" once matched "Recent" in two sections.
  for (const tier of ['lifer', 'lifer-rare', 'rare', 'seen'] as PriorityTier[]) {
    assert.equal(
      tierHasChaseOdds(tier),
      sectionSortMode('chase', tier) === 'chase',
      `${tier} must either be scored and sorted, or neither`,
    );
  }
});

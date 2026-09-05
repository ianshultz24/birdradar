import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  donationUrl,
  nextSessionState,
  shouldShowDonationPrompt,
  SESSION_GAP_MS,
  type SessionState,
} from './donation';

/**
 * Assertions for the donation prompt's policy.
 *
 * These exist for the same reason lib/alerts-sort.test.ts does: the question
 * "why did / didn't the prompt appear?" is otherwise answerable only by seeding
 * localStorage by hand and reloading, which is slow, easy to get wrong, and
 * impossible to do for the negative cases that matter most. The pure exports in
 * lib/donation.ts carry the whole decision, so this needs no browser and no key.
 *
 * Only the pure exports are covered — `startSession` / `getSnoozedUntil` /
 * `snoozeDonation` touch localStorage, which Node does not have. They are thin
 * read-parse-delegate wrappers around `nextSessionState`, which is asserted here.
 *
 * Run with `npm test`.
 */

const NOW = 1_800_000_000_000;
const NEVER_SNOOZED = 0;

/** Defaults chosen so each test states only the field it is about. */
function inputs(over: Partial<Parameters<typeof shouldShowDonationPrompt>[0]> = {}) {
  return {
    sessionCount: 2,
    viewActions: 0,
    snoozedUntilMs: NEVER_SNOOZED,
    now: NOW,
    ...over,
  };
}

// ─── The rule the brief is most emphatic about ───────────────────────────────
// "never during the first session (don't stack on onboarding)". It is checked
// before either trigger, so no amount of engagement can buy past it.

test('the first session never shows the prompt, whatever the engagement', () => {
  for (const viewActions of [0, 5, 20]) {
    assert.equal(shouldShowDonationPrompt(inputs({ sessionCount: 1, viewActions })), false);
  }
});

test('session 0 — the pre-mount and server-side value — never shows the prompt', () => {
  assert.equal(shouldShowDonationPrompt(inputs({ sessionCount: 0, viewActions: 99 })), false);
});

test('a non-finite session count never shows the prompt', () => {
  assert.equal(shouldShowDonationPrompt(inputs({ sessionCount: Number.NaN })), false);
});

// ─── The two triggers ────────────────────────────────────────────────────────

test('the engagement trigger fires on the 5th view action, not the 4th', () => {
  assert.equal(shouldShowDonationPrompt(inputs({ sessionCount: 2, viewActions: 4 })), false);
  assert.equal(shouldShowDonationPrompt(inputs({ sessionCount: 2, viewActions: 5 })), true);
});

test('the session trigger fires on the 3rd session with no engagement at all', () => {
  assert.equal(shouldShowDonationPrompt(inputs({ sessionCount: 3, viewActions: 0 })), true);
});

test('the second session with no engagement shows nothing', () => {
  assert.equal(shouldShowDonationPrompt(inputs({ sessionCount: 2, viewActions: 0 })), false);
});

// ─── Snooze ──────────────────────────────────────────────────────────────────

test('a live snooze suppresses both triggers', () => {
  const snoozedUntilMs = NOW + 1;
  for (const over of [{ sessionCount: 3 }, { sessionCount: 9, viewActions: 50 }]) {
    assert.equal(shouldShowDonationPrompt(inputs({ ...over, snoozedUntilMs })), false);
  }
});

test('the prompt returns the instant the snooze expires', () => {
  // Boundary: `now < snoozedUntilMs` suppresses, so equality must NOT.
  assert.equal(
    shouldShowDonationPrompt(inputs({ sessionCount: 3, snoozedUntilMs: NOW })),
    true,
  );
  assert.equal(
    shouldShowDonationPrompt(inputs({ sessionCount: 3, snoozedUntilMs: NOW - 1 })),
    true,
  );
});

test('a snooze does not override the first-session rule in the other direction', () => {
  // An expired snooze must not resurrect a session-1 prompt.
  assert.equal(
    shouldShowDonationPrompt(inputs({ sessionCount: 1, viewActions: 9, snoozedUntilMs: NOW - 1 })),
    false,
  );
});

// ─── Session counting ────────────────────────────────────────────────────────

test('no stored state starts at session 1', () => {
  assert.deepEqual(nextSessionState(null, NOW), { count: 1, lastStartMs: NOW });
});

test('a reload inside the gap is the same session, with a refreshed stamp', () => {
  const prev: SessionState = { count: 2, lastStartMs: NOW };
  const next = nextSessionState(prev, NOW + SESSION_GAP_MS - 1);
  assert.equal(next.count, 2, 'must not advance');
  assert.equal(next.lastStartMs, NOW + SESSION_GAP_MS - 1, 'stamp must follow the latest load');
});

test('StrictMode double-invocation cannot double-count', () => {
  // Two calls at the identical timestamp is exactly what the dev-mode
  // double-invoked mount effect produces. The gap makes it idempotent, which is
  // why there is no guard flag anywhere.
  const first = nextSessionState({ count: 4, lastStartMs: NOW - SESSION_GAP_MS }, NOW);
  const second = nextSessionState(first, NOW);
  assert.equal(first.count, 5);
  assert.equal(second.count, 5);
});

test('a load past the gap is a new session', () => {
  const next = nextSessionState({ count: 2, lastStartMs: NOW }, NOW + SESSION_GAP_MS);
  assert.deepEqual(next, { count: 3, lastStartMs: NOW + SESSION_GAP_MS });
});

test('corrupt stored state restarts at session 1, suppressing the prompt', () => {
  // The opposite of lib/onboarding.ts's choice, and deliberately so: a spurious
  // intro modal is recoverable, a spurious request for money is not.
  const corrupt: SessionState[] = [
    { count: Number.NaN, lastStartMs: NOW },
    { count: 3, lastStartMs: Number.NaN },
    { count: 0, lastStartMs: NOW },
    { count: -2, lastStartMs: NOW },
  ];
  for (const prev of corrupt) {
    assert.deepEqual(nextSessionState(prev, NOW), { count: 1, lastStartMs: NOW });
  }
});

test('a backwards clock does not advance the session', () => {
  const next = nextSessionState({ count: 2, lastStartMs: NOW }, NOW - 10 * SESSION_GAP_MS);
  assert.equal(next.count, 2, 'a negative elapsed time must not read as a new session');
});

// ─── The URL ─────────────────────────────────────────────────────────────────

test('both surfaces carry the three UTM params from the brief', () => {
  for (const campaign of ['donate_prompt', 'donate_settings'] as const) {
    const params = new URL(donationUrl(campaign)).searchParams;
    assert.equal(params.get('utm_source'), 'birdradar');
    assert.equal(params.get('utm_medium'), 'app');
    assert.equal(params.get('utm_campaign'), campaign);
  }
});

test('the two surfaces are distinguishable downstream', () => {
  assert.notEqual(donationUrl('donate_prompt'), donationUrl('donate_settings'));
  assert.equal(
    new URL(donationUrl('donate_prompt')).searchParams.get('client_reference_id'),
    'birdradar_donate_prompt',
  );
});

test('the params are appended as a query string, not concatenated blindly', () => {
  // The guard against the placeholder being replaced by a link that already
  // carries a query string — a second `?` would kill every param after it.
  const url = donationUrl('donate_prompt');
  assert.equal((url.match(/\?/g) ?? []).length, 1, 'exactly one question mark');
  assert.doesNotThrow(() => new URL(url));
});

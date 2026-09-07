import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  signDevToken,
  verifyDevToken,
  issueDevToken,
  passwordMatches,
  parseDevFlags,
  DEFAULT_DEV_FLAGS,
  DEV_SESSION_TTL_MS,
} from './auth';

/**
 * Assertions for the Developer Mode session token.
 *
 * These exist because every one of these cases was otherwise covered by a curl
 * probe run once, by hand, at implementation time — and a curl probe does not
 * run again after the commit. The token is a pure function of `(exp, secret)`,
 * so none of this needs a server, a cookie or a browser.
 *
 * The case that matters most is the last one: it is the only thing that
 * actually proves the `br_dev.v1.` domain separation exists, rather than being
 * a comment claiming it does.
 *
 * Run with `npm test`.
 */

const SECRET = 'a-long-random-development-secret-value-0123456789';
const OTHER_SECRET = 'a-different-long-random-secret-value-9876543210xy';
const NOW = 1_800_000_000_000;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── The happy path ──────────────────────────────────────────────────────────

test('a well-formed token verifies', () => {
  const { token, exp } = issueDevToken(SECRET, NOW);
  assert.equal(verifyDevToken(token, SECRET, NOW), true);
  assert.equal(exp, NOW + DEV_SESSION_TTL_MS);
});

test('the issued expiry is seven days out', () => {
  const { exp } = issueDevToken(SECRET, NOW);
  assert.equal(exp - NOW, 7 * 24 * 60 * 60 * 1000);
});

// ─── Tamper ──────────────────────────────────────────────────────────────────

test('one flipped character in the MAC does not verify', () => {
  const token = signDevToken(NOW + 1000, SECRET);
  const dot = token.indexOf('.');
  const sig = token.slice(dot + 1);
  // Flip the first signature character to something it certainly is not.
  const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.equal(verifyDevToken(`${token.slice(0, dot)}.${flipped}`, SECRET, NOW), false);
});

test('a token with the signature stripped does not verify', () => {
  const exp = NOW + 1000;
  assert.equal(verifyDevToken(`${exp}.`, SECRET, NOW), false);
  assert.equal(verifyDevToken(`${exp}`, SECRET, NOW), false);
});

test('a re-signed later expiry does not verify under the original secret’s MAC', () => {
  // Extending your own session means re-signing, which needs the secret.
  const token = signDevToken(NOW + 1000, SECRET);
  const sig = token.slice(token.indexOf('.') + 1);
  assert.equal(verifyDevToken(`${NOW + 999_999}.${sig}`, SECRET, NOW), false);
});

// ─── Expiry ──────────────────────────────────────────────────────────────────

test('an expired token does not verify, even with a valid MAC', () => {
  const past = NOW - 1;
  const token = signDevToken(past, SECRET);
  // The MAC itself is genuine — this is purely the expiry check.
  assert.equal(verifyDevToken(token, SECRET, past - 1000), true);
  assert.equal(verifyDevToken(token, SECRET, NOW), false);
});

// ─── Rotation as revocation ──────────────────────────────────────────────────
// A leaked 7-day cookie cannot be individually revoked; rotating
// DEV_MODE_SECRET is the only kill switch, and on Vercel that needs a redeploy.

test('a MAC computed under a different secret does not verify', () => {
  const token = signDevToken(NOW + 1000, OTHER_SECRET);
  assert.equal(verifyDevToken(token, SECRET, NOW), false);
});

test('an empty secret never verifies anything', () => {
  const token = signDevToken(NOW + 1000, SECRET);
  assert.equal(verifyDevToken(token, '', NOW), false);
  // …including a token signed with the empty secret itself.
  assert.equal(verifyDevToken(signDevToken(NOW + 1000, ''), '', NOW), false);
});

// ─── Domain separation ───────────────────────────────────────────────────────
// The only test that proves `br_dev.v1.` does anything. Without the prefix the
// token is an HMAC over a decimal timestamp under the app's only secret, which
// is interchangeable with any other timestamp-keyed signed value.

test('a MAC over the bare exp, without the br_dev.v1. prefix, does not verify', () => {
  const exp = NOW + 1000;
  const bare = base64url(createHmac('sha256', SECRET).update(String(exp)).digest());
  assert.equal(verifyDevToken(`${exp}.${bare}`, SECRET, NOW), false);

  // …and the correctly-prefixed one over the same exp does.
  const prefixed = base64url(createHmac('sha256', SECRET).update(`br_dev.v1.${exp}`).digest());
  assert.equal(verifyDevToken(`${exp}.${prefixed}`, SECRET, NOW), true);
});

// ─── Malformed input must not throw ──────────────────────────────────────────
// verifyDevToken runs inside proxy.ts on every non-excluded request. A throw
// there is a 500 on the whole site, so garbage has to return false, not raise.

test('malformed tokens return false rather than throwing', () => {
  for (const bad of ['', '.', '..', 'abc.def', '-1.AAAA', 'NaN.AAAA', '1e9.AAAA', undefined, null]) {
    assert.equal(verifyDevToken(bad, SECRET, NOW), false, `expected false for ${JSON.stringify(bad)}`);
  }
});

// ─── Password comparison ─────────────────────────────────────────────────────

test('passwordMatches is exact', () => {
  assert.equal(passwordMatches(SECRET, SECRET), true);
  assert.equal(passwordMatches(`${SECRET} `, SECRET), false);
  assert.equal(passwordMatches(SECRET.toUpperCase(), SECRET), false);
});

test('passwordMatches never throws on a length mismatch', () => {
  // Both sides are hashed to 32 bytes first; comparing raw strings would make
  // timingSafeEqual throw here, which is itself a length oracle.
  assert.equal(passwordMatches('x', SECRET), false);
  assert.equal(passwordMatches('x'.repeat(5000), SECRET), false);
});

test('passwordMatches refuses an unset secret and non-string input', () => {
  assert.equal(passwordMatches('anything', ''), false);
  assert.equal(passwordMatches('', ''), false);
  assert.equal(passwordMatches(undefined, SECRET), false);
  assert.equal(passwordMatches({ toString: () => SECRET }, SECRET), false);
});

// ─── Flag parsing ────────────────────────────────────────────────────────────
// br_dev_flags is client-writable, so it is parsed as hostile input even though
// readDevFlags only reaches this after the session has verified.

test('flags default to all-off, with analytics opted out', () => {
  assert.deepEqual(parseDevFlags(undefined), DEFAULT_DEV_FLAGS);
  assert.equal(DEFAULT_DEV_FLAGS.analytics, false);
});

test('flag parsing coerces to real booleans and drops unknown keys', () => {
  const parsed = parseDevFlags(
    JSON.stringify({ cacheBypass: 'yes', showDebugBadges: 1, analytics: true, admin: true })
  );
  assert.deepEqual(parsed, { cacheBypass: false, showDebugBadges: false, analytics: true });
  assert.equal('admin' in parsed, false);
});

test('unparseable flags fall back to the defaults rather than throwing', () => {
  assert.deepEqual(parseDevFlags('{not json'), DEFAULT_DEV_FLAGS);
  assert.deepEqual(parseDevFlags('null'), DEFAULT_DEV_FLAGS);
  assert.deepEqual(parseDevFlags('[]'), DEFAULT_DEV_FLAGS);
  assert.deepEqual(parseDevFlags('"true"'), DEFAULT_DEV_FLAGS);
});

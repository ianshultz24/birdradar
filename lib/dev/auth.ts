import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Developer Mode authentication — one verification helper, three call sites.
 *
 * `readDevSession()` is callable from `proxy.ts`, from route handlers, and from
 * server components, because all three expose a cookie jar with the same
 * `get(name) → { value }` shape. It is built to be reused by the planned
 * `/admin` dashboard rather than re-derived there.
 *
 * ─── Node-only, and that is structural ───────────────────────────────────────
 *
 * This module imports `node:crypto`. Next 16 runs `proxy.ts` on the Node.js
 * runtime by default (and the `runtime` config option is not even available in
 * proxy files), so there is no Web Crypto workaround to write. Nothing in
 * `components/` may import this file — the client half lives in
 * `lib/dev/client.ts`, which shares no code with it on purpose.
 *
 * ─── The two cookies, and why they are not one ───────────────────────────────
 *
 *   br_dev        httpOnly. The session. Signed, expiring, server-verified.
 *   br_dev_flags  NOT httpOnly. The panel toggles. Readable by client
 *                 components, which is the entire reason it is separate.
 *
 * `br_dev_flags` is **a hint and never an authority.** Anyone can forge it; all
 * that buys them is a `{ dev: false }` from `/api/dev/session`. Every server
 * path that acts on a flag — the `x-dev-nocache` cache bypass, the debug
 * response headers, `/api/dev/debug` — verifies `br_dev` first and reads the
 * flags cookie only after that succeeds. `readDevFlags()` enforces this by
 * construction: it returns `null` unless the session verifies, so there is no
 * way to reach the flags without having gone through the check.
 */

// The definitions live in a module with no `node:crypto` dependency — see the
// note at the top of lib/dev/flags.ts. Imported for use here, and re-exported so
// server callers still have one import site.
import {
  DEV_COOKIE,
  DEV_FLAGS_COOKIE,
  DEV_SESSION_TTL_MS,
  parseDevFlags,
  type DevFlags,
} from './flags';

export {
  DEV_COOKIE,
  DEV_FLAGS_COOKIE,
  DEV_SESSION_TTL_MS,
  DEFAULT_DEV_FLAGS,
  parseDevFlags,
  type DevFlags,
} from './flags';

/**
 * Domain separation for the MAC.
 *
 * The signed message is `br_dev.v1.<exp>`, not a bare `<exp>`. Without the
 * prefix the token is an HMAC over a decimal number under the app's only
 * secret — which is exactly what any *other* future signed value keyed on a
 * timestamp would also be, making the two interchangeable. The `v1` also gives
 * a rotation path that does not require changing the secret.
 */
const MAC_DOMAIN = 'br_dev.v1.';

/** The minimum shape shared by `NextRequest.cookies` and `next/headers` `cookies()`. */
export interface CookieJar {
  get(name: string): { value: string } | undefined;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mac(exp: number, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${MAC_DOMAIN}${exp}`).digest();
}

/** `${exp}.${base64url(HMAC_SHA256(exp, secret))}` */
export function signDevToken(exp: number, secret: string): string {
  return `${exp}.${base64url(mac(exp, secret))}`;
}

/**
 * Verify a token against a secret at a point in time.
 *
 * Pure, so it can be asserted on without a request, a server or a cookie —
 * `lib/dev/auth.test.ts` is the whole reason the signature looks like this.
 */
export function verifyDevToken(token: string | undefined | null, secret: string, now: number): boolean {
  if (!token || !secret) return false;

  const dot = token.indexOf('.');
  if (dot <= 0) return false;

  const expRaw = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expRaw) || sig.length === 0) return false;

  const exp = Number(expRaw);
  // Expiry is checked before the MAC so an expired token is cheap to reject,
  // and after parsing so a garbage `exp` cannot reach Number arithmetic.
  if (!Number.isFinite(exp) || exp <= now) return false;

  let supplied: Buffer;
  try {
    supplied = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    return false;
  }

  const expected = mac(exp, secret);
  // timingSafeEqual throws on a length mismatch, and the caller controls the
  // supplied length — so the guard is required, not defensive clutter.
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

/** A fresh token and the expiry the cookie should carry. */
export function issueDevToken(secret: string, now: number): { token: string; exp: number } {
  const exp = now + DEV_SESSION_TTL_MS;
  return { token: signDevToken(exp, secret), exp };
}

/**
 * Constant-time password check.
 *
 * Both sides are hashed to a fixed 32 bytes *before* comparison. Comparing the
 * raw strings would make `timingSafeEqual` throw whenever the lengths differ —
 * and a throw that only happens on a length mismatch is itself a length oracle
 * for the secret, which is the failure this function exists to avoid.
 */
export function passwordMatches(input: unknown, secret: string): boolean {
  if (!secret || typeof input !== 'string' || input.length === 0) return false;
  const a = createHash('sha256').update(input, 'utf8').digest();
  const b = createHash('sha256').update(secret, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** `DEV_MODE_SECRET`, or `''` when unset. Read as a complete member expression. */
export function devSecret(): string {
  return process.env.DEV_MODE_SECRET ?? '';
}

/** True when `/dev` can be unlocked at all. Surfaced in the panel so a missing
 *  secret reads as "not configured" rather than "wrong password". */
export function isDevModeConfigured(): boolean {
  return devSecret().length > 0;
}

/**
 * The single verification helper. `proxy.ts`, route handlers and server
 * components all call this one function.
 */
export function readDevSession(jar: CookieJar, now: number = Date.now()): boolean {
  return verifyDevToken(jar.get(DEV_COOKIE)?.value, devSecret(), now);
}

/**
 * Flags, **or `null` when the session does not verify.**
 *
 * The null return is the enforcement mechanism for spec §5's "server-side,
 * ignore `br_dev_flags` entirely unless `br_dev` verifies". A caller cannot
 * reach the flags without passing the session check, because there is no other
 * exported path to them.
 */
export function readDevFlags(jar: CookieJar, now: number = Date.now()): DevFlags | null {
  if (!readDevSession(jar, now)) return null;
  return parseDevFlags(jar.get(DEV_FLAGS_COOKIE)?.value);
}

/** Cookie attributes for `br_dev`. `secure` is dropped in dev so localhost works. */
export function devCookieOptions(exp: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: new Date(exp),
  };
}

/** Cookie attributes for `br_dev_flags`. Deliberately **not** httpOnly. */
export function devFlagsCookieOptions(exp: number) {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: new Date(exp),
  };
}

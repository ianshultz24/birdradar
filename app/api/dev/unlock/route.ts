import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit } from '@/lib/ratelimit';
import { DEV_ROUTE_HEADERS, readJsonBody } from '@/lib/dev/http';
import {
  DEV_COOKIE,
  DEV_FLAGS_COOKIE,
  DEFAULT_DEV_FLAGS,
  devCookieOptions,
  devFlagsCookieOptions,
  devSecret,
  issueDevToken,
  passwordMatches,
} from '@/lib/dev/auth';

export const runtime = 'nodejs';

/**
 * Exchange the developer password for a session.
 *
 * ─── POST only, and the secret never touches a URL ───────────────────────────
 *
 * There is no `GET` export. A query-string password lands in the browser's
 * history, in the Referer header of every subsequent request, in server access
 * logs, and in any CDN log in front of them — none of which rotate when the
 * secret does. `405` for anything but POST is deliberate, and the absence of a
 * GET handler is the enforcement.
 *
 * ─── Order of operations ─────────────────────────────────────────────────────
 *
 * Rate limit first, *then* configuration, *then* the password. Checking the
 * password before the limiter would make the limiter decorative: an attacker
 * would already have had their guess compared before being told to slow down.
 *
 * The limiter is the existing per-IP one from `lib/ratelimit.ts` — Upstash when
 * configured, per-instance sliding window otherwise — under its own `devunlock`
 * namespace so it shares no bucket with the eBird proxy's 30/60.
 *
 * 5 attempts per 5 minutes. Low, because there is exactly one legitimate user
 * of this endpoint and they know the password.
 *
 * ─── "Not configured" is said out loud ───────────────────────────────────────
 *
 * An unset `DEV_MODE_SECRET` answers 503 with a distinct message rather than
 * folding into "wrong password". The information it gives an attacker is that
 * developer mode is off — which is true, and which they would infer from never
 * succeeding anyway. The information it gives the operator is the difference
 * between a five-minute fix and an hour of typing a password that could never
 * have worked. `PhaseE1_bugfix_sort_drivetime.md` §4d made the same call for the
 * drive-time filter: separate "the user's to fix" from "the operator's to fix".
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (await rateLimit(request, 'devunlock', 5, 300)) {
    return NextResponse.json(
      { error: 'Too many attempts' },
      { status: 429, headers: { ...DEV_ROUTE_HEADERS, 'Retry-After': '300' } }
    );
  }

  const secret = devSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'Developer mode is not configured on this deployment (DEV_MODE_SECRET is unset).' },
      { status: 503, headers: DEV_ROUTE_HEADERS }
    );
  }

  const body = await readJsonBody(request);
  if (!passwordMatches(body?.password, secret)) {
    return NextResponse.json(
      { error: 'Incorrect password' },
      { status: 401, headers: DEV_ROUTE_HEADERS }
    );
  }

  const { token, exp } = issueDevToken(secret, Date.now());

  const response = NextResponse.json({ ok: true, exp }, { headers: DEV_ROUTE_HEADERS });

  // The session. httpOnly, so the browser cannot read it — which is precisely
  // why the flags below are a separate, readable cookie.
  response.cookies.set(DEV_COOKIE, token, devCookieOptions(exp));

  // Seeded on unlock rather than lazily, for two reasons. It gives the client a
  // cheap "might I be a dev?" hint so a normal visitor never calls
  // /api/dev/session at all; and it makes `analytics: false` the state you are
  // in from the first request of the session, rather than from whenever the
  // panel is first opened. Spec §8: testing must not inflate the numbers, and a
  // default that only applies after you visit a settings page is not a default.
  response.cookies.set(
    DEV_FLAGS_COOKIE,
    JSON.stringify(DEFAULT_DEV_FLAGS),
    devFlagsCookieOptions(exp)
  );

  return response;
}

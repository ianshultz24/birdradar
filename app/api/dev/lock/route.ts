import { NextResponse } from 'next/server';
import { DEV_ROUTE_HEADERS } from '@/lib/dev/http';
import { DEV_COOKIE, DEV_FLAGS_COOKIE } from '@/lib/dev/auth';

export const runtime = 'nodejs';

/**
 * End the developer session.
 *
 * Unauthenticated on purpose: the only thing it can do is delete two of the
 * caller's own cookies. Requiring a valid session to log out would mean an
 * expired-but-present cookie could not be cleared from the panel.
 *
 * **This is not revocation.** It clears the cookie in *this* browser; the token
 * itself stays valid until its `exp`, so a copy taken from another machine still
 * works. There is no server-side session list to invalidate against — the whole
 * design is a stateless HMAC, which is what makes `readDevSession()` callable
 * from `proxy.ts` without a Redis round trip on every request.
 *
 * The kill switch for a leaked cookie is therefore rotating `DEV_MODE_SECRET`,
 * which invalidates every outstanding token at once — and on Vercel that needs a
 * redeploy, not just an env-var edit. `lib/dev/auth.test.ts` has a test named for
 * this path so the property is not merely asserted in a comment.
 */
export async function POST(): Promise<Response> {
  const response = NextResponse.json({ ok: true }, { headers: DEV_ROUTE_HEADERS });

  // Deleting both matters. Leaving `br_dev_flags` behind would keep the client
  // calling /api/dev/session on every load for a session that no longer exists.
  response.cookies.delete(DEV_COOKIE);
  response.cookies.delete(DEV_FLAGS_COOKIE);

  return response;
}

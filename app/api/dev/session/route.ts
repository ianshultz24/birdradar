import { type NextRequest } from 'next/server';
import { devJson } from '@/lib/dev/http';
import { readDevFlags } from '@/lib/dev/auth';

export const runtime = 'nodejs';

/**
 * The authority on "is this client a developer, and what are its flags?"
 *
 * ─── The trust model this endpoint exists to enforce ─────────────────────────
 *
 * `br_dev` is httpOnly, so a client component cannot see it. `br_dev_flags` is
 * readable, so a client component can — but spec §5 is explicit that the server
 * must **ignore `br_dev_flags` entirely unless `br_dev` verifies**, otherwise
 * anyone can set it.
 *
 * Those two facts together mean the client cannot answer the question itself,
 * and must not try. So:
 *
 *   client sees br_dev_flags?  no  → does nothing, never calls this route
 *                              yes → asks here, and believes only the answer
 *
 * `br_dev_flags` is a *hint that it is worth asking*, never a source of truth.
 * Forging it buys exactly one `{ dev: false }` response.
 *
 * `readDevFlags()` returns `null` unless the session verifies, which is the
 * enforcement: there is no exported path to the flags that skips the check.
 *
 * ─── 200, not 401 ────────────────────────────────────────────────────────────
 *
 * "You are not a developer" is the expected, overwhelmingly common answer, not
 * an error. Returning 401 would fill an ordinary user's console with a failed
 * request on every page load — and a console that cries wolf is one nobody reads
 * when something real happens. `PhaseE1_bugfix_ebird404.md` is a whole document
 * about the cost of noise in that channel.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const flags = readDevFlags(request.cookies);

  if (!flags) return devJson({ dev: false });

  return devJson({ dev: true, flags });
}

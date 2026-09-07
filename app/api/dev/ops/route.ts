import { type NextRequest } from 'next/server';
import { devJson, readJsonBody } from '@/lib/dev/http';
import { readDevSession } from '@/lib/dev/auth';
import {
  isOpsState,
  isForceDownActive,
  isOpsStoreConfigured,
  writeOpsMode,
  readOpsLog,
} from '@/lib/ops/state';

export const runtime = 'nodejs';

/**
 * Set the site's operational state.
 *
 * ─── A route handler, not a Server Function ──────────────────────────────────
 *
 * The panel is a server component and a Server Action would be the idiomatic
 * way to do this. It is deliberately not used. Next's own proxy documentation
 * warns that Server Functions "are handled as POST requests to the route where
 * they are used, so a Proxy matcher that excludes a path will also skip Proxy
 * coverage… A matcher change or a refactor that moves a Server Function to a
 * different route can silently remove Proxy coverage." For the one endpoint in
 * this app that can take the whole site down, the auth check should be a line
 * you can grep for, in a file whose URL is fixed.
 *
 * ─── The auto-lift window is computed here, not sent ─────────────────────────
 *
 * The client sends `autoLiftMinutes` (30 / 120 / 360 / null); the server turns
 * it into an absolute `until`. Accepting an absolute timestamp from a browser
 * would import that browser's clock skew into the one value that decides when
 * the site comes back up. The allowed set is closed, so a hand-crafted request
 * cannot schedule a lift six months out.
 */

/** 30m / 2h / 6h / none, as specced. A closed set, validated server-side. */
const ALLOWED_AUTO_LIFT_MINUTES = [30, 120, 360] as const;

export async function POST(request: NextRequest): Promise<Response> {
  if (!readDevSession(request.cookies)) {
    return devJson({ error: 'Unauthorized' }, 401);
  }

  const body = await readJsonBody(request);
  if (!body) return devJson({ error: 'Invalid JSON' }, 400);

  const state = body.state;
  if (!isOpsState(state)) {
    return devJson({ error: 'state must be one of: live, degraded, down' }, 400);
  }

  // `null`/absent means "no auto-lift" — the deliberate opt-out. Anything else
  // must be one of the three offered windows.
  let until: number | null = null;
  const raw = body.autoLiftMinutes;
  if (raw !== null && raw !== undefined) {
    const minutes = Number(raw);
    if (!ALLOWED_AUTO_LIFT_MINUTES.includes(minutes as (typeof ALLOWED_AUTO_LIFT_MINUTES)[number])) {
      return devJson(
        { error: `autoLiftMinutes must be null or one of ${ALLOWED_AUTO_LIFT_MINUTES.join(', ')}` },
        400
      );
    }
    until = Date.now() + minutes * 60_000;
  }

  // A `live` state with an auto-lift is meaningless — there is nothing to lift
  // back to. Silently dropping it keeps the stored record honest.
  if (state === 'live') until = null;

  const { ok, mode } = await writeOpsMode({
    state,
    reason: typeof body.reason === 'string' ? body.reason : '',
    until,
  });

  if (!ok) {
    return devJson(
      {
        error: isOpsStoreConfigured()
          ? 'Could not reach the ops store. The state was NOT changed.'
          : 'No Redis configured on this deployment, so there is nowhere to store an ops state. Use OPS_FORCE_DOWN=1 instead.',
        mode,
      },
      503
    );
  }

  return devJson({
    ok: true,
    mode,
    log: await readOpsLog(20),
    // Surfaced so the panel can say why a `live` toggle appears to do nothing:
    // the env-var break-glass outranks anything stored, and only a redeploy
    // clears it.
    forceDownActive: isForceDownActive(),
  });
}

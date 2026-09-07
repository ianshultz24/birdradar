'use client';

import {
  DEV_FLAGS_COOKIE,
  DEFAULT_DEV_FLAGS,
  parseDevFlags,
  type DevFlags,
} from './flags';

/**
 * The browser half of Developer Mode.
 *
 * Deliberately shares no code with `lib/dev/auth.ts` beyond the runtime-free
 * `lib/dev/flags.ts` — that file imports `node:crypto` and must never reach the
 * client bundle.
 *
 * Modelled on the external store already in `lib/drive-time.ts`
 * (`getDriveTimeConfigured` / `subscribeDriveTimeConfigured`, consumed via
 * `useSyncExternalStore` at `components/AlertsPanel.tsx:136`). Same shape, same
 * reasons: the state is fetched imperatively, is shared by several unrelated
 * components, and must not become a prop threaded through `app/page.tsx`.
 *
 * ─── The trust model, from this side ─────────────────────────────────────────
 *
 * `br_dev` is httpOnly, so this file cannot see it and cannot decide whether the
 * user is a developer. `br_dev_flags` is readable — and is treated strictly as a
 * *hint that it is worth asking*. The answer always comes from
 * `/api/dev/session`, which verifies the signed cookie server-side.
 *
 * A visitor with no `br_dev_flags` cookie makes **zero** extra requests: the
 * session resolves synchronously to `'none'` and nothing else here ever runs.
 * That is what keeps this free for the 99.99% of page loads it does not concern.
 */

export type DevSessionState = 'unknown' | 'none' | 'active';

export interface OpsSnapshot {
  state: 'live' | 'degraded' | 'down';
  reason: string;
  until: number | null;
}

/** Latest per-request numbers, read off the eBird responses themselves. */
export interface DebugSnapshot {
  tier: string | null;
  ageMs: number | null;
  budgetRemaining: number | null;
  budgetMax: number | null;
  rateRemaining: number | null;
  rateMax: number | null;
  at: number;
}

export interface DevSnapshot {
  session: DevSessionState;
  /** All-false unless `session === 'active'`. Never trusted from the cookie alone. */
  flags: DevFlags;
  /** `null` until the first `/api/health` answer. */
  ops: OpsSnapshot | null;
  debug: DebugSnapshot | null;
}

const EMPTY: DevSnapshot = {
  session: 'unknown',
  flags: DEFAULT_DEV_FLAGS,
  ops: null,
  debug: null,
};

/**
 * The snapshot is replaced, never mutated, and `getDevSnapshot` returns the
 * same reference until something actually changes. `useSyncExternalStore`
 * compares by identity and will loop forever if handed a fresh object each call.
 */
let snapshot: DevSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit(next: Partial<DevSnapshot>): void {
  const merged = { ...snapshot, ...next };
  if (
    merged.session === snapshot.session &&
    merged.flags === snapshot.flags &&
    merged.ops === snapshot.ops &&
    merged.debug === snapshot.debug
  ) {
    return;
  }
  snapshot = merged;
  for (const listener of listeners) listener();
}

export function getDevSnapshot(): DevSnapshot {
  return snapshot;
}

/** SSR and the hydration pass both see "we have not asked yet". */
export function getDevServerSnapshot(): DevSnapshot {
  return EMPTY;
}

export function subscribeDev(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ─── Cookie access ───────────────────────────────────────────────────────────

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      // The server writes this cookie through NextResponse.cookies.set, which
      // percent-encodes the JSON. Reading raw and decoding keeps both sides on
      // the same encoding.
      return decodeURIComponent(part.slice(eq + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function writeFlagsCookie(flags: DevFlags): void {
  if (typeof document === 'undefined') return;
  const maxAge = 7 * 24 * 60 * 60;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${DEV_FLAGS_COOKIE}=${encodeURIComponent(JSON.stringify(flags))}` +
    `; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/** Is the hint cookie present at all? The cheap gate on everything below. */
function hasFlagsHint(): boolean {
  return readCookie(DEV_FLAGS_COOKIE) !== null;
}

// ─── Session ─────────────────────────────────────────────────────────────────

async function resolveSession(): Promise<void> {
  if (!hasFlagsHint()) {
    emit({ session: 'none', flags: DEFAULT_DEV_FLAGS });
    return;
  }

  try {
    const res = await fetch('/api/dev/session', { cache: 'no-store' });
    if (!res.ok) {
      emit({ session: 'none', flags: DEFAULT_DEV_FLAGS });
      return;
    }
    const body: unknown = await res.json();
    const dev = Boolean((body as { dev?: unknown } | null)?.dev);
    if (!dev) {
      emit({ session: 'none', flags: DEFAULT_DEV_FLAGS });
      return;
    }
    // The server echoes back the flags it validated. Parse anyway — this is the
    // one place both sides agree on the shape, and it costs nothing.
    const flags = parseDevFlags(JSON.stringify((body as { flags?: unknown }).flags ?? {}));
    emit({ session: 'active', flags });
  } catch {
    // Offline, or the request was blocked. Not a developer as far as anything
    // downstream is concerned — the safe direction, since every flag it gates
    // is a debugging affordance.
    emit({ session: 'none', flags: DEFAULT_DEV_FLAGS });
  }
}

/**
 * Update the flags. Writes the cookie and the store together.
 *
 * The cookie is written from the client on purpose. It is non-httpOnly by
 * design, and the server never trusts it — spec §5's whole point is that
 * *anyone* can set it and the server must not care. A dedicated route to write
 * a cookie the server treats as hostile anyway would be ceremony.
 */
export function setDevFlags(next: DevFlags): void {
  writeFlagsCookie(next);
  if (snapshot.session === 'active') emit({ flags: next });
}

// ─── Outbound request decoration ─────────────────────────────────────────────

/**
 * Headers to add to an eBird fetch. Empty for everyone who is not a verified
 * developer with the bypass flag on.
 *
 * Server-side this header is meaningless without a valid `br_dev` cookie, so a
 * forged one achieves nothing — see `proxyEbird`.
 */
export function devFetchHeaders(): Record<string, string> {
  if (snapshot.session !== 'active' || !snapshot.flags.cacheBypass) return {};
  return { 'x-dev-nocache': '1' };
}

/** Pull the debug headers off an eBird response, if this session gets them. */
export function recordDebugHeaders(res: Response): void {
  if (snapshot.session !== 'active' || !snapshot.flags.showDebugBadges) return;

  const num = (name: string): number | null => {
    const raw = res.headers.get(name);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const tier = res.headers.get('x-br-cache');
  if (tier === null) return; // not a dev-decorated response

  emit({
    debug: {
      tier,
      // Absent header means genuinely unknown — a Redis-tier hit, whose age is
      // not recoverable without changing the stored value shape. The overlay
      // renders a dash rather than a fabricated zero.
      ageMs: num('x-br-cache-age'),
      budgetRemaining: num('x-br-budget-remaining'),
      budgetMax: num('x-br-budget-max'),
      rateRemaining: num('x-br-ratelimit-remaining'),
      rateMax: num('x-br-ratelimit-max'),
      at: Date.now(),
    },
  });
}

// ─── Ops state ───────────────────────────────────────────────────────────────

/**
 * A non-dev tab that learns the site went down reloads itself, exactly once.
 *
 * That hands it to `proxy.ts`, which serves the real 503 page. The alternative —
 * rendering a maintenance UI in React — would be a second implementation of
 * `renderMaintenanceHtml()` that drifts from the first, and would be the copy
 * almost nobody sees, so the drift would go unnoticed for a long time.
 *
 * It cannot loop: the 503 response ships no JavaScript, so nothing on that page
 * can reload again. The flag is belt and braces for the case where the state
 * flips back to `live` between the poll and the navigation.
 */
let maintenanceReloadFired = false;

function considerMaintenanceReload(): void {
  if (maintenanceReloadFired) return;
  if (snapshot.ops?.state !== 'down') return;
  // 'unknown' means the session check is still in flight — waiting is correct,
  // because reloading a developer out of their own bypass would be maddening.
  if (snapshot.session !== 'none') return;

  maintenanceReloadFired = true;
  location.reload();
}

function applyOps(next: OpsSnapshot): void {
  const prev = snapshot.ops;
  if (
    prev &&
    prev.state === next.state &&
    prev.reason === next.reason &&
    prev.until === next.until
  ) {
    return;
  }
  emit({ ops: next });
  considerMaintenanceReload();
}

/**
 * Called from the app's central fetch error path when an API request comes back
 * `503 { error: 'maintenance' }`.
 *
 * **This is the primary signal, not the poll.** An active client is already
 * talking to `/api/*` constantly; the proxy already answers those with a 503
 * carrying the reason. Learning it from the traffic that is happening anyway
 * costs nothing and is immediate.
 */
export function noteMaintenanceResponse(reason: string, retryAfter?: number | null): void {
  applyOps({
    state: 'down',
    reason,
    until: retryAfter ? Date.now() + retryAfter * 1000 : null,
  });
}

/**
 * Detect a maintenance 503 on any API response, and record it.
 *
 * Returns `true` when this was a maintenance response, so the caller can bail
 * out instead of treating it as a data error.
 *
 * The `error === 'maintenance'` check is doing real work: `/api/ebird/*` also
 * answers **503** when the deployment-wide upstream budget is exhausted
 * (`{ error: 'Service is busy, please retry shortly' }`, `lib/ebird-proxy.ts`).
 * Those are completely different situations — one is a busy minute, the other is
 * the site being switched off — and treating the first as an outage would put a
 * maintenance banner up every time a few tabs refreshed at once.
 *
 * `clone()` because the caller still needs to read the body on the paths where
 * this returns `false`.
 */
export async function noteIfMaintenance(res: Response): Promise<boolean> {
  if (res.status !== 503) return false;
  try {
    const body = (await res.clone().json()) as {
      error?: unknown;
      reason?: unknown;
      retryAfter?: unknown;
    };
    if (body?.error !== 'maintenance') return false;
    noteMaintenanceResponse(
      typeof body.reason === 'string' ? body.reason : '',
      typeof body.retryAfter === 'number' ? body.retryAfter : null
    );
    return true;
  } catch {
    return false;
  }
}

async function pollHealth(): Promise<void> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as Partial<OpsSnapshot> & { ok?: boolean };
    if (body.state !== 'live' && body.state !== 'degraded' && body.state !== 'down') return;
    applyOps({
      state: body.state,
      reason: typeof body.reason === 'string' ? body.reason : '',
      until: typeof body.until === 'number' ? body.until : null,
    });
  } catch {
    // Offline or blocked. Say nothing — an unreachable health endpoint is not
    // evidence of an outage, and claiming one would be worse than staying quiet.
  }
}

/**
 * Poll cadence.
 *
 * **Five minutes, suspended while the tab is hidden, with one immediate read on
 * becoming visible.** Not thirty seconds, and not while backgrounded.
 *
 * The poll is a *backstop*: it exists for idle tabs and for `degraded`, which
 * blocks nothing and can afford to be late. Anything actively using the app
 * learns about `down` from `noteMaintenanceResponse` within one API call.
 *
 * `proxy.ts` already runs on every non-excluded request, which is a change in
 * the shape of this app's function usage, not just its behaviour. Adding a
 * per-30-second invocation from every idle tab on top of that is how a Hobby
 * plan's 1M monthly invocations turn into a surprise — and the wrong moment to
 * discover it is during a distribution push.
 */
const HEALTH_POLL_MS = 5 * 60 * 1000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  const tick = () => {
    if (document.visibilityState === 'visible') void pollHealth();
  };

  if (timer !== null) clearInterval(timer);
  timer = setInterval(tick, HEALTH_POLL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pollHealth();
  });

  void pollHealth();
}

/** Called once, from the client provider mounted in `app/layout.tsx`. */
export function initDevClient(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  void resolveSession().then(considerMaintenanceReload);
  startPolling();
}

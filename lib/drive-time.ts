/**
 * Drive time to a sighting — banding, formatting, and the client-side batcher in
 * front of /api/drive-time.
 *
 * The route is the thing that protects the ORS quota; this module is what keeps
 * the route from being asked the same question fifty times in a row. Structured
 * like lib/chase.ts's `historyCache` / `fetchHistory` pair: a module-level cache
 * plus in-flight deduplication, so repeated mounts cost nothing.
 *
 * Durations are **seconds** everywhere except at the point of display.
 */

/** Coordinates are [lat, lng] here and everywhere else in the app. The [lng, lat]
 *  order ORS wants is applied once, server-side, in app/api/drive-time/route.ts. */
export type LatLng = [number, number];

export type DriveTimeBand = 'green' | 'yellow' | 'orange' | 'red';

const MIN = 60;

/**
 * Colour band for a duration.
 *
 * Half-open intervals, defined once here so no consumer re-derives them: the
 * brief's "green <15, yellow 15–30, orange 30–60, red >60" leaves exactly 30 and
 * exactly 60 minutes undefined. `< 15` green, `< 30` yellow, `< 60` orange, else
 * red. A 30-minute drive is yellow, not orange.
 */
export function driveTimeBand(seconds: number): DriveTimeBand {
  if (seconds < 15 * MIN) return 'green';
  if (seconds < 30 * MIN) return 'yellow';
  if (seconds < 60 * MIN) return 'orange';
  return 'red';
}

/** "<1 min" / "18 min" / "1h 5m". Floors, like timeAgo() and fmtAgo(). */
export function formatDriveTime(seconds: number): string {
  const mins = Math.floor(seconds / MIN);
  if (mins < 1) return '<1 min';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ─── Batched fetching ────────────────────────────────────────────────────────

/** How long requests accumulate before one POST goes out. Long enough to collect
 *  a scroll burst's worth of IntersectionObserver callbacks, short enough that a
 *  badge never feels deferred. */
const FLUSH_MS = 120;
/** Mirrors the server's fresh TTL, so the client never asks for something the
 *  server would only answer from its own cache. */
const CACHE_TTL_MS = 15 * 60 * 1000;
/** Must not exceed MAX_DESTINATIONS in the route. */
const MAX_PER_REQUEST = 200;

export interface DriveTimeTarget {
  /** Location key from lib/markers.ts — the unit drive time is computed for.
   *  Six species at one park is one destination, not six. */
  locKey: string;
  coords: LatLng;
}

interface CacheEntry {
  at: number;
  /** `null` is a real answer: "no duration available". Cached so a failed lookup
   *  isn't retried on every scroll. */
  seconds: number | null;
}

/**
 * Cache key carries the origin, so a GPS fix that moves invalidates every entry
 * on its own. Rounded to the same 3 dp the server uses — sub-110 m jitter must
 * not thrash the cache, and a key finer than the server's would produce a client
 * miss for a server hit.
 */
function originKey(origin: LatLng): string {
  return `${origin[0].toFixed(3)},${origin[1].toFixed(3)}`;
}

const cache = new Map<string, CacheEntry>();
/** Keys with a request already in the air, so a re-render can't double-request. */
const inFlight = new Map<string, Promise<number | null>>();

// ─── Is routing configured at all? ───────────────────────────────────────────
//
// `/api/drive-time` answers `{ durations: [null, …], configured: false }` when
// `ORS_API_KEY` is unset — deliberately not a 500, because the specified failure
// mode for one unknown drive time is an absent badge.
//
// Nothing read that flag, and the cost was a control that lied. "Reachable only
// — within 30 min" rendered fully enabled, and `app/page.tsx` lets sightings with
// an unknown duration through on purpose ("failing closed on a convenience
// filter is not right"). With no key EVERY duration is unknown, so the filter
// passed 100% of sightings and the toggle did nothing at all — measured, with
// the key absent: 166 lifers before, 166 after, at a 15-minute tolerance.
//
// An absent badge is a reasonable failure mode. A filter that silently declines
// to filter is not, so the UI has to be able to ask.

/** `null` until the first response — "not asked yet", distinct from "no key". */
let configured: boolean | null = null;
const configuredListeners = new Set<() => void>();

function setConfigured(next: boolean): void {
  if (configured === next) return;
  configured = next;
  for (const listener of configuredListeners) listener();
}

/** Whether the server has a routing key. `null` before the first answer. */
export function getDriveTimeConfigured(): boolean | null {
  return configured;
}

/** Subscribe to changes; pairs with `getDriveTimeConfigured` for
 *  `useSyncExternalStore`. Returns an unsubscribe. */
export function subscribeDriveTimeConfigured(listener: () => void): () => void {
  configuredListeners.add(listener);
  return () => {
    configuredListeners.delete(listener);
  };
}

interface Queued {
  target: DriveTimeTarget;
  resolve: (seconds: number | null) => void;
}

let queue: Queued[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let queuedOrigin: LatLng | null = null;

function entryKey(origin: LatLng, locKey: string): string {
  return `${originKey(origin)}|${locKey}`;
}

async function flush(): Promise<void> {
  flushTimer = null;
  const batch = queue;
  const origin = queuedOrigin;
  queue = [];
  queuedOrigin = null;
  if (batch.length === 0 || !origin) return;

  // One POST per chunk. The route chunks again at 50 for ORS; this cap only
  // keeps a single request inside the route's own validation ceiling.
  for (let start = 0; start < batch.length; start += MAX_PER_REQUEST) {
    const slice = batch.slice(start, start + MAX_PER_REQUEST);
    let durations: (number | null)[] = [];

    try {
      const res = await fetch('/api/drive-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin,
          destinations: slice.map((q) => q.target.coords),
        }),
      });
      if (res.ok) {
        const data: unknown = await res.json();
        // The route sends `configured: false` only on the no-key path; every
        // other 200 means the key was there to be used. Absent-and-ok is `true`,
        // which is why this reads the field rather than defaulting it.
        const flag = (data as { configured?: unknown })?.configured;
        setConfigured(flag === false ? false : true);
        const list = (data as { durations?: unknown })?.durations;
        if (Array.isArray(list) && list.length === slice.length) durations = list as (number | null)[];
      }
    } catch {
      // Offline or aborted — every entry in this slice resolves null below.
    }

    for (let i = 0; i < slice.length; i++) {
      const raw = durations[i];
      const seconds = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
      const key = entryKey(origin, slice[i].target.locKey);
      // Only real answers are cached. A null here may be a transient network
      // failure, and the server already negative-caches the durable ones — so
      // caching it a second time on the client would just extend an outage.
      if (seconds !== null) cache.set(key, { at: Date.now(), seconds });
      inFlight.delete(key);
      slice[i].resolve(seconds);
    }
  }
}

/**
 * Drive time from `origin` to one location, in seconds, or `null` when it is
 * unavailable. Never rejects — every failure is a `null`, which the UI renders as
 * no badge.
 *
 * Calls made within the same ~120 ms window are coalesced into a single request,
 * which is what makes a sidebar scroll cost one POST instead of one per card.
 */
export function fetchDriveTime(origin: LatLng, target: DriveTimeTarget): Promise<number | null> {
  const key = entryKey(origin, target.locKey);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.seconds);

  const pending = inFlight.get(key);
  if (pending) return pending;

  // A batch is only ever for one origin — the route takes a single `origin` and
  // measures every destination from it. If the origin changed mid-window, send
  // what is already queued *before* adding to it, rather than silently measuring
  // some of these destinations from the wrong place.
  if (queuedOrigin && originKey(queuedOrigin) !== originKey(origin)) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flush();
  }

  // The executor runs synchronously, so this is queued before the return below.
  const promise = new Promise<number | null>((resolve) => {
    queue.push({ target, resolve });
  });
  inFlight.set(key, promise);
  queuedOrigin = origin;

  if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_MS);
  return promise;
}

/**
 * Drive times for many locations at once — used when the "reachable only" filter
 * turns on and the whole result set has to be known, not just what has been
 * scrolled past. Shares the same cache and coalescing as `fetchDriveTime`.
 */
export function fetchDriveTimes(
  origin: LatLng,
  targets: DriveTimeTarget[]
): Promise<Map<string, number | null>> {
  return Promise.all(
    targets.map((t) => fetchDriveTime(origin, t).then((seconds) => [t.locKey, seconds] as const))
  ).then((pairs) => new Map(pairs));
}

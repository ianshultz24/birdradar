'use client';

/**
 * Wire shape of `/api/geo-estimate`. Declared here rather than imported from the
 * route so a client module never reaches into `app/api/**` — a type-only import
 * is erased, but the dependency edge invites a value import later.
 */
interface GeoEstimate {
  coords: [number, number] | null;
  label: string | null;
  source: string;
}

/**
 * Where the app thinks the user is — the single place that decides.
 *
 * ─── The bug this replaces ───────────────────────────────────────────────────
 *
 * app/page.tsx used to call `getCurrentPosition` on mount while `baseCenter` sat
 * at a hardcoded Bellevue constant, and the search effect fired a three-endpoint
 * eBird fetch against that constant for *every* visitor, in parallel with the
 * permission prompt. Someone in Texas was shown Seattle-area birds labelled
 * "nearby" — the app asserting a location it had never established.
 *
 * ─── The rule ────────────────────────────────────────────────────────────────
 *
 *   precise ON  + granted  → precise GPS fix
 *   precise ON  + prompt   → ask; NO estimate; caller shows a neutral view
 *   precise ON  + denied   → NO estimate; caller shows a neutral view
 *   precise OFF            → no GPS call at all; coarse estimate from the server
 *
 * **`precise ON` never IP-estimates, including on denial.** Falling back on
 * denial would restore the same wrong-location behaviour under a new name, and
 * would do it to the one user who has explicitly said no. Turning "Precise
 * location" off is how a user opts into an estimate; nothing else is.
 */

export type LocationSource = 'gps' | 'ip' | 'none';

export interface ResolvedLocation {
  /** `null` means "not established" — never a default region. */
  coords: [number, number] | null;
  /** Metres, from `pos.coords.accuracy`. Only ever set for a GPS fix. */
  accuracyM: number | null;
  source: LocationSource;
  /** Why there are no coords, for the message the caller shows. */
  reason?: 'prompt' | 'denied' | 'unavailable';
  /** Coarse place name from an IP estimate, when one is available. */
  label?: string | null;
}

const NOT_ESTABLISHED = (reason: ResolvedLocation['reason']): ResolvedLocation =>
  ({ coords: null, accuracyM: null, source: 'none', reason });

/**
 * Current geolocation permission state, or `'prompt'` if it cannot be read.
 *
 * The try/catch is not defensive clutter. Safari has shipped `navigator.
 * permissions` for years while **throwing `TypeError` for the `geolocation`
 * descriptor specifically**, so a bare `await navigator.permissions.query(...)`
 * rejects there and would take the whole resolution path with it. Anything
 * unreadable resolves to `'prompt'` — the branch that asks the user and
 * estimates nothing.
 */
export async function geolocationPermission(): Promise<PermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'prompt';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return 'prompt';
  }
}

/**
 * Fire `cb` whenever the geolocation permission changes — e.g. the user grants
 * it from the URL bar after first refusing the sheet. Returns an unsubscribe.
 * A no-op where the Permissions API can't be queried.
 */
export function watchPermission(cb: (state: PermissionState) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return () => {};
  let status: PermissionStatus | null = null;
  const onChange = () => { if (status) cb(status.state); };
  navigator.permissions
    .query({ name: 'geolocation' as PermissionName })
    .then((s) => {
      status = s;
      s.addEventListener('change', onChange);
    })
    .catch(() => { /* Safari — see geolocationPermission() */ });
  return () => { status?.removeEventListener('change', onChange); };
}

/**
 * A minute-old cached position is fine for a 25–50 km search radius and avoids a
 * slow cold GPS fix on startup. Carried over verbatim from the mount effect this
 * module replaces.
 */
const GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 60_000,
};

function currentPosition(): Promise<ResolvedLocation> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(NOT_ESTABLISHED('unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        coords: [pos.coords.latitude, pos.coords.longitude],
        accuracyM: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
        source: 'gps',
      }),
      (err) => resolve(NOT_ESTABLISHED(
        err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'
      )),
      GPS_OPTIONS,
    );
  });
}

async function ipEstimate(): Promise<ResolvedLocation> {
  try {
    const res = await fetch('/api/geo-estimate', { cache: 'no-store' });
    if (!res.ok) return NOT_ESTABLISHED('unavailable');
    const data: GeoEstimate = await res.json();
    if (!Array.isArray(data.coords)) return NOT_ESTABLISHED('unavailable');
    const [lat, lng] = data.coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NOT_ESTABLISHED('unavailable');
    return {
      coords: [lat, lng],
      // An IP estimate is a city, not a measurement. Reporting a metre figure
      // would draw the accuracy halo in Map.tsx over half a state and call it
      // precision; `null` draws the dot alone.
      accuracyM: null,
      source: 'ip',
      label: data.label ?? null,
    };
  } catch {
    return NOT_ESTABLISHED('unavailable');
  }
}

export async function resolveLocation(precise: boolean): Promise<ResolvedLocation> {
  if (!precise) return ipEstimate();

  const permission = await geolocationPermission();
  // 'granted' and 'prompt' both go to getCurrentPosition — the difference is
  // that 'prompt' surfaces the browser sheet, and until the user answers it the
  // caller is holding a neutral view. 'denied' is short-circuited so we do not
  // ask a question the browser will silently refuse to put to the user.
  if (permission === 'denied') return NOT_ESTABLISHED('denied');
  return currentPosition();
}

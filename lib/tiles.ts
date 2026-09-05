/**
 * Basemap tile source (Stadia Maps).
 *
 * Stadia's keyless allowance is *origin-scoped*: requests whose Referer is
 * localhost, 127.0.0.1 or a private LAN address are served normally, and every
 * other origin gets HTTP 401 with an "invalid auth" watermark PNG. That
 * watermark is a valid image, so Leaflet renders it without complaint — the map
 * looks loaded and is simply wrong.
 *
 * That is exactly how the deployed site broke: the tile URLs had been keyless
 * since the initial commit and nothing ever exercised a public origin, so local
 * dev kept working the whole time. See fixes/phaseB_fixes.md.
 *
 * The key ships in the client bundle. That is how Stadia intends browser usage
 * to work — the real protection is the domain allowlist in the Stadia dashboard,
 * not secrecy. Do not proxy this through an /api route to "hide" it.
 *
 * Written as a complete literal because Next inlines NEXT_PUBLIC_* by textual
 * substitution at build time; destructuring process.env or computing the name
 * silently yields undefined. It is also baked in at *build* time, so changing
 * the value on the host requires a fresh deploy, not just a restart.
 */
const STADIA_API_KEY = process.env.NEXT_PUBLIC_STADIA_API_KEY ?? '';

/**
 * Basemap credits — required by Stadia's and OpenStreetMap's terms. Keep all three.
 *
 * These no longer render in the map's corner: `attributionControl={false}` in
 * components/Map.tsx removes Leaflet's control, and the credits are shown in
 * Settings → Credits instead (components/SettingsPanel.tsx). Both licences require
 * the credit to be **available and discoverable**, not painted over the map at all
 * times, and an in-app credits screen is the standard accommodation for a
 * constrained UI. Deleting it outright is a licensing violation and risks the API
 * key, so this list is not a style choice — do not trim it.
 *
 * This array is the single definition; ATTRIBUTION below is derived from it so the
 * two can't drift.
 */
export const TILE_CREDITS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Stadia Maps', href: 'https://stadiamaps.com/' },
  { label: 'OpenMapTiles', href: 'https://openmaptiles.org/' },
  { label: 'OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
];

/**
 * Routing credits — required by OpenRouteService's terms, and by ODbL for the
 * OpenStreetMap data underneath it. Every matrix response carries
 * `metadata.attribution` = "openrouteservice.org | OpenStreetMap contributors"
 * as a standing reminder that this is a condition of use, not a courtesy.
 *
 * Rendered in Settings → Credits beside the basemap credits, for the same reason
 * and under the same rule as TILE_CREDITS above: the credit must be available and
 * discoverable, not painted over the map. Kept in this file so both licensing
 * obligations sit together and neither can be dropped without noticing the other.
 */
export const ROUTING_CREDITS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'openrouteservice', href: 'https://openrouteservice.org/' },
  { label: 'OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
];

/** Leaflet-control form of the same credits. Still handed to the TileLayer so the
 *  layer declares its own attribution and an attribution control would just work
 *  if one is ever mounted again. */
const ATTRIBUTION = TILE_CREDITS.map(
  c => `&copy; <a href="${c.href}">${c.label}</a>`
).join(' ');

export interface TileSource {
  url: string;
  attribution: string;
}

/**
 * Origins Stadia serves without a key. Anything else needs one.
 * Covers loopback, the three RFC 1918 private ranges, and mDNS `.local` names
 * (phones hitting a dev server over Wi-Fi).
 */
const KEYLESS_HOST =
  /^(?:localhost|127\.0\.0\.1|\[?::1\]?|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|.+\.local)$/;

let warned = false;

/**
 * The failure mode is silent — a watermark tile is still a 200-shaped image to
 * the eye — so say something the one time it matters. Guarded against React's
 * double-render in development.
 */
function warnIfUnauthenticated(): void {
  if (warned || STADIA_API_KEY || typeof window === 'undefined') return;
  if (KEYLESS_HOST.test(window.location.hostname)) return;
  warned = true;
  console.warn(
    `[BirdRadar] No Stadia Maps API key: basemap tiles will return 401 on ${window.location.hostname} ` +
      'and render as "invalid auth" placeholders. Set NEXT_PUBLIC_STADIA_API_KEY and redeploy.'
  );
}

/**
 * Tile URL + attribution for the active theme.
 *
 * Deliberately *not* using the retina (`{r}` / `@2x`) variants: 512 px tiles
 * cost meaningfully more against the free tier's 200k credits/month, and the
 * 256 px tiles are what the `.leaflet-container` background colours in
 * globals.css were sampled from. Revisit both together if that ever changes.
 */
export function getTileLayer(lightMode: boolean): TileSource {
  warnIfUnauthenticated();

  const style = lightMode ? 'alidade_smooth' : 'alidade_smooth_dark';
  // Appended only when set, so a keyless checkout still works on localhost.
  const auth = STADIA_API_KEY ? `?api_key=${encodeURIComponent(STADIA_API_KEY)}` : '';

  return {
    url: `https://tiles.stadiamaps.com/tiles/${style}/{z}/{x}/{y}.png${auth}`,
    attribution: ATTRIBUTION,
  };
}

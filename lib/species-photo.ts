/**
 * Species photography — groundwork only, deliberately inert.
 *
 * The species detail panel reserves a photo slot and asks here for a URL. Today
 * this always returns null, so the slot collapses and nothing ships to users.
 *
 * When it's time to light this up, the intended source is the Wikimedia REST
 * summary endpoint keyed on scientific name
 * (`https://<lang>.wikipedia.org/api/rest_v1/page/summary/<sciName>` →
 * `thumbnail.source`), proxied through an /api route so it goes through the same
 * caching, per-IP rate limiting and upstream budget as lib/ebird-proxy.ts rather
 * than being hit directly from the browser. Macaulay Library has far better bird
 * photography but requires per-asset licensing, so it is not a drop-in.
 *
 * Whatever lands here must stay synchronous or gain its own loading state — the
 * panel treats a null return as "no photo", not "not yet".
 */
export function getSpeciesPhotoUrl(_sciName: string): string | null {
  return null;
}

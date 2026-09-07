/**
 * The site's own origin, for the two metadata files that need an absolute URL.
 *
 * `app/robots.ts` and `app/sitemap.ts` are the only callers. Everything else in
 * this app is same-origin and uses relative paths, which is why this did not
 * exist before.
 *
 * Resolution order, all of it zero-config on Vercel:
 *
 *   1. `NEXT_PUBLIC_SITE_URL` — set this if the app is served from a custom
 *      domain that is not the Vercel production domain. Optional.
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` — the *production* domain, injected by
 *      Vercel. Deliberately preferred over `VERCEL_URL`, which is the
 *      per-deployment URL: a preview build must not publish a sitemap full of
 *      `birdradar-git-<branch>-<user>.vercel.app` links.
 *   3. `VERCEL_URL` — last resort so a preview still emits something coherent.
 *   4. localhost, for `npm run dev` and `npm run build` on this machine.
 *
 * Returns an origin with no trailing slash, so callers can concatenate a path
 * that starts with `/` without producing a double slash.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production.replace(/\/+$/, '')}`;

  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment.replace(/\/+$/, '')}`;

  return 'http://localhost:3000';
}

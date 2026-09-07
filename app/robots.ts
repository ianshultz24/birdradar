import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site-url';

/**
 * `robots.txt`. New in this change — the app shipped without one.
 *
 * Spec §2 requires `/dev` and `/api/dev/*` to be disallowed here as well as
 * `noindex`. Both, not either: `noindex` only takes effect once a crawler has
 * *fetched* the page, and a `Disallow` stops the fetch. They fail in opposite
 * directions, which is why belt and braces is the right answer for an
 * authentication surface.
 *
 * `/maintenance` is listed too. It answers 404 without a dev session, so it is
 * not reachable by a crawler anyway — but a path that renders "the site is down"
 * is the last thing that should ever end up in an index, and defence in depth
 * costs one line.
 *
 * `/api/` is disallowed wholesale. None of it is content, and
 * `/api/ebird/recent?lat=…&lng=…` is an unbounded crawl space against a
 * rate-limited upstream budget.
 *
 * This file is excluded from the `proxy.ts` matcher, so it keeps serving during
 * an outage — a crawler that gets a 503 for `robots.txt` conservatively stops
 * crawling the whole site.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dev', '/api/', '/maintenance'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}

import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site-url';

/**
 * `sitemap.xml`. New in this change — the app shipped without one.
 *
 * Spec §2 requires `/dev` and `/api/dev/*` to be excluded from the sitemap.
 * The honest way to satisfy that is an explicit allowlist rather than a
 * denylist: this app has exactly one indexable route, so the sitemap names it
 * and nothing else. A denylist would need editing every time a route is added,
 * and the failure mode of forgetting is that the new route silently *is*
 * published — which is the wrong direction for a file whose job here is to keep
 * an auth surface out of an index.
 *
 * **If a second public page is ever added, it is added here deliberately.** An
 * empty-looking sitemap is not a bug.
 *
 * Excluded from the `proxy.ts` matcher alongside `robots.txt`, for the same
 * reason: metadata files should keep answering during an outage.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();

  return [
    {
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1,
    },
  ];
}

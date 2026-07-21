import { type NextRequest } from 'next/server';
import {
  activeRegions,
  getStoredForecast,
  isFresh,
  buildRegionForecast,
} from '@/lib/forecast-build';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Nightly forecast refresh. Invoked by the same external scheduler as the alert
 * watcher (QStash schedule / GitHub Actions cron) with the shared bearer
 * secret. Rebuilds each active region whose forecast has gone stale.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: 'Not configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const regions = await activeRegions();
  let rebuilt = 0;
  let skipped = 0;

  for (const region of regions) {
    const stored = await getStoredForecast(region);
    if (isFresh(stored)) {
      skipped++;
      continue;
    }
    try {
      await buildRegionForecast(region);
      rebuilt++;
    } catch {
      // move on; next run retries
    }
  }

  return Response.json(
    { ok: true, regions: regions.length, rebuilt, skipped },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

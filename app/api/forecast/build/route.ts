import { type NextRequest } from 'next/server';
import {
  activeRegions,
  getStoredForecast,
  isFresh,
  buildRegionForecast,
} from '@/lib/forecast-build';
import { readOpsMode } from '@/lib/ops/state';

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

  /**
   * Maintenance behaviour (spec §6) — and the asymmetry with the alert watcher
   * is deliberate, not an oversight.
   *
   * Spec §6 says cron handlers read the ops state and, when `down`, "skip
   * *sending* push alerts but continue ingest and caching". This handler is
   * ingest-only: it rebuilds seasonal arrival curves into
   * `br:forecast:*` and sends nothing to anybody. There is therefore nothing
   * here to skip, and skipping the rebuild would be strictly worse — it would
   * mean coming back from an outage with a staler forecast than going in.
   *
   * The state is read and reported so the behaviour is *visible* rather than
   * merely absent, and so a future reader can see this was considered.
   */
  const opsState = (await readOpsMode()).state;

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
    // `skipped` here counts regions whose forecast was already fresh — it
    // predates this change and has nothing to do with the ops state. `opsState`
    // is reported alongside it precisely so the two are not confused.
    { ok: true, opsState, regions: regions.length, rebuilt, skipped },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

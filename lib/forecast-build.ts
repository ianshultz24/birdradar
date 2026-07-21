import { fetchEbirdCached } from './ebird-proxy';
import { getDb } from './db';
import { redis } from './redis';
import {
  aggregateForecast,
  type HistoricSample,
  type RegionForecast,
} from './forecast';

/**
 * Server-side sampling + persistence for the arrival forecast. Historic
 * observations are immutable, so each dated fetch caches ~forever; only the
 * derived forward-window aggregate is refreshed as the calendar moves.
 */

/** Days ahead sampled; kept small so a build is ~8 upstream calls per region. */
const SAMPLE_OFFSETS = [7, 14, 21, 28];
const YEARS_BACK = 2;
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** Historic data never changes — cache each dated fetch for a year. */
const HISTORIC_SMAXAGE = 365 * 24 * 60 * 60;
const ACTIVE_REGIONS_KEY = 'br:forecast-regions';

interface HistoricRow {
  speciesCode?: string;
  comName?: string;
  sciName?: string;
}

/** Record that a region has live users so the nightly job keeps it warm. */
export async function markRegionActive(regionCode: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.zadd(ACTIVE_REGIONS_KEY, { score: Date.now(), member: regionCode });
  } catch {
    // best-effort
  }
}

/** Regions requested within the last `days` days. */
export async function activeRegions(days = 14): Promise<string[]> {
  if (!redis) return [];
  try {
    const since = Date.now() - days * 86_400_000;
    return (await redis.zrange(ACTIVE_REGIONS_KEY, since, Date.now(), { byScore: true })) as string[];
  } catch {
    return [];
  }
}

export async function getStoredForecast(regionCode: string): Promise<RegionForecast | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = (await db`
      SELECT data, extract(epoch from built_at) * 1000 AS built_ms
      FROM forecast_cache WHERE region_code = ${regionCode}
    `) as { data: RegionForecast; built_ms: number }[];
    if (!rows.length) return null;
    return rows[0].data;
  } catch {
    return null;
  }
}

export function isFresh(forecast: RegionForecast | null): forecast is RegionForecast {
  return !!forecast && Date.now() - forecast.builtAt < FRESH_MS;
}

/**
 * Build (or rebuild) a region's forecast by sampling historic observations for
 * the forward window across prior years, then persist it. Returns the forecast
 * even when the DB is absent (it just won't be cached).
 */
export async function buildRegionForecast(regionCode: string): Promise<RegionForecast> {
  const now = new Date();

  // Build the sample request list, then fetch in parallel — the historic dates
  // are independent, so this is ~one round-trip instead of eight sequential.
  const requests: { offsetDays: number; path: string }[] = [];
  for (const offset of SAMPLE_OFFSETS) {
    for (let y = 1; y <= YEARS_BACK; y++) {
      const d = new Date(now.getTime() + offset * 86_400_000);
      d.setFullYear(d.getFullYear() - y);
      requests.push({
        offsetDays: offset,
        path:
          `/data/obs/${regionCode}/historic/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` +
          `?cat=species&rank=mrec&maxResults=200&fmt=json`,
      });
    }
  }
  // Fetch in small batches: eBird throttles many concurrent requests from one
  // token, and a failed sample would understate every species' frequency.
  const CONCURRENCY = 3;
  const settled: (HistoricSample | null)[] = [];
  for (let i = 0; i < requests.length; i += CONCURRENCY) {
    const batch = requests.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ offsetDays, path }): Promise<HistoricSample | null> => {
        const res = await fetchEbirdCached(path, HISTORIC_SMAXAGE);
        if (!res.ok || !Array.isArray(res.data)) return null;
        const species = (res.data as HistoricRow[])
          .filter((r): r is Required<Pick<HistoricRow, 'speciesCode' | 'comName' | 'sciName'>> =>
            typeof r.speciesCode === 'string' && typeof r.comName === 'string' && typeof r.sciName === 'string')
          .map((r) => ({ speciesCode: r.speciesCode, comName: r.comName, sciName: r.sciName }));
        return { offsetDays, species };
      })
    );
    settled.push(...results);
  }
  const samples = settled.filter((s): s is HistoricSample => s !== null);
  // Denominator is samples we actually got data for, so a dropped fetch doesn't
  // deflate every frequency.
  const sampleCount = samples.length;

  const forecast: RegionForecast = {
    regionCode,
    builtAt: Date.now(),
    windowDays: SAMPLE_OFFSETS,
    entries: aggregateForecast(samples, sampleCount),
  };

  const db = await getDb();
  if (db) {
    try {
      await db`
        INSERT INTO forecast_cache (region_code, data, built_at)
        VALUES (${regionCode}, ${JSON.stringify(forecast)}, now())
        ON CONFLICT (region_code) DO UPDATE SET data = EXCLUDED.data, built_at = now()
      `;
    } catch {
      // non-fatal — return the computed forecast uncached
    }
  }

  return forecast;
}

/** Fresh-if-cached, else build. Used by the read route. */
export async function getOrBuildForecast(regionCode: string): Promise<RegionForecast> {
  const stored = await getStoredForecast(regionCode);
  if (isFresh(stored)) return stored;
  return buildRegionForecast(regionCode);
}

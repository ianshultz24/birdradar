import type { Observation } from './ebird';
import { parseObsDt } from './ebird';

/**
 * Chaseability scoring — turns a species' 30-day observation history inside
 * the search radius into an answer to the question birders actually have:
 * "if I drive out there, will the bird still be there?"
 *
 * All computation is pure; fetchChaseStats adds a small module-level cache in
 * front of /api/ebird/species so repeated opens cost nothing.
 */

export interface ChaseStats {
  /** 0–100 — probability-flavored, not a calibrated probability */
  score: number;
  /** Plain-language phrase describing the recent pattern, e.g. "reported almost daily".
   *  The headline label ("Very Likely" etc.) is derived from `score` via oddsLabel(); this
   *  is the supporting subtitle that gives the concrete reason. */
  descriptor: string;
  tone: 'hot' | 'warm' | 'cold';
  daysWithReports7: number;
  daysWithReports14: number;
  /** Distinct checklists in the last 7 days (independent confirmations) */
  checklists7: number;
  hoursSinceLast: number | null;
  /** Modal 3-hour reporting window, e.g. "7–10am", when enough timed reports exist */
  bestWindow: string | null;
  /** Last 14 days, oldest → newest: was the species reported that day? */
  daySpark: boolean[];
  bestLocation: { locName: string; lat: number; lng: number; reports14: number } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many day-buckets the sparkline shows */
export const SPARK_DAYS = 14;

// `h` may be 24 — the best-window search runs to a 21:00 start and adds 3 — so
// wrap before formatting, or a 9pm–midnight window prints as "9pm–12pm".
function fmtHour(h: number): string {
  const hh = h % 24;
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${hh < 12 ? 'am' : 'pm'}`;
}

/** Local midnight for a date, as epoch ms. */
function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function computeChaseStats(observations: Observation[], now: Date = new Date()): ChaseStats {
  const nowMs = now.getTime();
  const todayStart = startOfLocalDay(now);

  // Everything below buckets by *local calendar day* (0 = today, 1 = yesterday…),
  // not by elapsed 24-hour periods. The two disagree either side of midnight,
  // and this function used to use one for the sparkline and the other for the
  // day counts — which is how the graph ended up contradicting the text next to it.
  const daySet7 = new Set<number>();
  const daySet14 = new Set<number>();
  const checklists7 = new Set<string>();
  const hourCounts = new Array<number>(24).fill(0);
  const byLocation = new Map<string, { locName: string; lat: number; lng: number; reports14: number }>();
  let lastMs = -Infinity;

  for (const obs of observations) {
    const date = parseObsDt(obs.obsDt);
    const t = date.getTime();
    if (isNaN(t)) continue; // malformed row — never let NaN reach a bucket index

    // Math.round, not floor: DST makes some local days 23 or 25 hours long.
    let dayIndex = Math.round((todayStart - startOfLocalDay(date)) / DAY_MS);
    // Tomorrow-dated rows happen (traveller in a later timezone, clock skew).
    // Fold one day of slack into "today"; anything further ahead is bad data.
    if (dayIndex < -1) continue;
    if (dayIndex < 0) dayIndex = 0;

    if (t > lastMs) lastMs = t;

    if (dayIndex < 7) {
      daySet7.add(dayIndex);
      checklists7.add(obs.subId || `${obs.obsDt}|${obs.locId ?? obs.locName}`);
    }
    if (dayIndex < SPARK_DAYS) {
      daySet14.add(dayIndex);

      const locKey = obs.locId || obs.locName;
      const loc = byLocation.get(locKey);
      if (loc) loc.reports14++;
      else byLocation.set(locKey, { locName: obs.locName, lat: obs.lat, lng: obs.lng, reports14: 1 });
    }
    // "YYYY-MM-DD HH:mm" — rows without a time part don't vote on best window
    if (obs.obsDt.length >= 16) {
      const hour = parseInt(obs.obsDt.slice(11, 13), 10);
      if (!isNaN(hour) && hour >= 0 && hour < 24) hourCounts[hour]++;
    }
  }

  const hoursSinceLast = lastMs === -Infinity ? null : (nowMs - lastMs) / 3_600_000;

  // Modal 3-hour window; needs ≥3 timed reports to say anything
  let bestWindow: string | null = null;
  let bestCount = 2;
  for (let start = 0; start <= 21; start++) {
    const count = hourCounts[start] + hourCounts[start + 1] + hourCounts[start + 2];
    if (count > bestCount) {
      bestCount = count;
      bestWindow = `${fmtHour(start)}–${fmtHour(start + 3)}`;
    }
  }

  const daySpark: boolean[] = [];
  for (let age = SPARK_DAYS - 1; age >= 0; age--) daySpark.push(daySet14.has(age));

  let bestLocation: ChaseStats['bestLocation'] = null;
  for (const loc of byLocation.values()) {
    if (!bestLocation || loc.reports14 > bestLocation.reports14) bestLocation = loc;
  }

  // ─── Score ────────────────────────────────────────────────────────────────
  // Persistence dominates: a bird reported on 6 of the last 7 days is the
  // definition of chaseable. Recency decays over ~2 days; independent
  // checklists guard against one observer's stakeout of an inaccessible spot.
  const persistence = daySet7.size / 7;
  const recency = hoursSinceLast === null ? 0 : Math.exp(-hoursSinceLast / 48);
  const independence = Math.min(checklists7.size / 5, 1);
  let score = Math.round(45 * persistence + 30 * recency + 25 * independence);

  // ─── Descriptor ───────────────────────────────────────────────────────────
  // Plain-language reason for the pattern. The headline ("Very Likely" etc.)
  // comes from the score; this phrase says *why* in concrete terms.
  let descriptor: string;
  let tone: 'hot' | 'warm' | 'cold';

  if (hoursSinceLast === null || daySet14.size === 0) {
    descriptor = 'no reports in the last 2 weeks';
    tone = 'cold';
    score = Math.min(score, 10);
  } else if (daySet14.size === 1 && hoursSinceLast <= 24) {
    descriptor = 'first reported today';
    tone = 'hot';
    score = Math.max(score, 55); // fresh discovery: history can't speak yet, recency can
  } else if (hoursSinceLast > 96) {
    descriptor = `last reported ${Math.round(hoursSinceLast / 24)} days ago`;
    tone = 'cold';
  } else if (daySet14.size === 1) {
    descriptor = 'a single day of reports';
    tone = 'cold';
  } else if (daySet7.size >= 5) {
    descriptor = 'reported almost daily';
    tone = 'hot';
  } else if (daySet7.size >= 3) {
    descriptor = 'being seen most days';
    tone = score >= 65 ? 'hot' : 'warm';
  } else {
    descriptor = 'reported occasionally';
    tone = score >= 35 ? 'warm' : 'cold';
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    descriptor,
    tone,
    daysWithReports7: daySet7.size,
    daysWithReports14: daySet14.size,
    checklists7: checklists7.size,
    hoursSinceLast,
    bestWindow,
    daySpark,
    bestLocation,
  };
}

// ─── Fetch + cache ───────────────────────────────────────────────────────────

const CHASE_CACHE_MS = 3 * 60 * 1000; // matches the species route's s-maxage
/** Cached *raw history*, not computed stats — callers seed different observations
 *  into the same fetch, so the network response is shared but the stats are not. */
const historyCache = new Map<string, { at: number; promise: Promise<Observation[]> }>();

/**
 * eBird only returns `obsId` under `detail=full`, and the species-history
 * endpoint doesn't use it — so the checklist id plus species and timestamp is
 * the only key that identifies the same report across both feeds.
 */
function obsKey(o: Observation): string {
  return `${o.subId || o.locId || o.locName}|${o.speciesCode}|${o.obsDt}`;
}

function fetchHistory(speciesCode: string, latR: string, lngR: string, distKm: number): Promise<Observation[]> {
  const key = `${speciesCode}|${latR}|${lngR}|${distKm}`;

  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < CHASE_CACHE_MS) return hit.promise;

  const promise = fetch(
    `/api/ebird/species?speciesCode=${encodeURIComponent(speciesCode)}&lat=${latR}&lng=${lngR}&dist=${distKm}`
  )
    .then((res) => {
      if (!res.ok) throw new Error(`Chase fetch failed: ${res.status}`);
      return res.json();
    })
    .then((data: unknown) => (Array.isArray(data) ? (data as Observation[]) : []));

  promise.catch(() => historyCache.delete(key)); // failed fetches aren't cached
  historyCache.set(key, { at: Date.now(), promise });
  return promise;
}

/**
 * Sighting odds for one species near one point.
 *
 * `seed` is the set of observations the app is already displaying for this
 * species — the very records the card's "seen 8h ago" line is read from. They
 * get merged into the fetched history before scoring, because the history
 * endpoint returns only the latest report per location and (until recently)
 * excluded unreviewed rare-bird reports, so on its own it could omit the exact
 * sighting the card was describing.
 */
export function fetchChaseStats(
  speciesCode: string,
  lat: number,
  lng: number,
  distKm: number,
  seed: Observation[] = []
): Promise<ChaseStats> {
  const latR = lat.toFixed(2);
  const lngR = lng.toFixed(2);

  return fetchHistory(speciesCode, latR, lngR, distKm).then((history) => {
    if (seed.length === 0) return computeChaseStats(history);
    const merged = [...history];
    const have = new Set(history.map(obsKey));
    for (const obs of seed) {
      const k = obsKey(obs);
      if (have.has(k)) continue;
      have.add(k);
      merged.push(obs);
    }
    return computeChaseStats(merged);
  });
}

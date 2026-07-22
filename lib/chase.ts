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

function fmtHour(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? 'am' : 'pm'}`;
}

export function computeChaseStats(observations: Observation[], now: Date = new Date()): ChaseStats {
  const nowMs = now.getTime();

  const dayKeys7 = new Set<string>();
  const dayKeys14 = new Set<string>();
  const checklists7 = new Set<string>();
  const hourCounts = new Array<number>(24).fill(0);
  const byLocation = new Map<string, { locName: string; lat: number; lng: number; reports14: number }>();
  const reportedDayAges = new Set<number>();
  let lastMs = -Infinity;

  for (const obs of observations) {
    const t = parseObsDt(obs.obsDt).getTime();
    if (isNaN(t) || t > nowMs + DAY_MS) continue; // ignore malformed/future rows
    if (t > lastMs) lastMs = t;

    const ageDays = Math.floor((nowMs - t) / DAY_MS);
    const dayKey = obs.obsDt.slice(0, 10);
    if (ageDays < 7) {
      dayKeys7.add(dayKey);
      checklists7.add(obs.subId || `${obs.obsDt}|${obs.locId ?? obs.locName}`);
    }
    if (ageDays < 14) {
      dayKeys14.add(dayKey);
      reportedDayAges.add(ageDays);

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
  for (let age = 13; age >= 0; age--) daySpark.push(reportedDayAges.has(age));

  let bestLocation: ChaseStats['bestLocation'] = null;
  for (const loc of byLocation.values()) {
    if (!bestLocation || loc.reports14 > bestLocation.reports14) bestLocation = loc;
  }

  // ─── Score ────────────────────────────────────────────────────────────────
  // Persistence dominates: a bird reported on 6 of the last 7 days is the
  // definition of chaseable. Recency decays over ~2 days; independent
  // checklists guard against one observer's stakeout of an inaccessible spot.
  const persistence = dayKeys7.size / 7;
  const recency = hoursSinceLast === null ? 0 : Math.exp(-hoursSinceLast / 48);
  const independence = Math.min(checklists7.size / 5, 1);
  let score = Math.round(45 * persistence + 30 * recency + 25 * independence);

  // ─── Descriptor ───────────────────────────────────────────────────────────
  // Plain-language reason for the pattern. The headline ("Very Likely" etc.)
  // comes from the score; this phrase says *why* in concrete terms.
  let descriptor: string;
  let tone: 'hot' | 'warm' | 'cold';

  if (hoursSinceLast === null || dayKeys14.size === 0) {
    descriptor = 'no reports in the last 2 weeks';
    tone = 'cold';
    score = Math.min(score, 10);
  } else if (dayKeys14.size === 1 && hoursSinceLast <= 24) {
    descriptor = 'first reported today';
    tone = 'hot';
    score = Math.max(score, 55); // fresh discovery: history can't speak yet, recency can
  } else if (hoursSinceLast > 96) {
    descriptor = `last reported ${Math.round(hoursSinceLast / 24)} days ago`;
    tone = 'cold';
  } else if (dayKeys14.size === 1) {
    descriptor = 'a single day of reports';
    tone = 'cold';
  } else if (dayKeys7.size >= 5) {
    descriptor = 'reported almost daily';
    tone = 'hot';
  } else if (dayKeys7.size >= 3) {
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
    daysWithReports7: dayKeys7.size,
    daysWithReports14: dayKeys14.size,
    checklists7: checklists7.size,
    hoursSinceLast,
    bestWindow,
    daySpark,
    bestLocation,
  };
}

// ─── Fetch + cache ───────────────────────────────────────────────────────────

const CHASE_CACHE_MS = 3 * 60 * 1000; // matches the species route's s-maxage
const chaseCache = new Map<string, { at: number; promise: Promise<ChaseStats> }>();

export function fetchChaseStats(
  speciesCode: string,
  lat: number,
  lng: number,
  distKm: number
): Promise<ChaseStats> {
  const latR = lat.toFixed(2);
  const lngR = lng.toFixed(2);
  const key = `${speciesCode}|${latR}|${lngR}|${distKm}`;

  const hit = chaseCache.get(key);
  if (hit && Date.now() - hit.at < CHASE_CACHE_MS) return hit.promise;

  const promise = fetch(
    `/api/ebird/species?speciesCode=${encodeURIComponent(speciesCode)}&lat=${latR}&lng=${lngR}&dist=${distKm}`
  )
    .then((res) => {
      if (!res.ok) throw new Error(`Chase fetch failed: ${res.status}`);
      return res.json();
    })
    .then((data: unknown) => computeChaseStats(Array.isArray(data) ? (data as Observation[]) : []));

  promise.catch(() => chaseCache.delete(key)); // failed fetches aren't cached
  chaseCache.set(key, { at: Date.now(), promise });
  return promise;
}

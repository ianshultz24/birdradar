/**
 * Temporal radar — "what's arriving in your region soon".
 *
 * eBird's public API has no barchart/frequency endpoint, so we sample historic
 * observations across the forward calendar window from prior years and derive a
 * presence frequency per species. Pure functions here; the server-side sampling
 * lives in forecast-build.ts.
 */

export interface ForecastEntry {
  speciesCode: string;
  comName: string;
  sciName: string;
  /** Fraction of sampled forward-window days (across prior years) the species appeared */
  frequency: number;
  /** Earliest sampled day-offset from build date it appeared — an arrival estimate */
  etaDays: number;
}

export interface RegionForecast {
  regionCode: string;
  builtAt: number;
  /** Day-offsets from builtAt that were sampled (e.g. [7,14,21,28]) */
  windowDays: number[];
  entries: ForecastEntry[];
}

export interface HistoricSample {
  offsetDays: number;
  species: { speciesCode: string; comName: string; sciName: string }[];
}

/**
 * Aggregate per-date historic species lists into a per-species presence curve.
 * `sampleCount` is the number of (offset × year) fetches attempted so frequency
 * is over all samples, not just those where the species appeared.
 */
export function aggregateForecast(samples: HistoricSample[], sampleCount: number): ForecastEntry[] {
  const acc = new Map<string, { comName: string; sciName: string; present: number; etaDays: number }>();

  for (const sample of samples) {
    const seenInThisSample = new Set<string>();
    for (const sp of sample.species) {
      if (!sp.speciesCode || seenInThisSample.has(sp.speciesCode)) continue;
      seenInThisSample.add(sp.speciesCode);
      const cur = acc.get(sp.speciesCode);
      if (cur) {
        cur.present++;
        cur.etaDays = Math.min(cur.etaDays, sample.offsetDays);
      } else {
        acc.set(sp.speciesCode, {
          comName: sp.comName,
          sciName: sp.sciName,
          present: 1,
          etaDays: sample.offsetDays,
        });
      }
    }
  }

  const denom = Math.max(sampleCount, 1);
  const entries: ForecastEntry[] = [];
  for (const [speciesCode, v] of acc) {
    entries.push({
      speciesCode,
      comName: v.comName,
      sciName: v.sciName,
      frequency: v.present / denom,
      etaDays: v.etaDays,
    });
  }
  return entries.sort((a, b) => b.frequency - a.frequency);
}

export interface ArrivingSpecies extends ForecastEntry {
  /** Not on the viewer's life list — a lifer if they catch it */
  isLifer: boolean;
  /** Estimated calendar arrival date (builtAt + etaDays) as ISO yyyy-mm-dd */
  arrivalDate: string;
}

export interface SelectArrivingOptions {
  /** Minimum historic presence to count as "reliably arriving" */
  minFrequency?: number;
  limit?: number;
}

/**
 * From a region forecast, pick species that are arriving soon but not being
 * seen locally yet — lifers first. `currentSpeciesCodes` are the species in the
 * user's live nearby observations (residents / already-arrived, so excluded).
 */
export function selectArriving(
  forecast: RegionForecast,
  currentSpeciesCodes: Set<string>,
  lifeCodes: Set<string>,
  { minFrequency = 0.4, limit = 12 }: SelectArrivingOptions = {}
): ArrivingSpecies[] {
  const out: ArrivingSpecies[] = [];

  for (const e of forecast.entries) {
    if (e.frequency < minFrequency) continue;
    if (currentSpeciesCodes.has(e.speciesCode)) continue; // already present nearby

    const arrival = new Date(forecast.builtAt + e.etaDays * 86_400_000);
    out.push({
      ...e,
      isLifer: !lifeCodes.has(e.speciesCode),
      arrivalDate: arrival.toISOString().slice(0, 10),
    });
  }

  // Lifers first, then soonest arrival, then most reliable
  out.sort((a, b) => {
    if (a.isLifer !== b.isLifer) return a.isLifer ? -1 : 1;
    if (a.etaDays !== b.etaDays) return a.etaDays - b.etaDays;
    return b.frequency - a.frequency;
  });

  return out.slice(0, limit);
}

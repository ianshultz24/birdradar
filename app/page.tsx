'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';

import Sidebar from '@/components/Sidebar';
import StatusBar from '@/components/StatusBar';
import SpeciesDetailPanel from '@/components/SpeciesDetailPanel';
import HotspotPanel from '@/components/HotspotPanel';
import NotificationToast, { type ToastItem } from '@/components/NotificationToast';
import OnboardingModal from '@/components/OnboardingModal';
import DonationBanner from '@/components/DonationBanner';
import { XIcon } from '@/components/Icons';
import { getTheme } from '@/lib/theme';
import { hasSeenOnboarding, markOnboardingSeen } from '@/lib/onboarding';
import { resolveLocation, watchPermission, type ResolvedLocation } from '@/lib/geolocation';
import {
  startSession,
  getSnoozedUntil,
  snoozeDonation,
  shouldShowDonationPrompt,
  DISMISS_SNOOZE_DAYS,
  DONATED_SNOOZE_DAYS,
  DONATION_EVENTS,
} from '@/lib/donation';
import { track } from '@/lib/analytics';

import { useMobile } from '@/hooks/useMobile';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { mergeObservations, DEFAULT_SETTINGS, fmtDist } from '@/lib/ebird';
import type { Observation, Hotspot, ClassifiedObservation, AppSettings, TargetSpecies } from '@/lib/ebird';
import { buildMarkerGroups, locKeyOf, type MarkerGroup } from '@/lib/markers';
import { classifyAll } from '@/lib/classify';
import { fetchDriveTimes } from '@/lib/drive-time';
import { migrateStaleCodesOnce } from '@/lib/taxonomy';
import { haversineKm } from '@/lib/geo';
import { syncLifeList } from '@/lib/push-client';
import { pushSync, type SyncPayload } from '@/lib/sync-client';
import { selectArriving, type RegionForecast, type ArrivingSpecies } from '@/lib/forecast';
import { sendBrowserNotification, playAlertBeep } from '@/lib/notifications';
import {
  getLifeList,
  getYearList,
  saveSettings,
  getSettings,
  saveLifeList,
  addToLifeList,
  removeFromLifeList,
  addToYearList,
  removeFromYearList,
  bulkAddToYearList,
  clearLifeList,
  clearYearList,
  getLifeListMeta,
  saveLifeListMeta,
  type SpeciesMeta,
} from '@/lib/lifelist';

/**
 * Stand-in for `searchCenter` before any location has been established.
 *
 * **Nothing may read it.** `locationResolved` is false for its entire lifetime,
 * and every consumer — the eBird fetch, the radius circle, the markers, the push
 * subscription — is gated on that flag. What the map *shows* while pending is
 * `NEUTRAL_VIEW` in components/Map.tsx, which is a display constant, not this.
 *
 * It used to be `[47.65, -122.17]` (Bellevue WA) and it was the bug: the search
 * effect fetched against it on mount for every visitor on earth. A default
 * *region* is the worst possible placeholder, because a read that slips past the
 * gate then fails **plausibly** — a Texan sees Washington birds and it looks like
 * the fix regressed rather than like a new leak.
 *
 * [0, 0] is in the Gulf of Guinea. eBird returns nothing there and every
 * distance computed from it is absurd, so any future code that reads this
 * against the invariant announces itself immediately. Swapping it back to a
 * populated coordinate is not a cleanup — it is re-arming the original defect.
 */
const PENDING_CENTER: [number, number] = [0, 0];
const RATE_LIMIT_MS = 5 * 60 * 1000;
/** Minimum gap between forced refreshes of the same location+radius (spam-click guard) */
const MIN_FORCE_INTERVAL_MS = 15 * 1000;
const LIFER_ALERT_RADIUS_KM = 16.09; // 10 miles

// Dynamic import of map (no SSR — Leaflet requires browser DOM)
const BirdMap = dynamic(() => import('@/components/Map'), {
  ssr: false,
  // Background comes from a class, not an inline style, so it can follow the
  // .dark theme without risking a hydration mismatch on the style attribute.
  loading: () => (
    <div
      className="map-loading"
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9CA3AF',
        fontFamily: "var(--font-jb-mono, 'IBM Plex Mono', monospace)",
        fontSize: 12,
        letterSpacing: '0.06em',
      }}
    >
      Loading map…
    </div>
  ),
});

export default function Home() {
  // Where we search when no pin is dropped: the GPS fix, an IP estimate, or a
  // deep link's coords. There is no "default region" any more — see
  // PENDING_CENTER. `searchCenter` below is what everything actually reads.
  const [baseCenter, setBaseCenter] = useState<[number, number]>(PENDING_CENTER);
  /** True once `baseCenter` holds a real centre — GPS fix, IP estimate or deep
   *  link. A dropped pin counts too, but via `locationResolved` below rather
   *  than here: clearing the pin has to be able to take that back. */
  const [baseResolved, setBaseResolved] = useState(false);
  /** Why there is no location yet, for the notice under the map. */
  const [locationReason, setLocationReason] = useState<ResolvedLocation['reason'] | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  /** GPS accuracy in metres. Its own scalar rather than a third tuple slot, so
   *  `userLocation`'s identity contract (read by InitialLocationController and
   *  reCenterTarget in Map.tsx) is untouched. */
  const [userAccuracyM, setUserAccuracyM] = useState<number | null>(null);
  const [pinLocation, setPinLocation] = useState<[number, number] | null>(null);
  const [lifeList, setLifeList] = useState<string[]>([]);
  const [yearList, setYearList] = useState<string[]>([]);
  const [lifeListMeta, setLifeListMeta] = useState<Record<string, SpeciesMeta>>({});
  const [observations, setObservations] = useState<ClassifiedObservation[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [targetSpecies, setTargetSpecies] = useState<TargetSpecies[]>([]);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [regionForecast, setRegionForecast] = useState<RegionForecast | null>(null);
  const [hotspotPanel, setHotspotPanel] = useState<Hotspot | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [flyToTarget, setFlyToTarget] = useState<[number, number] | null>(null);
  const [activeTab, setActiveTab] = useState<'alerts' | 'lifelist' | 'settings'>('alerts');
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<'ok' | 'error' | 'loading'>('loading');
  const [lastFetch, setLastFetch] = useState(0);
  const [focusedSpecies, setFocusedSpecies] = useState<{ code: string; name: string } | null>(null);
  /** Location key of the sighting whose detail panel is open. */
  const [selectedLocKey, setSelectedLocKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [locationNotice, setLocationNotice] = useState(false);
  /** First-visit intro. Initialised `false` and set in the mount effect, never
   *  from a `useState` initializer — see the note in lib/onboarding.ts. */
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  /** Eastside Audubon donation banner. Same rule as the intro above: the flags
   *  behind it are read in the mount effect, never in an initializer. */
  const [donationOpen, setDonationOpen] = useState(false);
  /** Distinct engagement actions this session — see `viewActions` in
   *  lib/donation.ts for why this is not a count of distinct birds. */
  const [viewActions, setViewActions] = useState(0);
  /** Road-network drive time from `userLocation` to each location key, in seconds.
   *  Only populated while the "reachable only" filter is on — see the effect
   *  below. `null` means "asked, no answer", which never hides a sighting. */
  const [driveTimes, setDriveTimes] = useState<Map<string, number | null>>(new Map());
  const isMobile = useMobile();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [drawerOpen, setDrawerOpen] = useState(false);

  /** Low battery mode — user setting, or forced on by the OS reduced-motion preference */
  const lowFi = settings.lowBatteryMode || prefersReducedMotion;

  // ─── Search area: one derived value, read by the circle, the markers and the
  // fetches alike. Splitting this across `center` and `pinLocation` is what let
  // clearing a pin move the circle while the sightings stayed at the old point.
  const searchCenter = useMemo<[number, number]>(
    () => pinLocation ?? baseCenter,
    [pinLocation, baseCenter]
  );
  /**
   * Whether `searchCenter` means anything. Derived, not stored, so the two can
   * never disagree: dropping a pin with no GPS fix resolves the app, and
   * *clearing* that pin takes it straight back to the neutral view instead of
   * leaving `locationResolved` true over PENDING_CENTER — which would fetch the
   * Gulf of Guinea. Storing a flag alongside the value is how those drift.
   */
  const locationResolved = baseResolved || pinLocation !== null;
  // A dropped pin always searches the eBird maximum; otherwise the user's setting.
  const searchRadiusKm = pinLocation ? 50 : Math.min(settings.searchRadius, 50);
  // Coordinates are rounded to 2 decimals (~1.1 km) so nearby users produce
  // identical request URLs and share the CDN cache entry.
  const searchKey = `${searchCenter[0].toFixed(2)},${searchCenter[1].toFixed(2)},${searchRadiusKm}`;

  const lastFetchRef = useRef(0);
  const settingsRef = useRef(settings);
  const searchCenterRef = useRef(searchCenter);
  const searchRadiusRef = useRef(searchRadiusKm);
  const lifeListRef = useRef(lifeList);
  const yearListRef = useRef(yearList);
  const lifeListMetaRef = useRef(lifeListMeta);
  const notifiedRef = useRef<Set<string>>(new Set());
  const toastIdRef = useRef(0);
  /** Tracks whether this is the first successful fetch (used to silence initial notification flood) */
  const isFirstFetchRef = useRef(true);
  /** Incremented each time fetchData starts; lets in-flight fetches detect they've been superseded */
  const fetchGenerationRef = useRef(0);
  /** Params key of the fetch currently in flight (null when idle) */
  const inFlightKeyRef = useRef<string | null>(null);
  /** Params key of the last successfully completed fetch */
  const lastFetchKeyRef = useRef('');
  /** Abort controller for the in-flight fetch — superseded fetches are cancelled, not just ignored */
  const abortRef = useRef<AbortController | null>(null);
  /** Regional species lists change ~never — cache per region for the session */
  const sppListCacheRef = useRef<Map<string, string[]>>(new Map());
  /** Arrival forecast per region — cache for the session */
  const forecastCacheRef = useRef<Map<string, RegionForecast>>(new Map());

  // Keep refs in sync
  settingsRef.current = settings;
  searchCenterRef.current = searchCenter;
  searchRadiusRef.current = searchRadiusKm;
  lifeListRef.current = lifeList;
  yearListRef.current = yearList;
  lifeListMetaRef.current = lifeListMeta;

  // ─── Mount: stored state, deep link, and whether to ask for location yet ───
  //
  // Two things share this effect because their *order* is the point. On a first
  // visit the intro modal opens and the location flow is deferred until it is
  // dismissed (see `pendingLocationRef`). A browser permission sheet stacked
  // behind an unread modal is how permissions get denied by reflex, and a denied
  // geolocation permission cannot be re-requested from the page.
  const pendingLocationRef = useRef(false);
  /** True after the first successful resolution. `InitialLocationController`
   *  owns the neutral → located jump; every *later* resolution has to move the
   *  map itself, or toggling "Precise location" refetches around a new centre
   *  and leaves the viewport over the old one. */
  const resolvedOnceRef = useRef(false);
  /** Read inside the dependency-free `startLocation` below. */
  const pinLocationRef = useRef<[number, number] | null>(null);
  pinLocationRef.current = pinLocation;

  // ─── Donation prompt ──────────────────────────────────────────────────────
  /** Session ordinal for this visit, written by `startSession()` on mount. 0
   *  until then, which is below MIN_SESSION_FOR_PROMPT — so the banner cannot
   *  appear in the window between mount and that effect running. */
  const sessionCountRef = useRef(0);
  /** The keys behind `viewActions`. A ref because only the *size* drives a
   *  render, and re-creating a Set on every marker tap would too. */
  const viewActionsRef = useRef<Set<string>>(new Set());
  /** True once the banner has been shown and answered this session. Stops the
   *  opening effect re-firing on the next `viewActions` bump, which would
   *  otherwise re-show a banner the user just dismissed. */
  const donationSettledRef = useRef(false);

  /**
   * Count one deliberate act of looking at something.
   *
   * Two call sites in two namespaces — see the `viewActions` doc in
   * lib/donation.ts for why they are not, and cannot be, deduped against each
   * other.
   */
  const noteViewAction = useCallback((key: string) => {
    const seen = viewActionsRef.current;
    if (seen.has(key)) return;
    seen.add(key);
    setViewActions(seen.size);
  }, []);

  /**
   * Resolve a location and commit it, or record why there isn't one.
   *
   * The ONLY writer of `locationResolved`, `userLocation` and `userAccuracyM`
   * outside the deep-link branch. lib/geolocation.ts owns the policy — precise
   * vs estimate, and the rule that a precise-mode denial never falls back to an
   * estimate — so this function only has to commit the answer.
   */
  const startLocation = useCallback(async (precise: boolean) => {
    const result = await resolveLocation(precise);

    // Every call re-establishes the location from scratch, discarding whatever
    // the last one produced. Merging instead is how turning "Precise location"
    // OFF left the previous GPS fix on screen — the blue dot, the accuracy halo
    // and a search centred on the exact position the user had just asked the app
    // to stop using. An IP estimate is a coarse area and never sets these two.
    setUserLocation(null);
    setUserAccuracyM(null);

    if (!result.coords) {
      // Nothing established: fall back to the neutral view rather than keeping a
      // stale answer. A dropped pin survives this — `locationResolved` derives
      // from the pin as well, so the user's own choice is not thrown away.
      setBaseResolved(false);
      setBaseCenter(PENDING_CENTER);
      setLocationReason(result.reason ?? 'unavailable');
      // 'prompt' means the browser sheet is still open — saying "location
      // unavailable" while the user is looking at the permission dialog is both
      // wrong and a nudge toward Block.
      setLocationNotice(result.reason !== 'prompt');
      return;
    }

    setLocationReason(null);
    setLocationNotice(false);
    setBaseCenter(result.coords);
    setBaseResolved(true);
    if (result.source === 'gps') {
      setUserLocation(result.coords);
      setUserAccuracyM(result.accuracyM);
    }

    // A *re-*resolution has to carry the map with it. Not the first one: that is
    // InitialLocationController's instant `setView` out of the neutral view, and
    // a competing flyTo would animate against it. And not while a pin is
    // dropped — the pin is where the user chose to search, and the base centre
    // moving underneath it must not yank the viewport off their choice.
    if (resolvedOnceRef.current && !pinLocationRef.current) {
      setFlyToTarget(result.coords);
    }
    resolvedOnceRef.current = true;
  }, []);

  useEffect(() => {
    setLifeList(getLifeList());
    setYearList(getYearList());
    setLifeListMeta(getLifeListMeta());
    const stored = getSettings();
    setSettings(stored);

    // Before the deep-link branch below, which returns early: a visit that
    // arrived from a push notification is still a visit, and counting it there
    // would silently exclude exactly the users who engage most. Idempotent under
    // StrictMode's double-invoked mount effect via SESSION_GAP_MS — see
    // lib/donation.ts.
    sessionCountRef.current = startSession();

    // Deep link from a push notification: /?lat=..&lng=..&sp=.. — jump straight
    // to the sighting and skip the GPS fix that would otherwise override it.
    const params = new URLSearchParams(window.location.search);
    const dlLat = parseFloat(params.get('lat') ?? '');
    const dlLng = parseFloat(params.get('lng') ?? '');
    const hasDeepLink =
      !isNaN(dlLat) && !isNaN(dlLng) && dlLat >= -90 && dlLat <= 90 && dlLng >= -180 && dlLng <= 180;
    if (hasDeepLink) {
      setBaseCenter([dlLat, dlLng]);
      setBaseResolved(true);
      setFlyToTarget([dlLat, dlLng]);
      const sp = params.get('sp');
      if (sp && /^[a-zA-Z0-9]+$/.test(sp)) setFocusedSpecies({ code: sp, name: sp });
      // Drop the query so a reload doesn't re-trigger the jump
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    if (hasSeenOnboarding()) {
      startLocation(stored.preciseLocation);
    } else {
      pendingLocationRef.current = true;
      setOnboardingOpen(true);
    }
    // startLocation is stable (useCallback with no deps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Granting permission from the URL bar after refusing the sheet upgrades the
  // position without a reload. No-op where the Permissions API can't be queried.
  useEffect(() => {
    if (!settings.preciseLocation) return;
    return watchPermission((state) => {
      if (state === 'granted') startLocation(true);
      else if (state === 'denied') { setLocationReason('denied'); setLocationNotice(true); }
    });
  }, [settings.preciseLocation, startLocation]);

  /**
   * Whether to ask for a donation, re-evaluated as engagement accumulates.
   *
   * Ordering note: this effect is declared *after* the mount effect above, so
   * `sessionCountRef` is already written the first time it runs. It is not
   * declared with `sessionCount` as a dependency because a ref cannot be one —
   * the effect is instead re-run by the things that actually change while the
   * page is open, and the session ordinal is fixed for the whole visit.
   *
   * The four suppressions are not defensive clutter:
   *
   *   - `onboardingOpen` — the whole point of "never during the first session" is
   *     not stacking on the intro. It re-opens from the map's `?` button in ANY
   *     session, so this cannot be inferred from the session count alone.
   *   - `locationNotice` — that notice owns the bottom-centre slot on desktop,
   *     and asking for money while telling the user the app cannot find them is
   *     the worst available moment.
   *   - `!locationResolved` — nothing has been fetched, so the user has been
   *     shown nothing to be grateful for.
   *   - `donationSettledRef` — one ask per session, answered or not.
   */
  useEffect(() => {
    if (donationSettledRef.current || donationOpen) return;
    if (onboardingOpen || locationNotice || !locationResolved) return;
    if (
      !shouldShowDonationPrompt({
        sessionCount: sessionCountRef.current,
        viewActions,
        snoozedUntilMs: getSnoozedUntil(),
        now: Date.now(),
      })
    ) {
      return;
    }
    setDonationOpen(true);
    track(DONATION_EVENTS.shown, {
      session_count: sessionCountRef.current,
      view_actions: viewActions,
    });
  }, [viewActions, locationResolved, onboardingOpen, locationNotice, donationOpen]);

  // Keep the push-alert subscription's life-list snapshot current while the app
  // is open. No-ops unless the user has enabled background alerts.
  useEffect(() => {
    syncLifeList(lifeList, settings.useMetric).catch(() => { /* offline / not subscribed */ });
  }, [lifeList, settings.useMetric]);

  // Push list changes to the linked sync code (no-op unless this device is
  // linked). Skips the initial empty state before localStorage hydrates.
  const syncHydratedRef = useRef(false);
  useEffect(() => {
    if (!syncHydratedRef.current) {
      syncHydratedRef.current = true;
      return;
    }
    pushSync({ lifeList, yearList, meta: lifeListMeta }).catch(() => { /* offline / not linked */ });
  }, [lifeList, yearList, lifeListMeta]);

  // Fetch the arrival forecast for the current region (session-cached). The
  // first request for a cold region builds it server-side; failures are silent
  // (the "Arriving Soon" section just stays empty).
  useEffect(() => {
    if (!activeRegion) {
      setRegionForecast(null);
      return;
    }
    const cached = forecastCacheRef.current.get(activeRegion);
    if (cached) {
      setRegionForecast(cached);
      return;
    }
    let cancelled = false;
    fetch(`/api/forecast?regionCode=${encodeURIComponent(activeRegion)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: RegionForecast | null) => {
        if (cancelled || !data || !Array.isArray(data.entries)) return;
        forecastCacheRef.current.set(activeRegion, data);
        setRegionForecast(data);
      })
      .catch(() => { /* silent — forecast is a bonus, not core */ });
    return () => { cancelled = true; };
  }, [activeRegion]);

  const fetchData = useCallback(async (force = false) => {
    const now = Date.now();

    // Everything about *where* comes from searchCenter — there is no second
    // opinion to fall out of sync with.
    const [rawLat, rawLng] = searchCenterRef.current;
    const lat = rawLat.toFixed(2);
    const lng = rawLng.toFixed(2);
    const distKm = searchRadiusRef.current;
    const paramsKey = `${lat},${lng},${distKm}`;

    // An identical fetch is already running — let it finish
    if (inFlightKeyRef.current === paramsKey) return;

    // Throttle repeat fetches of the same params: forced refreshes get a short
    // spam-click guard, non-forced ones obey the long auto window.
    if (lastFetchRef.current > 0 && paramsKey === lastFetchKeyRef.current) {
      const elapsed = now - lastFetchRef.current;
      if (elapsed < (force ? MIN_FORCE_INTERVAL_MS : RATE_LIMIT_MS)) return;
    }

    // Tag this fetch; if a newer one starts before this completes, discard stale results.
    // Also abort any in-flight fetch for different params — don't just ignore it.
    const gen = ++fetchGenerationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightKeyRef.current = paramsKey;

    setLoading(true);
    setApiStatus('loading');

    try {
      const [recentRes, notableRes, hotspotsRes] = await Promise.all([
        fetch(`/api/ebird/recent?lat=${lat}&lng=${lng}&dist=${distKm}`, { signal: controller.signal }),
        fetch(`/api/ebird/notable?lat=${lat}&lng=${lng}&dist=${distKm}`, { signal: controller.signal }),
        fetch(`/api/ebird/hotspots?lat=${lat}&lng=${lng}&dist=${distKm}`, { signal: controller.signal }),
      ]);

      // A newer fetchData started while this was in-flight — discard silently
      if (gen !== fetchGenerationRef.current) return;

      if (!recentRes.ok || !notableRes.ok) {
        throw new Error('eBird API error');
      }

      const recent: Observation[] = await recentRes.json();
      const notable: Observation[] = await notableRes.json();
      const hotspotsData: Hotspot[] = hotspotsRes.ok ? await hotspotsRes.json() : [];

      const recentArr = Array.isArray(recent) ? recent : [];
      const notableArr = Array.isArray(notable) ? notable : [];

      // ─── Frequency map (before deduplication) ──────────────────────────────
      const freqMap = new Map<string, number>();
      for (const obs of recentArr) {
        const key = `${obs.speciesCode}|${obs.locId}`;
        freqMap.set(key, (freqMap.get(key) ?? 0) + 1);
      }

      const merged = mergeObservations(recentArr, notableArr);

      // Classify using life list or year list depending on mode
      const activeList = settingsRef.current.yearListActive
        ? yearListRef.current
        : lifeListRef.current;
      const classified = classifyAll(merged, activeList);

      // Attach report counts to each classified observation
      const withFreq: ClassifiedObservation[] = classified.map((obs) => ({
        ...obs,
        reportCount: freqMap.get(`${obs.speciesCode}|${obs.locId}`) ?? 1,
      }));

      setObservations(withFreq);
      setHotspots(Array.isArray(hotspotsData) ? hotspotsData : []);

      // ─── Target Species ────────────────────────────────────────────────────
      // Region comes from the nearby hotspots; if none is available we can't
      // know the user's region, so show no targets rather than a wrong region's.
      const regionCode = (Array.isArray(hotspotsData) && hotspotsData[0]?.subnational1Code)
        ? hotspotsData[0].subnational1Code
        : null;

      // Drives the "Arriving Soon" temporal forecast (fetched in its own effect)
      setActiveRegion(regionCode);

      if (!regionCode) {
        setTargetSpecies([]);
      } else {
        let sppCodes = sppListCacheRef.current.get(regionCode);
        if (!sppCodes) {
          const sppRes = await fetch(
            `/api/ebird/spplist?regionCode=${encodeURIComponent(regionCode)}`,
            { signal: controller.signal }
          );
          if (sppRes.ok) {
            const data: unknown = await sppRes.json();
            if (Array.isArray(data)) {
              sppCodes = data as string[];
              sppListCacheRef.current.set(regionCode, sppCodes);
            }
          }
        }
        if (sppCodes) {
          const lifeSet = new Set(lifeListRef.current);
          const nearbyFreq = new Map<string, number>();
          for (const obs of merged) {
            nearbyFreq.set(obs.speciesCode, (nearbyFreq.get(obs.speciesCode) ?? 0) + 1);
          }
          const obsByCode = new Map<string, Observation>();
          for (const obs of merged) {
            if (!obsByCode.has(obs.speciesCode)) obsByCode.set(obs.speciesCode, obs);
          }

          const targets: TargetSpecies[] = sppCodes
            .filter((code) => obsByCode.has(code) && !lifeSet.has(code))
            .map((code) => {
              const obs = obsByCode.get(code)!;
              return {
                speciesCode: code,
                comName: obs.comName,
                sciName: obs.sciName,
                nearbyCount: nearbyFreq.get(code) ?? 0,
              };
            })
            .sort((a, b) => b.nearbyCount - a.nearbyCount)
            .slice(0, 15);

          setTargetSpecies(targets);
        }
      }

      // ─── Lifer Notifications ────────────────────────────────────────────────
      // Capture and advance the first-fetch flag atomically within this fetch's scope
      const isFirstFetch = isFirstFetchRef.current;
      isFirstFetchRef.current = false;

      const [userLat, userLng] = searchCenterRef.current;

      for (const obs of withFreq) {
        if (obs.tier !== 'lifer' && obs.tier !== 'lifer-rare') continue;
        const distKm = haversineKm(userLat, userLng, obs.lat, obs.lng);
        if (distKm > LIFER_ALERT_RADIUS_KM) continue;
        if (notifiedRef.current.has(obs.speciesCode)) continue;

        // Always mark as seen so we don't re-alert in future fetches
        notifiedRef.current.add(obs.speciesCode);

        // On the first fetch (platform load or pin drop), silently pre-populate
        // notifiedRef so the user isn't barraged with alerts for already-present species
        if (isFirstFetch || !settingsRef.current.notificationsEnabled) continue;

        // New lifer/year bird discovered after initial load — alert the user
        const alertLabel = settingsRef.current.yearListActive ? 'Year new' : 'Lifer';
        const id = ++toastIdRef.current;
        setToasts((prev) => [...prev.slice(-2), { id, speciesName: obs.comName, locName: obs.locName, distKm }]);
        sendBrowserNotification(
          `🐦 ${alertLabel} nearby: ${obs.comName}`,
          `${obs.locName} · ${fmtDist(distKm, settingsRef.current.useMetric)} away`
        );
        if (settingsRef.current.soundEnabled) {
          try { playAlertBeep(); } catch { /* ignore */ }
        }
      }

      setApiStatus('ok');
      lastFetchRef.current = now;
      lastFetchKeyRef.current = paramsKey;
      setLastFetch(now);
    } catch {
      // Aborted/superseded fetches fail silently; only the latest sets error state
      if (gen === fetchGenerationRef.current) setApiStatus('error');
    } finally {
      // Only clear the loading indicator for the latest fetch
      if (gen === fetchGenerationRef.current) {
        setLoading(false);
        inFlightKeyRef.current = null;
      }
    }
  }, []);

  // The one place a search is started: mount, GPS fix, pin drop, pin clear, and
  // radius change all funnel through the same derived key. Previously these were
  // three effects poking `lastFetchRef` from the outside, and the pin-clear path
  // left the old sightings on the map until something else forced a refresh.
  const prevSearchKeyRef = useRef('');
  useEffect(() => {
    // Nothing is searched until a location exists. This is the whole geolocation
    // fix: the old code fetched three eBird endpoints against a hardcoded
    // Bellevue centre on mount, for every visitor, before the permission prompt
    // had even been answered. `searchCenter` is PENDING_CENTER here and must not
    // reach a request.
    if (!locationResolved) return;
    if (prevSearchKeyRef.current === searchKey) return;
    const isFirstRun = prevSearchKeyRef.current === '';
    prevSearchKeyRef.current = searchKey;

    if (!isFirstRun) {
      // Drop the old area's layers up front. Leaving them up while the new fetch
      // is in flight is exactly the stale-pin bug: markers from one place, circle
      // around another.
      setObservations([]);
      setHotspots([]);
      setTargetSpecies([]);
      setSelectedLocKey(null);
      setDriveTimes(new Map());
      notifiedRef.current = new Set();
      isFirstFetchRef.current = true; // silence the alert flood for a brand new area
    }

    // Deliberately does NOT zero `lastFetchRef` to force the fetch through. The
    // throttle only fires when the params key repeats, and a changed searchKey
    // means a changed params key — so there is nothing to bypass. Zeroing it (as
    // the old pin/centre effects did) also told the auto-refresh visibility
    // catch-up that the data was infinitely stale, firing a second identical
    // round of requests moments after this one.
    fetchData(true);
  }, [locationResolved, searchKey, fetchData]);

  // Sync dark/light class on <html> for global CSS selectors (.dark scrollbar, etc.)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', !settings.lightMode);
  }, [settings.lightMode]);

  // Low battery mode — global kill switch for marker animations and filters
  useEffect(() => {
    document.documentElement.classList.toggle('low-fi', lowFi);
  }, [lowFi]);

  // Auto-refresh — skips ticks while the tab is hidden (no point burning API
  // quota for an invisible map); catches up once when the tab becomes visible.
  useEffect(() => {
    if (settings.autoRefresh === 0) return;
    // Same gate as the search effect — a timer must not do what the mount path
    // is forbidden to do.
    if (!locationResolved) return;
    const intervalMs = settings.autoRefresh * 60 * 1000;
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      fetchData(true);
    }, intervalMs);
    const onVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastFetchRef.current >= intervalMs
      ) {
        fetchData(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [settings.autoRefresh, locationResolved, fetchData]);

  // Re-classify when life list changes (no refetch)
  useEffect(() => {
    if (settings.yearListActive) return;
    setObservations((prev) =>
      prev.length > 0 ? classifyAll(prev, lifeList) : prev
    );
  }, [lifeList, settings.yearListActive]);

  // Re-classify when year list changes (in year list mode)
  useEffect(() => {
    if (!settings.yearListActive) return;
    setObservations((prev) =>
      prev.length > 0 ? classifyAll(prev, yearList) : prev
    );
  }, [yearList, settings.yearListActive]);

  // Re-classify when switching between life/year list mode
  useEffect(() => {
    const activeList = settings.yearListActive ? yearList : lifeList;
    setObservations((prev) =>
      prev.length > 0 ? classifyAll(prev, activeList) : prev
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.yearListActive]);

  // One-time migration of stale legacy species codes (old hardcoded PNW list)
  // to canonical eBird taxonomy codes. Delayed so it never competes with the
  // initial observation fetch; no-ops instantly on already-migrated devices.
  useEffect(() => {
    const timer = setTimeout(() => {
      migrateStaleCodesOnce()
        .then((changed) => {
          if (changed) {
            setLifeList(getLifeList());
            setYearList(getYearList());
            setLifeListMeta(getLifeListMeta());
          }
        })
        .catch(() => { /* offline — retries next session */ });
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  // Sightings grouped into map pins. Built here rather than inside the map so the
  // detail panel resolves `selectedLocKey` against the very same array the markers
  // were rendered from — a marker key can't point at a group the panel would
  // assemble differently.
  const markerGroups = useMemo(
    () => buildMarkerGroups(observations, settings.dimSeenSpecies),
    [observations, settings.dimSeenSpecies]
  );

  // Resolved against the UNFILTERED groups on purpose. Phase B has the panel
  // close when its locKey leaves this array; reading the filtered array instead
  // would slam the panel shut the moment "reachable only" is switched on, which
  // reads as a crash rather than as a filter. Filtering governs what is listed
  // and plotted, not what stays open.
  const selectedGroup = useMemo(
    () => (selectedLocKey ? markerGroups.find(([key]) => key === selectedLocKey)?.[1] ?? null : null),
    [markerGroups, selectedLocKey]
  );

  // ─── Drive time ───────────────────────────────────────────────────────────
  // Origin is the GPS fix, NOT searchCenter. A dropped pin moves where you
  // *search*; it does not move where you are driving *from*. With geolocation
  // denied there is no origin, so no badges render anywhere — correct, not a bug.
  const driveOrigin = userLocation;
  // Rounded to the 3 dp the caches key on, so sub-110 m GPS jitter doesn't
  // invalidate anything but real movement does.
  const driveOriginKey = driveOrigin ? `${driveOrigin[0].toFixed(3)},${driveOrigin[1].toFixed(3)}` : '';

  // `driveTimes` is keyed on locKey alone, so unlike the cache in lib/drive-time.ts
  // it carries no origin. Drive a few miles without touching the search area and
  // every entry would silently be measured from where you *were*.
  const prevDriveOriginRef = useRef(driveOriginKey);
  useEffect(() => {
    if (prevDriveOriginRef.current === driveOriginKey) return;
    prevDriveOriginRef.current = driveOriginKey;
    setDriveTimes(new Map());
  }, [driveOriginKey]);

  // The filter cannot be lazy. A "hide anything over 30 minutes" that only knew
  // about the cards you happened to scroll past would hide an arbitrary subset,
  // so turning it on fetches the whole result set. Bounded by the ≤50 km search
  // radius and grouped per location, that is one or two matrix calls; every badge
  // rendered afterwards resolves from the same client cache with no new request.
  const reachableOnly = settings.driveTimeReachableOnly;

  // Every location in the result set, NOT `markerGroups`.
  //
  // `buildMarkerGroups` drops `seen` and `rare` observations when
  // `dimSeenSpecies` is off (lib/markers.ts:23-30), so keying the fetch on the
  // marker list left those cards with no known duration — and an unknown
  // duration is deliberately never filtered. The list would then keep showing
  // sightings the filter claimed to have removed, with the map and the sidebar
  // disagreeing about what "reachable" means. The filter governs both, so it has
  // to be measured over both.
  const driveTargets = useMemo(() => {
    const byKey = new Map<string, [number, number]>();
    for (const o of observations) {
      const key = locKeyOf(o);
      if (!byKey.has(key)) byKey.set(key, [o.lat, o.lng]);
    }
    return Array.from(byKey, ([locKey, coords]) => ({ locKey, coords }));
  }, [observations]);

  const driveLocSig = useMemo(
    () => driveTargets.map((target) => target.locKey).join('|'),
    [driveTargets]
  );
  useEffect(() => {
    if (!reachableOnly || !driveOrigin || driveTargets.length === 0) return;
    let cancelled = false;
    fetchDriveTimes(driveOrigin, driveTargets).then((map) => {
      if (!cancelled) setDriveTimes(map);
    });
    return () => { cancelled = true; };
    // driveLocSig, not driveTargets: a refetch that returns the same locations
    // must not re-issue the batch just because the array identity changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachableOnly, driveOriginKey, driveLocSig]);

  // ONE predicate, consumed by both the list and the map, so the two can never
  // disagree about what they are showing. `null` when the filter is inactive,
  // which is what lets both derivations pass their input through by identity.
  const reachableFilter = useMemo<((locKey: string) => boolean) | null>(() => {
    if (!reachableOnly || !driveOrigin) return null;
    const maxSec = settings.driveTimeMaxMin * 60;
    return (locKey: string) => {
      const seconds = driveTimes.get(locKey);
      // Unknown stays visible. An ORS outage or a spent quota must not silently
      // delete a lifer from the map — failing closed on privacy is right, failing
      // closed on a convenience filter is not.
      if (seconds === undefined || seconds === null) return true;
      return seconds <= maxSec;
    };
  }, [reachableOnly, driveOrigin, driveTimes, settings.driveTimeMaxMin]);

  // What the map actually plots. With the filter off this returns `markerGroups`
  // BY IDENTITY — the default configuration must cost the map exactly nothing,
  // since a new array re-renders every marker (phaseB_rationale.md §3.9).
  //
  // Filtered from `markerGroups`, never fed back into it: building the groups
  // from an already-filtered set would make `markerLocSig` above depend on
  // `driveTimes`, and the eager fetch would then oscillate — refetching a
  // shrinking set, seeing locations go unknown, and showing them again.
  const visibleMarkerGroups = useMemo<MarkerGroup[]>(
    () => (reachableFilter ? markerGroups.filter(([locKey]) => reachableFilter(locKey)) : markerGroups),
    [markerGroups, reachableFilter]
  );

  // Same predicate, per observation, for the sidebar list and the header counts.
  const visibleObservations = useMemo<ClassifiedObservation[]>(
    () => (reachableFilter ? observations.filter((o) => reachableFilter(locKeyOf(o))) : observations),
    [observations, reachableFilter]
  );

  const lifeSet = useMemo(() => new Set(lifeList), [lifeList]);

  // Species arriving in the region soon that aren't being seen locally yet —
  // lifers first. Recomputed from the cached forecast; no extra fetches.
  const arrivingSpecies = useMemo<ArrivingSpecies[]>(() => {
    if (!regionForecast) return [];
    const currentCodes = new Set(observations.map((o) => o.speciesCode));
    const activeList = settings.yearListActive ? yearList : lifeList;
    return selectArriving(regionForecast, currentCodes, new Set(activeList));
  }, [regionForecast, observations, lifeList, yearList, settings.yearListActive]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleAddToLifeList(code: string, name: string, sciName?: string, date?: string, location?: string) {
    setLifeList((prev) => addToLifeList(prev, code));
    // Always persist at least the name — without meta, entries added away from
    // home degrade to raw species codes after a reload in a different area
    setLifeListMeta((prev) => {
      if (prev[code]) return prev;
      const next = {
        ...prev,
        [code]: {
          comName: name,
          sciName: sciName ?? '',
          firstDate: date ?? '',
          firstLocation: location ?? '',
          totalCount: 1,
        },
      };
      saveLifeListMeta(next);
      return next;
    });
  }

  // Pin drop and clear only move the pin. The searchKey effect above owns
  // everything that follows from that — clearing layers, resetting alert state
  // and refetching — so the two paths can't drift apart.
  function handlePinDrop(lat: number, lng: number) {
    setPinLocation([lat, lng]);
    setFlyToTarget([lat, lng]);
    // A dropped pin IS an established centre — the user picked it, and
    // `locationResolved` derives that. This is the escape hatch out of the
    // neutral view when permission is denied or still pending, which is why the
    // neutral overlay offers it directly.
    setLocationNotice(false);
  }

  function handleClearPin() {
    setPinLocation(null);
  }

  function handleRemoveFromLifeList(code: string) {
    setLifeList((prev) => removeFromLifeList(prev, code));
  }

  function handleAddToYearList(code: string, _name: string) {
    setYearList((prev) => addToYearList(prev, code));
  }

  function handleRemoveFromYearList(code: string) {
    setYearList((prev) => removeFromYearList(prev, code));
  }

  function handleClearLifeList() {
    clearLifeList();
    setLifeList([]);
    setLifeListMeta({});
    notifiedRef.current = new Set(); // reset notifications so species can alert again
  }

  function handleClearYearList() {
    clearYearList();
    setYearList([]);
  }

  function handleBulkImport(
    lifeCodes: string[],
    yearCodes: string[],
    meta: Record<string, SpeciesMeta>
  ) {
    // Codes arrive canonical (resolved against the full eBird taxonomy at
    // import time) — just merge and dedupe
    const existingLife = new Set(lifeList);
    const newList = [...lifeList, ...lifeCodes.filter((c) => !existingLife.has(c))];
    const mergedMeta = { ...lifeListMeta, ...meta };

    setLifeList(newList);
    saveLifeList(newList);
    setYearList((prev) => bulkAddToYearList(prev, yearCodes));
    setLifeListMeta(mergedMeta);
    saveLifeListMeta(mergedMeta);
  }

  type Tab = 'alerts' | 'lifelist' | 'settings';

  function handleSyncMerge(payload: SyncPayload) {
    // Union the pulled lists into the local ones (non-destructive), reusing the
    // same merge path as file import
    handleBulkImport(payload.lifeList ?? [], payload.yearList ?? [], payload.meta ?? {});
  }

  // The only place `drawerOpen` is ever set true. On mobile the drawer, the
  // species detail sheet and the hotspot sheet all occupy the same strip above
  // the tab bar, so opening one has to close the other two — routing every
  // opener through here keeps that invariant in one place instead of at each
  // call site (phaseB_rationale.md §3.2).
  //
  // The hotspot panel joined this set when it moved out of the sidebar. It used
  // to BE the drawer's contents, so it was exempt; now it is a third competitor
  // for the same 62vh.
  const openDrawer = useCallback(() => {
    setSelectedLocKey(null);
    setHotspotPanel(null);
    setDrawerOpen(true);
  }, []);

  function handleTabChange(tab: Tab) {
    if (isMobile) {
      if (tab === activeTab && drawerOpen) {
        setDrawerOpen(false);
      } else {
        setActiveTab(tab);
        openDrawer();
      }
    } else {
      setActiveTab(tab);
    }
  }

  // The two map-object openers are now symmetric, because the two panels they
  // open occupy the same slot: each clears the other, and each closes the mobile
  // drawer rather than opening it.
  function handleSelectSighting(locKey: string) {
    setSelectedLocKey(locKey);
    setHotspotPanel(null);
    if (isMobile) setDrawerOpen(false);
    noteViewAction(`loc:${locKey}`);
  }

  function handleHotspotDetail(hs: Hotspot) {
    setHotspotPanel(hs);
    setSelectedLocKey(null);
    // Closes the drawer, where it used to OPEN it. That call existed solely
    // because HotspotPanel rendered inside the sidebar and a tap would otherwise
    // appear to do nothing. The panel is now over the map, and on mobile the
    // drawer would cover it.
    if (isMobile) setDrawerOpen(false);
  }

  function handleSettingsChange(s: AppSettings) {
    const preciseChanged = s.preciseLocation !== settings.preciseLocation;
    setSettings(s);
    saveSettings(s);
    // Toggling "Precise location" re-resolves immediately rather than waiting
    // for a reload — the whole point of the switch is that the user is trying to
    // fix a location that is currently wrong or missing.
    if (preciseChanged) startLocation(s.preciseLocation);
  }

  // Dismissing the intro is also what releases the location flow on a first
  // visit — see the mount effect. `markOnboardingSeen()` runs on every exit path
  // (Next, Skip, Esc, backdrop, ✕) because they all land here.
  function handleCloseOnboarding() {
    setOnboardingOpen(false);
    markOnboardingSeen();
    if (pendingLocationRef.current) {
      pendingLocationRef.current = false;
      startLocation(settingsRef.current.preciseLocation);
    }
  }

  function handleFlyTo(lat: number, lng: number) {
    setFlyToTarget([lat, lng]);
  }

  function handleFocusSpecies(code: string, name: string) {
    setFocusedSpecies((prev) => (prev?.code === code ? null : { code, name }));
    // Counted on toggle-off too, because the key is already in the Set by then —
    // un-focusing a species cannot un-look at it.
    noteViewAction(`sp:${code}`);
  }

  function handleDismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Both donation exits write the SAME snooze key with different expiries, so
  // there is no second flag that could disagree about whether to ask. Clicking
  // through is treated as "asked and answered" for a year; dismissing, for two
  // weeks. Ignoring the banner writes nothing at all — it returns next session.
  function handleDonateClick() {
    track(DONATION_EVENTS.clicked, { session_count: sessionCountRef.current });
    snoozeDonation(DONATED_SNOOZE_DAYS);
    donationSettledRef.current = true;
    setDonationOpen(false);
    // Deliberately no preventDefault: the anchor's target="_blank" navigation is
    // what actually reaches Eastside Audubon.
  }

  function handleDismissDonation() {
    track(DONATION_EVENTS.dismissed, { session_count: sessionCountRef.current });
    snoozeDonation(DISMISS_SNOOZE_DAYS);
    donationSettledRef.current = true;
    setDonationOpen(false);
  }

  const lm = settings.lightMode;

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: lm ? '#F8F9FA' : '#09090B',
      }}
    >
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isMobile={isMobile}
        drawerOpen={drawerOpen}
        observations={visibleObservations}
        hotspots={hotspots}
        driveOrigin={driveOrigin}
        lifeList={lifeList}
        yearList={yearList}
        lifeListMeta={lifeListMeta}
        targetSpecies={targetSpecies}
        arrivingSpecies={arrivingSpecies}
        settings={settings}
        apiStatus={apiStatus}
        loading={loading}
        userCenter={searchCenter}
        locationResolved={locationResolved}
        focusedSpecies={focusedSpecies}
        onFlyTo={handleFlyTo}
        onFocusSpecies={handleFocusSpecies}
        onAddToLifeList={handleAddToLifeList}
        onRemoveFromLifeList={handleRemoveFromLifeList}
        onAddToYearList={handleAddToYearList}
        onRemoveFromYearList={handleRemoveFromYearList}
        onBulkImport={handleBulkImport}
        onClearLifeList={handleClearLifeList}
        onClearYearList={handleClearYearList}
        onSettingsChange={handleSettingsChange}
        onRefreshNow={() => fetchData(true)}
        onSyncMerge={handleSyncMerge}
        prefersReducedMotion={prefersReducedMotion}
      />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <StatusBar
          observations={visibleObservations}
          loading={loading}
          apiStatus={apiStatus}
          lastFetch={lastFetch}
          lightMode={lm}
          yearListActive={settings.yearListActive}
          isMobile={isMobile}
        />
        <BirdMap
          searchCenter={searchCenter}
          searchRadiusKm={searchRadiusKm}
          isMobile={isMobile}
          observations={visibleObservations}
          markerGroups={visibleMarkerGroups}
          hotspots={hotspots}
          flyToTarget={flyToTarget}
          settings={settings}
          pinLocation={pinLocation}
          userLocation={userLocation}
          userAccuracyM={userAccuracyM}
          focusedSpecies={focusedSpecies}
          selectedLocKey={selectedLocKey}
          hotspotOpen={hotspotPanel !== null}
          loading={loading}
          lowFi={lowFi}
          locationResolved={locationResolved}
          locationReason={locationReason ?? null}
          onSelectSighting={handleSelectSighting}
          // Wired to MapClickHandler's `onDismiss`: a click on empty map closes
          // whichever right-hand panel is open. Clearing only the sighting would
          // leave a hotspot panel that no longer has a dismiss gesture the
          // species panel has.
          onCloseDetail={() => { setSelectedLocKey(null); setHotspotPanel(null); }}
          onHotspotDetail={handleHotspotDetail}
          onPinDrop={handlePinDrop}
          onClearPin={handleClearPin}
          onRefreshNow={() => fetchData(true)}
          onOpenHelp={() => setOnboardingOpen(true)}
        />

        {selectedGroup && (
          <SpeciesDetailPanel
            // Remounts on selection change, which resets the pager and any
            // half-filled add-to-life-list form.
            key={selectedLocKey}
            group={selectedGroup}
            lifeSet={lifeSet}
            focusedCode={focusedSpecies?.code ?? null}
            driveOrigin={driveOrigin}
            lightMode={lm}
            isMobile={isMobile}
            reduceMotion={lowFi}
            onAddToLifeList={handleAddToLifeList}
            onClose={() => setSelectedLocKey(null)}
          />
        )}

        {/* Same slot as the species panel, and mutually exclusive with it — the
            two openers above each clear the other's state. Keyed on `locId` so
            clicking a second hotspot remounts and refetches rather than showing
            the previous one's species list under a new title. */}
        {hotspotPanel && (
          <HotspotPanel
            key={hotspotPanel.locId}
            hotspot={hotspotPanel}
            lifeList={lifeList}
            lightMode={lm}
            isMobile={isMobile}
            reduceMotion={lowFi}
            onAddToLifeList={handleAddToLifeList}
            onClose={() => setHotspotPanel(null)}
          />
        )}

        {/* Inside the map column, not at page level, so "centred" means centred
            over the map rather than over the map plus the 380 px sidebar. The
            column is the `position: relative` containing block above. */}
        {donationOpen && (
          <DonationBanner
            lightMode={lm}
            isMobile={isMobile}
            lowFi={lowFi}
            // Same union Map.tsx derives as `rightPanelOpen` for MapLegend and
            // MapControls — a third consumer of the one fact that a 340 px column
            // is covering the right of the map. Passing only `selectedLocKey`
            // here would leave the banner clipped by the hotspot panel alone,
            // which is exactly the class of bug invariant #4 in
            // PhaseE1_bugfix_panels_order_pills.md describes.
            rightPanelOpen={selectedLocKey !== null || hotspotPanel !== null}
            onDonate={handleDonateClick}
            onDismiss={handleDismissDonation}
          />
        )}
      </div>

      <NotificationToast
        toasts={toasts}
        onDismiss={handleDismissToast}
        lightMode={lm}
        useMetric={settings.useMetric}
      />

      {/* Location notice. It no longer says "showing a default region", because
          there is no longer a default region to show — it offers the two things
          that can actually resolve the situation instead. */}
      {locationNotice && !locationResolved && (() => {
        const t = getTheme(lm);
        const denied = locationReason === 'denied';
        return (
          <div style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 9999, display: 'flex', alignItems: 'center', gap: 10,
            maxWidth: 'calc(100vw - 32px)',
            background: t.cardBg, border: `1px solid ${t.line2}`,
            borderRadius: 10, padding: '10px 14px',
            boxShadow: t.shadowLg, pointerEvents: 'all',
            fontFamily: t.mono, fontSize: 12, color: t.fg2,
          }}>
            <span>
              {denied
                ? 'Location blocked in your browser.'
                : 'Couldn’t get your location.'}
            </span>
            {settings.preciseLocation && (
              <button
                onClick={() => handleSettingsChange({ ...settings, preciseLocation: false })}
                style={{
                  background: t.accentBg, border: `1px solid ${t.accentBorder}`,
                  borderRadius: 6, padding: '4px 9px', cursor: 'pointer',
                  color: t.accent, fontFamily: t.sans, fontSize: 11.5, fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                Use approximate area
              </button>
            )}
            <button
              onClick={() => setLocationNotice(false)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: t.fg3, padding: '2px', display: 'flex', alignItems: 'center',
              }}
              aria-label="Dismiss"
            >
              <XIcon size={14} />
            </button>
          </div>
        );
      })()}

      {onboardingOpen && (
        <OnboardingModal
          lightMode={lm}
          isMobile={isMobile}
          lowFi={lowFi}
          onClose={handleCloseOnboarding}
        />
      )}
    </div>
  );
}

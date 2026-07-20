'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';

import Sidebar from '@/components/Sidebar';
import StatusBar from '@/components/StatusBar';
import NotificationToast, { type ToastItem } from '@/components/NotificationToast';
import { XIcon } from '@/components/Icons';
import { getTheme } from '@/lib/theme';

import { useMobile } from '@/hooks/useMobile';
import { mergeObservations, DEFAULT_SETTINGS, fmtDist } from '@/lib/ebird';
import type { Observation, Hotspot, ClassifiedObservation, AppSettings, TargetSpecies } from '@/lib/ebird';
import { classifyAll } from '@/lib/classify';
import { migrateStaleCodesOnce } from '@/lib/taxonomy';
import { haversineKm } from '@/lib/geo';
import { syncLifeList } from '@/lib/push-client';
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

const DEFAULT_CENTER: [number, number] = [47.65, -122.17];
const RATE_LIMIT_MS = 5 * 60 * 1000;
/** Minimum gap between forced refreshes of the same location+radius (spam-click guard) */
const MIN_FORCE_INTERVAL_MS = 15 * 1000;
const LIFER_ALERT_RADIUS_KM = 16.09; // 10 miles

// Dynamic import of map (no SSR — Leaflet requires browser DOM)
const BirdMap = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: '100%',
        background: '#F1F3F5',
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
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [pinLocation, setPinLocation] = useState<[number, number] | null>(null);
  const [lifeList, setLifeList] = useState<string[]>([]);
  const [yearList, setYearList] = useState<string[]>([]);
  const [lifeListMeta, setLifeListMeta] = useState<Record<string, SpeciesMeta>>({});
  const [observations, setObservations] = useState<ClassifiedObservation[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [targetSpecies, setTargetSpecies] = useState<TargetSpecies[]>([]);
  const [hotspotPanel, setHotspotPanel] = useState<Hotspot | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [flyToTarget, setFlyToTarget] = useState<[number, number] | null>(null);
  const [activeTab, setActiveTab] = useState<'alerts' | 'lifelist' | 'settings'>('alerts');
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<'ok' | 'error' | 'loading'>('loading');
  const [lastFetch, setLastFetch] = useState(0);
  const [focusedSpecies, setFocusedSpecies] = useState<{ code: string; name: string } | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [locationNotice, setLocationNotice] = useState(false);
  const isMobile = useMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const lastFetchRef = useRef(0);
  const settingsRef = useRef(settings);
  const centerRef = useRef(center);
  const pinLocationRef = useRef<[number, number] | null>(null);
  const lifeListRef = useRef(lifeList);
  const yearListRef = useRef(yearList);
  const lifeListMetaRef = useRef(lifeListMeta);
  const notifiedRef = useRef<Set<string>>(new Set());
  const toastIdRef = useRef(0);
  const pinEffectFirstRunRef = useRef(false);
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

  // Keep refs in sync
  settingsRef.current = settings;
  centerRef.current = center;
  pinLocationRef.current = pinLocation;
  lifeListRef.current = lifeList;
  yearListRef.current = yearList;
  lifeListMetaRef.current = lifeListMeta;

  // Initialize from localStorage on mount
  useEffect(() => {
    setLifeList(getLifeList());
    setYearList(getYearList());
    setLifeListMeta(getLifeListMeta());
    setSettings(getSettings());

    // Deep link from a push notification: /?lat=..&lng=..&sp=.. — jump straight
    // to the sighting and skip the GPS fix that would otherwise override it.
    const params = new URLSearchParams(window.location.search);
    const dlLat = parseFloat(params.get('lat') ?? '');
    const dlLng = parseFloat(params.get('lng') ?? '');
    const hasDeepLink =
      !isNaN(dlLat) && !isNaN(dlLng) && dlLat >= -90 && dlLat <= 90 && dlLng >= -180 && dlLng <= 180;
    if (hasDeepLink) {
      setCenter([dlLat, dlLng]);
      setFlyToTarget([dlLat, dlLng]);
      const sp = params.get('sp');
      if (sp && /^[a-zA-Z0-9]+$/.test(sp)) setFocusedSpecies({ code: sp, name: sp });
      // Drop the query so a reload doesn't re-trigger the jump
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setCenter(coords);
          setUserLocation(coords);
        },
        () => {
          // Permission denied or unavailable — keep default, show notice
          setLocationNotice(true);
        },
        // A minute-old cached position is fine for a 25-50 km search radius
        // and avoids a slow cold GPS fix on startup
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    }
  }, []);

  // Keep the push-alert subscription's life-list snapshot current while the app
  // is open. No-ops unless the user has enabled background alerts.
  useEffect(() => {
    syncLifeList(lifeList, settings.useMetric).catch(() => { /* offline / not subscribed */ });
  }, [lifeList, settings.useMetric]);

  const fetchData = useCallback(async (force = false) => {
    const now = Date.now();

    // Use pin location when active, otherwise user's GPS/default location.
    // Coordinates are rounded to 2 decimals (~1.1 km) so nearby users produce
    // identical request URLs and share the CDN cache entry.
    const [rawLat, rawLng] = pinLocationRef.current ?? centerRef.current;
    const lat = rawLat.toFixed(2);
    const lng = rawLng.toFixed(2);
    // Settings radius is in km; pin always uses 50 km (eBird API max)
    const distKm = pinLocationRef.current ? 50 : Math.min(settingsRef.current.searchRadius, 50);
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

      const userLat = pinLocationRef.current?.[0] ?? centerRef.current[0];
      const userLng = pinLocationRef.current?.[1] ?? centerRef.current[1];

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

  // Initial fetch
  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // Re-fetch when pin is dropped or cleared; reset notifications for new area
  // Skip the initial mount run (pinLocation hasn't changed — it's just the first render)
  useEffect(() => {
    if (!pinEffectFirstRunRef.current) {
      pinEffectFirstRunRef.current = true;
      return;
    }
    notifiedRef.current = new Set();
    isFirstFetchRef.current = true; // first fetch at new pin location is always silent
    fetchData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinLocation]);

  // Re-fetch when location or radius changes
  const prevSearchKey = useRef('');
  useEffect(() => {
    const key = `${center[0].toFixed(4)},${center[1].toFixed(4)},${settings.searchRadius}`;
    if (key === prevSearchKey.current) return;
    prevSearchKey.current = key;
    if (lastFetchRef.current > 0) {
      lastFetchRef.current = 0;
      isFirstFetchRef.current = true; // treat center/radius change as "first fetch" — silence notification flood
      fetchData(true);
    }
  }, [center, settings.searchRadius, fetchData]);

  // Sync dark/light class on <html> for global CSS selectors (.dark scrollbar, etc.)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', !settings.lightMode);
  }, [settings.lightMode]);

  // Auto-refresh — skips ticks while the tab is hidden (no point burning API
  // quota for an invisible map); catches up once when the tab becomes visible.
  useEffect(() => {
    if (settings.autoRefresh === 0) return;
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
  }, [settings.autoRefresh, fetchData]);

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

  function handlePinDrop(lat: number, lng: number) {
    setPinLocation([lat, lng]);
    setFlyToTarget([lat, lng]);
    lastFetchRef.current = 0;
  }

  function handleClearPin() {
    setPinLocation(null);
    lastFetchRef.current = 0;
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

  function handleTabChange(tab: Tab) {
    if (isMobile) {
      if (tab === activeTab && drawerOpen) {
        setDrawerOpen(false);
      } else {
        setActiveTab(tab);
        setDrawerOpen(true);
      }
    } else {
      setActiveTab(tab);
    }
  }

  function handleSettingsChange(s: AppSettings) {
    setSettings(s);
    saveSettings(s);
  }

  function handleFlyTo(lat: number, lng: number) {
    setFlyToTarget([lat, lng]);
  }

  function handleFocusSpecies(code: string, name: string) {
    setFocusedSpecies((prev) => (prev?.code === code ? null : { code, name }));
  }

  function handleDismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
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
        observations={observations}
        hotspots={hotspots}
        lifeList={lifeList}
        yearList={yearList}
        lifeListMeta={lifeListMeta}
        targetSpecies={targetSpecies}
        hotspotPanel={hotspotPanel}
        settings={settings}
        apiStatus={apiStatus}
        loading={loading}
        userCenter={pinLocation ?? center}
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
        onCloseHotspotPanel={() => setHotspotPanel(null)}
      />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <StatusBar
          observations={observations}
          loading={loading}
          apiStatus={apiStatus}
          lastFetch={lastFetch}
          lightMode={lm}
          yearListActive={settings.yearListActive}
          isMobile={isMobile}
        />
        <BirdMap
          center={center}
          isMobile={isMobile}
          observations={observations}
          hotspots={hotspots}
          flyToTarget={flyToTarget}
          settings={settings}
          lifeList={lifeList}
          pinLocation={pinLocation}
          userLocation={userLocation}
          focusedSpecies={focusedSpecies}
          loading={loading}
          onAddToLifeList={handleAddToLifeList}
          onHotspotDetail={setHotspotPanel}
          onPinDrop={handlePinDrop}
          onClearPin={handleClearPin}
          onRefreshNow={() => fetchData(true)}
        />
      </div>

      <NotificationToast
        toasts={toasts}
        onDismiss={handleDismissToast}
        lightMode={lm}
        useMetric={settings.useMetric}
      />

      {locationNotice && (() => {
        const t = getTheme(lm);
        return (
          <div style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 9999, display: 'flex', alignItems: 'center', gap: 10,
            background: t.cardBg, border: `1px solid ${t.line2}`,
            borderRadius: 10, padding: '10px 14px',
            boxShadow: t.shadowLg, pointerEvents: 'all',
            fontFamily: t.mono, fontSize: 12, color: t.fg2,
            whiteSpace: 'nowrap',
          }}>
            <span>Location unavailable — showing a default region.</span>
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
    </div>
  );
}

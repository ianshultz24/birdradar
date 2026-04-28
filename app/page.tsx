'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';

import Sidebar from '@/components/Sidebar';
import StatusBar from '@/components/StatusBar';
import NotificationToast, { type ToastItem } from '@/components/NotificationToast';

import { useMobile } from '@/hooks/useMobile';
import { mergeObservations, DEFAULT_SETTINGS, fmtDist } from '@/lib/ebird';
import type { Observation, Hotspot, ClassifiedObservation, AppSettings, TargetSpecies } from '@/lib/ebird';
import { classifyAll } from '@/lib/classify';
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
const LIFER_ALERT_RADIUS_KM = 16.09; // 10 miles

/**
 * Reconcile stale PNW_SPECIES codes in the life list against live eBird observation codes.
 * When a CSV import stores code "bufhea" but eBird API returns "buffle" for the same
 * scientific name, this replaces the stale code with the correct one.
 */
function reconcileLifeListCodes(
  currentList: string[],
  meta: Record<string, SpeciesMeta>,
  observations: ClassifiedObservation[]
): { newList: string[]; newMeta: Record<string, SpeciesMeta>; changed: boolean } {
  // Build sciName → correct eBird code from live observations
  const sciToCode = new Map<string, string>();
  for (const obs of observations) {
    if (obs.sciName && !sciToCode.has(obs.sciName.toLowerCase())) {
      sciToCode.set(obs.sciName.toLowerCase(), obs.speciesCode);
    }
  }

  let list = [...currentList];
  const newMeta: Record<string, SpeciesMeta> = { ...meta };
  let changed = false;

  for (const [code, m] of Object.entries(meta)) {
    if (!m.sciName) continue;
    const correctCode = sciToCode.get(m.sciName.toLowerCase());
    if (!correctCode || correctCode === code) continue;

    // Swap stale code → correct code
    changed = true;
    list = list.filter((c) => c !== code);
    if (!list.includes(correctCode)) list.push(correctCode);
    delete newMeta[code];
    newMeta[correctCode] = m;
  }

  return { newList: list, newMeta, changed };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
  /** True after the first successful fetch has triggered a life list code reconciliation */
  const hasReconciledRef = useRef(false);

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

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setCenter(coords);
          setUserLocation(coords);
        },
        () => {
          // Permission denied or unavailable — keep default
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }
  }, []);

  const fetchData = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < RATE_LIMIT_MS && lastFetchRef.current > 0) return;

    // Tag this fetch; if a newer one starts before this completes, discard stale results
    const gen = ++fetchGenerationRef.current;

    // Use pin location when active, otherwise user's GPS/default location
    const [lat, lng] = pinLocationRef.current ?? centerRef.current;
    // Settings radius is in km; pin always uses 50 km (eBird API max)
    const distKm = pinLocationRef.current ? 50 : Math.min(settingsRef.current.searchRadius, 50);

    setLoading(true);
    setApiStatus('loading');

    try {
      const [recentRes, notableRes, hotspotsRes] = await Promise.all([
        fetch(`/api/ebird/recent?lat=${lat}&lng=${lng}&dist=${distKm}`),
        fetch(`/api/ebird/notable?lat=${lat}&lng=${lng}&dist=${distKm}`),
        fetch(`/api/ebird/hotspots?lat=${lat}&lng=${lng}&dist=${distKm}`),
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
      const classified = classifyAll(merged, activeList, lifeListMetaRef.current);

      // Attach report counts to each classified observation
      const withFreq: ClassifiedObservation[] = classified.map((obs) => ({
        ...obs,
        reportCount: freqMap.get(`${obs.speciesCode}|${obs.locId}`) ?? 1,
      }));

      setObservations(withFreq);
      setHotspots(Array.isArray(hotspotsData) ? hotspotsData : []);

      // ─── One-time code reconciliation ──────────────────────────────────────
      // On the first successful fetch, fix any stale PNW_SPECIES codes stored in
      // the life list so they match the codes eBird API actually returns.
      if (!hasReconciledRef.current && lifeListMetaRef.current) {
        hasReconciledRef.current = true;
        const { newList, newMeta, changed } = reconcileLifeListCodes(
          lifeListRef.current,
          lifeListMetaRef.current,
          withFreq
        );
        if (changed) {
          setLifeList(newList);
          saveLifeList(newList);
          setLifeListMeta(newMeta);
          saveLifeListMeta(newMeta);
        }
      }

      // ─── Target Species ────────────────────────────────────────────────────
      const regionCode = (Array.isArray(hotspotsData) && hotspotsData[0]?.subnational1Code)
        ? hotspotsData[0].subnational1Code
        : 'US-WA';

      const sppRes = await fetch(`/api/ebird/spplist?regionCode=${encodeURIComponent(regionCode)}`);
      if (sppRes.ok) {
        const sppCodes: string[] = await sppRes.json();
        if (Array.isArray(sppCodes)) {
          // Build life set with sciName fallback for target species filtering
          const lifeSet = new Set(lifeListRef.current);
          const lifeSciNames = new Set(
            Object.values(lifeListMetaRef.current)
              .map((m) => m.sciName?.toLowerCase())
              .filter((s): s is string => !!s)
          );
          const nearbyFreq = new Map<string, number>();
          for (const obs of merged) {
            nearbyFreq.set(obs.speciesCode, (nearbyFreq.get(obs.speciesCode) ?? 0) + 1);
          }
          const obsByCode = new Map<string, Observation>();
          for (const obs of merged) {
            if (!obsByCode.has(obs.speciesCode)) obsByCode.set(obs.speciesCode, obs);
          }

          const targets: TargetSpecies[] = sppCodes
            .filter((code) => {
              const obs = obsByCode.get(code);
              if (!obs) return false;
              // Exclude if on life list by code or by sciName (handles stale codes)
              return !lifeSet.has(code) && !lifeSciNames.has(obs.sciName?.toLowerCase() ?? '');
            })
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
      setLastFetch(now);
    } catch {
      // Only set error if this fetch is still the latest (not superseded)
      if (gen === fetchGenerationRef.current) setApiStatus('error');
    } finally {
      // Only clear the loading indicator for the latest fetch
      if (gen === fetchGenerationRef.current) setLoading(false);
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

  // Auto-refresh
  useEffect(() => {
    if (settings.autoRefresh === 0) return;
    const interval = setInterval(() => fetchData(true), settings.autoRefresh * 60 * 1000);
    return () => clearInterval(interval);
  }, [settings.autoRefresh, fetchData]);

  // Re-classify when life list changes (no refetch)
  useEffect(() => {
    if (settings.yearListActive) return;
    setObservations((prev) =>
      prev.length > 0 ? classifyAll(prev, lifeList, lifeListMeta) : prev
    );
  }, [lifeList, lifeListMeta, settings.yearListActive]);

  // Re-classify when year list changes (in year list mode)
  useEffect(() => {
    if (!settings.yearListActive) return;
    setObservations((prev) =>
      prev.length > 0 ? classifyAll(prev, yearList, lifeListMeta) : prev
    );
  }, [yearList, lifeListMeta, settings.yearListActive]);

  // Re-classify when switching between life/year list mode
  useEffect(() => {
    const activeList = settings.yearListActive ? yearList : lifeList;
    setObservations((prev) =>
      prev.length > 0 ? classifyAll(prev, activeList, lifeListMeta) : prev
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.yearListActive]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleAddToLifeList(code: string, name: string, sciName?: string, date?: string, location?: string) {
    setLifeList((prev) => addToLifeList(prev, code));
    if (date || location) {
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
    // Merge new codes into the existing lists (deduped)
    const existingLife = new Set(lifeList);
    const rawLifeList = [...lifeList, ...lifeCodes.filter((c) => !existingLife.has(c))];
    const mergedMeta = { ...lifeListMeta, ...meta };

    // Immediately reconcile stale PNW_SPECIES codes using live observation codes
    const { newList, newMeta } = reconcileLifeListCodes(rawLifeList, mergedMeta, observations);

    // Reconcile year codes through the same mapping
    const codeRemap = new Map<string, string>();
    for (const [oldCode, m] of Object.entries(mergedMeta)) {
      if (newMeta[oldCode] === undefined) {
        const correctCode = Object.keys(newMeta).find((k) => newMeta[k] === m);
        if (correctCode) codeRemap.set(oldCode, correctCode);
      }
    }
    const reconciledYearCodes = yearCodes.map((c) => codeRemap.get(c) ?? c);

    setLifeList(newList);
    saveLifeList(newList);
    setYearList((prev) => bulkAddToYearList(prev, reconciledYearCodes));
    setLifeListMeta(newMeta);
    saveLifeListMeta(newMeta);
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
        onHotspotDetail={setHotspotPanel}
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
    </div>
  );
}

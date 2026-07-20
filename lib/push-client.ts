'use client';

/**
 * Browser-side push subscription flow. The push subscription endpoint itself is
 * the identity — no accounts. All functions are safe no-ops when push isn't
 * supported so callers don't need to feature-detect first.
 */

export type PushSupport = 'ok' | 'unsupported' | 'ios-needs-install';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iOS supports push only for a Home-Screen-installed PWA (16.4+)
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    const standalone = (navigator as { standalone?: boolean }).standalone === true;
    if (isIOS && !standalone) return 'ios-needs-install';
    return 'unsupported';
  }
  return 'ok';
}

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/sw.js');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js');
}

export interface AlertPrefs {
  lat: number;
  lng: number;
  radiusKm: number;
  lifeCodes: string[];
  useMetric: boolean;
}

// The alert location is fixed at subscribe time (it's "watch here", usually
// home) and stored locally so later life-list syncs don't drag it around.
const ALERT_PREFS_KEY = 'birdradar_alert_prefs';

function loadPrefs(): AlertPrefs | null {
  try {
    const raw = localStorage.getItem(ALERT_PREFS_KEY);
    return raw ? (JSON.parse(raw) as AlertPrefs) : null;
  } catch {
    return null;
  }
}

function savePrefs(prefs: AlertPrefs): void {
  try {
    localStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage blocked — sync just won't persist across reloads
  }
}

async function postSubscription(prefs: AlertPrefs): Promise<boolean> {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return false;
  const res = await fetch('/api/alerts/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), ...prefs }),
  });
  return res.ok;
}

/**
 * Request permission, subscribe to push, and register the subscription with
 * the server. Returns the push endpoint on success (used as the local "am I
 * subscribed" marker), or throws with a user-facing message.
 */
export async function enableAlerts(prefs: AlertPrefs): Promise<string> {
  if (pushSupport() !== 'ok') throw new Error('Push notifications are not available on this device.');

  const bootstrap = await fetch('/api/alerts/subscribe').then((r) => r.json());
  if (!bootstrap.configured || !bootstrap.publicKey) {
    throw new Error('Push alerts are not enabled on the server yet.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was denied.');

  const reg = await getRegistration();
  await navigator.serviceWorker.ready;

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(bootstrap.publicKey),
    }));

  const res = await fetch('/api/alerts/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), ...prefs }),
  });
  if (!res.ok) throw new Error('Could not save your alert. Please try again.');

  savePrefs(prefs);
  return sub.endpoint;
}

/**
 * Re-send the life-list snapshot for an existing subscription, keeping the
 * subscribed location/radius fixed. No-op if not subscribed. Call whenever the
 * life list changes while the app is open.
 */
export async function syncLifeList(lifeCodes: string[], useMetric: boolean): Promise<boolean> {
  if (pushSupport() !== 'ok') return false;
  const prefs = loadPrefs();
  if (!prefs) return false;
  const updated: AlertPrefs = { ...prefs, lifeCodes, useMetric };
  const ok = await postSubscription(updated);
  if (ok) savePrefs(updated);
  return ok;
}

export async function disableAlerts(): Promise<void> {
  try {
    localStorage.removeItem(ALERT_PREFS_KEY);
  } catch {
    // ignore
  }
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const { endpoint } = sub;
  await sub.unsubscribe().catch(() => {});
  await fetch('/api/alerts/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

export async function isSubscribed(): Promise<boolean> {
  if (pushSupport() !== 'ok') return false;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return !!sub;
}

import webpush from 'web-push';

/**
 * Web Push (VAPID) sending. Configured lazily from env so the app builds and
 * runs without push keys; sendPush reports 'unconfigured' rather than throwing.
 */

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:alerts@birdradar.app';
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return ensureConfigured();
}

export function getPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Deep link opened on notification click */
  url?: string;
  /** Collapse tag so repeat alerts for the same species replace each other */
  tag?: string;
}

/** 'expired' means the push endpoint is gone (404/410) — the caller should delete it. */
export type PushResult = 'sent' | 'expired' | 'error' | 'unconfigured';

export async function sendPush(
  subscription: webpush.PushSubscription,
  payload: PushPayload
): Promise<PushResult> {
  if (!ensureConfigured()) return 'unconfigured';
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return 'sent';
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) return 'expired';
    return 'error';
  }
}

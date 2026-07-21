'use client';

import type { SpeciesMeta } from './lifelist';

/**
 * Client side of anonymous cross-device sync. Once a device is linked (holds a
 * sync code locally), list changes are pushed automatically; another device
 * enters the same code to pull. No accounts.
 */

export interface SyncPayload {
  lifeList: string[];
  yearList: string[];
  meta: Record<string, SpeciesMeta>;
}

const SYNC_CODE_KEY = 'birdradar_sync_code';

export function getSyncCode(): string | null {
  try {
    return localStorage.getItem(SYNC_CODE_KEY);
  } catch {
    return null;
  }
}

function saveSyncCode(code: string): void {
  try {
    localStorage.setItem(SYNC_CODE_KEY, code);
  } catch {
    /* storage blocked — link won't persist across reloads */
  }
}

export function clearSyncCode(): void {
  try {
    localStorage.removeItem(SYNC_CODE_KEY);
  } catch {
    /* ignore */
  }
}

/** Create a new sync code seeded with the current lists. Returns the code. */
export async function createSyncCode(payload: SyncPayload): Promise<string> {
  const res = await fetch('/api/sync/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(res.status === 503 ? 'Sync is not enabled on the server yet.' : 'Could not create a sync code.');
  const { code } = (await res.json()) as { code: string };
  saveSyncCode(code);
  return code;
}

/** Link this device to an existing code and return its stored lists. */
export async function linkSyncCode(rawCode: string): Promise<SyncPayload> {
  const code = rawCode.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const res = await fetch('/api/sync/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (res.status === 404) throw new Error('That sync code was not found.');
  if (!res.ok) throw new Error('Could not read that sync code.');
  const { data } = (await res.json()) as { data: SyncPayload };
  saveSyncCode(code);
  return data;
}

/** Push current lists to the linked code. No-op if this device isn't linked. */
export async function pushSync(payload: SyncPayload): Promise<boolean> {
  const code = getSyncCode();
  if (!code) return false;
  try {
    const res = await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...payload }),
    });
    if (res.status === 404) {
      // Code was deleted server-side — stop trying to push to it
      clearSyncCode();
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

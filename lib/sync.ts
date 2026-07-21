import { createHash, randomInt } from 'node:crypto';

/**
 * Anonymous cross-device sync. A random code is the only credential — we store
 * the list data keyed by the code's hash, so the DB never holds the code
 * itself. No accounts, no email; the worst-case breach is a species list.
 */

// Crockford-ish alphabet: no 0/O/1/I/L to avoid transcription errors
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LEN = 10;

export function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Normalize user input: uppercase, drop spaces/hyphens. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function isValidCode(code: string): boolean {
  return code.length === CODE_LEN && [...code].every((c) => ALPHABET.includes(c));
}

export function codeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// ─── Payload ─────────────────────────────────────────────────────────────────

interface SyncMeta {
  comName: string;
  sciName: string;
  firstDate: string;
  firstLocation: string;
  totalCount: number;
}

export interface SyncPayload {
  lifeList: string[];
  yearList: string[];
  meta: Record<string, SyncMeta>;
}

const MAX_CODES = 12_000;
const MAX_FIELD = 200;

function codes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 20)
    .slice(0, MAX_CODES);
}

export function sanitizePayload(value: unknown): SyncPayload {
  const v = (value ?? {}) as { lifeList?: unknown; yearList?: unknown; meta?: unknown };
  const str = (x: unknown) => (typeof x === 'string' ? x.slice(0, MAX_FIELD) : '');
  const meta: Record<string, SyncMeta> = {};

  if (v.meta && typeof v.meta === 'object' && !Array.isArray(v.meta)) {
    let n = 0;
    for (const [code, raw] of Object.entries(v.meta as Record<string, unknown>)) {
      if (n >= MAX_CODES) break;
      if (!code || code.length > 20 || !raw || typeof raw !== 'object') continue;
      const m = raw as Record<string, unknown>;
      meta[code] = {
        comName: str(m.comName),
        sciName: str(m.sciName),
        firstDate: str(m.firstDate),
        firstLocation: str(m.firstLocation),
        totalCount:
          typeof m.totalCount === 'number' && Number.isFinite(m.totalCount) && m.totalCount > 0
            ? Math.floor(m.totalCount)
            : 1,
      };
      n++;
    }
  }

  return { lifeList: codes(v.lifeList), yearList: codes(v.yearList), meta };
}

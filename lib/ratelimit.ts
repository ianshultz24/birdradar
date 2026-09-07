import { type NextRequest } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { redis } from './redis';

/**
 * Reusable per-IP rate limiting shared by the eBird proxy and the alert
 * subscription routes. Uses Upstash when configured, otherwise an in-memory
 * sliding window (per instance) so local dev needs no credentials.
 */

export function clientIp(request: NextRequest): string {
  // x-real-ip is set by Vercel from the connecting socket and can't be spoofed
  // by the client; x-forwarded-for's leftmost entry is client-supplied on some
  // hosts, so it's only the fallback.
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = request.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'local';
}

const limiters = new Map<string, Ratelimit>();

function getLimiter(name: string, max: number, windowSec: number): Ratelimit | null {
  if (!redis) return null;
  const key = `${name}:${max}:${windowSec}`;
  let rl = limiters.get(key);
  if (!rl) {
    rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
      prefix: `br:rl:${name}`,
      ephemeralCache: new Map(),
    });
    limiters.set(key, rl);
  }
  return rl;
}

// Per-instance fallback buckets, namespaced by limiter
const memory = new Map<string, number[]>();

/** Returns true if this request should be rejected (over the limit). */
export async function rateLimit(
  request: NextRequest,
  name: string,
  max: number,
  windowSec: number
): Promise<boolean> {
  const ip = clientIp(request);
  const limiter = getLimiter(name, max, windowSec);

  if (limiter) {
    try {
      const { success } = await limiter.limit(ip);
      return !success;
    } catch {
      // Upstash unreachable — fall through to the in-memory limiter
    }
  }

  const windowMs = windowSec * 1000;
  const now = Date.now();
  const bucketKey = `${name}:${ip}`;
  const hits = (memory.get(bucketKey) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  memory.set(bucketKey, hits);

  if (memory.size > 5_000) {
    for (const [key, arr] of memory) {
      if (arr.every((t) => now - t >= windowMs)) memory.delete(key);
    }
  }

  return hits.length > max;
}

/**
 * How many requests this IP has left, **without consuming one**.
 *
 * Purely additive and read-only — `rateLimit()` above is untouched, and nothing
 * in the request path calls this. It exists for the Developer Mode debug
 * overlay, which spec §5 requires to show "remaining per-IP rate limit", and it
 * is only ever reached after `readDevSession()` has verified.
 *
 * The alternative was printing the configured maximum and calling it
 * "remaining", which is a number that looks like a measurement and is not one —
 * the exact failure `PhaseE1_fixes.md` §4e names for the odds chip. Returns
 * `null` when the answer is genuinely unknown, so the overlay can render a
 * dash rather than invent a figure.
 */
export async function peekRateLimit(
  request: NextRequest,
  name: string,
  max: number,
  windowSec: number
): Promise<number | null> {
  const ip = clientIp(request);
  const limiter = getLimiter(name, max, windowSec);

  if (limiter) {
    try {
      const { remaining } = await limiter.getRemaining(ip);
      return remaining;
    } catch {
      // Upstash unreachable — fall through to the per-instance view, which is
      // the same bucket `rateLimit` would have degraded to anyway.
    }
  }

  const windowMs = windowSec * 1000;
  const now = Date.now();
  const hits = (memory.get(`${name}:${ip}`) ?? []).filter((t) => now - t < windowMs);
  return Math.max(0, max - hits.length);
}

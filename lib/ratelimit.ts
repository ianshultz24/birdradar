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

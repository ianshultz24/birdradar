import { Redis } from '@upstash/redis';

/**
 * Shared Upstash Redis client. Null when credentials are absent (local dev,
 * preview builds) — every caller must degrade gracefully rather than assume it
 * exists. Single instance so the rate limiter, upstream budget, response
 * cache, and alert dedupe set all share one connection.
 */
export const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

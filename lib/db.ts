import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

/**
 * Neon Postgres access for push-alert subscriptions. Null when DATABASE_URL is
 * absent so builds and local dev without a database don't crash — callers must
 * return a "not configured" response instead of assuming a connection.
 */

let cached: NeonQueryFunction<false, false> | null | undefined;

function getSql(): NeonQueryFunction<false, false> | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  cached = url ? neon(url) : null;
  return cached;
}

let schemaReady = false;

/**
 * Returns a SQL tag with the subscriptions table guaranteed to exist, or null
 * if the database isn't configured. The CREATE runs once per instance.
 */
export async function getDb(): Promise<NeonQueryFunction<false, false> | null> {
  const sql = getSql();
  if (!sql) return null;
  if (!schemaReady) {
    await sql`CREATE TABLE IF NOT EXISTS alert_subscriptions (
      id          TEXT PRIMARY KEY,
      subscription JSONB NOT NULL,
      lat         DOUBLE PRECISION NOT NULL,
      lng         DOUBLE PRECISION NOT NULL,
      radius_km   INTEGER NOT NULL,
      life_codes  TEXT[] NOT NULL DEFAULT '{}',
      use_metric  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    schemaReady = true;
  }
  return sql;
}

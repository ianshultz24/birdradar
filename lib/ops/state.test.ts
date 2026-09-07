import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveOpsMode,
  readOpsModeWith,
  liftExpired,
  parseOpsMode,
  parseLogEntry,
  retryAfterSeconds,
  normalizeReason,
  OPS_MODE_KEY,
  OPS_LOG_KEY,
  OPS_LOG_MAX,
  MAX_REASON_LENGTH,
  AUTO_LIFT_REASON,
  type OpsMode,
  type OpsRedis,
} from './state';

/**
 * Assertions for the ops-state resolution rule.
 *
 * The one that matters most is `fail open`. Everything else here is a
 * correctness nicety; that one is the difference between "Redis had a bad
 * minute" and "the public site served 503s for a minute". It cannot be reached
 * by a curl probe without deliberately breaking the real Upstash credentials,
 * which is why the client is a parameter.
 *
 * Run with `npm test`.
 */

const NOW = 1_800_000_000_000;

function mode(over: Partial<OpsMode> = {}): OpsMode {
  return { state: 'down', reason: 'Deploying.', until: null, setAt: NOW - 1000, ...over };
}

// ─── A fake Redis that implements the compare-and-delete for real ────────────
// Shared-store fakes, so two "instances" can race against one key exactly the
// way two warm serverless instances do.

function makeStore() {
  return { kv: new Map<string, string>(), lists: new Map<string, string[]>() };
}

function makeClient(
  store: ReturnType<typeof makeStore>,
  opts: { throwOnGet?: boolean; noEval?: boolean } = {}
): OpsRedis {
  return {
    async get(key) {
      if (opts.throwOnGet) throw new Error('upstash unreachable');
      const raw = store.kv.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async set(key, value) {
      store.kv.set(key, JSON.stringify(value));
      return 'OK';
    },
    async del(key) {
      return store.kv.delete(key) ? 1 : 0;
    },
    async lpush(key, ...elements) {
      const list = store.lists.get(key) ?? [];
      for (const e of elements) list.unshift(JSON.stringify(e));
      store.lists.set(key, list);
      return list.length;
    },
    async ltrim(key, start, stop) {
      const list = store.lists.get(key) ?? [];
      store.lists.set(key, list.slice(start, stop + 1));
      return 'OK';
    },
    async lrange<T>(key: string, start: number, stop: number) {
      const list = store.lists.get(key) ?? [];
      return list.slice(start, stop + 1).map((s) => JSON.parse(s) as T);
    },
    async eval<TArgs extends unknown[], TData>(_script: string, keys: string[], args: TArgs) {
      if (opts.noEval) throw new Error('EVAL not permitted');
      // The Lua script's semantics: delete only if the stored setAt still matches.
      const raw = store.kv.get(keys[0]);
      if (raw === undefined) return 0 as TData;
      const obj = JSON.parse(raw) as { setAt?: number };
      if (obj.setAt !== Number(args[0])) return 0 as TData;
      store.kv.delete(keys[0]);
      return 1 as TData;
    },
  };
}

// ─── Break-glass precedence ──────────────────────────────────────────────────

test('OPS_FORCE_DOWN wins over a stored live value', () => {
  const stored = mode({ state: 'live', reason: '', until: null });
  const { mode: resolved } = resolveOpsMode(stored, NOW, true);
  assert.equal(resolved.state, 'down');
});

test('OPS_FORCE_DOWN wins over an unreachable store', () => {
  assert.equal(resolveOpsMode(null, NOW, true).mode.state, 'down');
});

test('a forced outage never reports an expiry to lift', () => {
  // Nothing may auto-lift a break-glass outage; only a redeploy clears it.
  const expiredDown = mode({ until: NOW - 1 });
  assert.equal(resolveOpsMode(expiredDown, NOW, true).expired, null);
});

// ─── Fail open — the safety property ─────────────────────────────────────────

test('a throwing Redis client resolves live', async () => {
  const client = makeClient(makeStore(), { throwOnGet: true });
  const resolved = await readOpsModeWith(client, NOW);
  assert.equal(resolved.state, 'live');
});

test('a throwing client resolves live even when a down state is stored', async () => {
  const store = makeStore();
  store.kv.set(OPS_MODE_KEY, JSON.stringify(mode()));
  const resolved = await readOpsModeWith(makeClient(store, { throwOnGet: true }), NOW);
  assert.equal(resolved.state, 'live');
});

test('a null client (no Upstash configured) resolves live', async () => {
  assert.equal((await readOpsModeWith(null, NOW)).state, 'live');
});

test('unparseable stored values resolve live rather than throwing', () => {
  for (const junk of [null, undefined, '', 'not json', '{}', '[]', 42, { state: 'sideways' }]) {
    assert.equal(resolveOpsMode(junk, NOW, false).mode.state, 'live', String(junk));
  }
});

// ─── Expiry ──────────────────────────────────────────────────────────────────

test('an until in the past resolves live and reports the expiry', () => {
  const stored = mode({ until: NOW - 1 });
  const { mode: resolved, expired } = resolveOpsMode(stored, NOW, false);
  assert.equal(resolved.state, 'live');
  assert.equal(expired?.setAt, stored.setAt);
});

test('an until in the future preserves the state', () => {
  const stored = mode({ until: NOW + 60_000 });
  const { mode: resolved, expired } = resolveOpsMode(stored, NOW, false);
  assert.equal(resolved.state, 'down');
  assert.equal(expired, null);
});

test('until exactly now has passed', () => {
  assert.equal(resolveOpsMode(mode({ until: NOW }), NOW, false).mode.state, 'live');
});

test('a null until never expires', () => {
  const { mode: resolved, expired } = resolveOpsMode(mode({ until: null }), NOW, false);
  assert.equal(resolved.state, 'down');
  assert.equal(expired, null);
});

test('degraded expires the same way down does', () => {
  const stored = mode({ state: 'degraded', until: NOW - 1 });
  assert.equal(resolveOpsMode(stored, NOW, false).mode.state, 'live');
});

// ─── Auto-lift is a logged state change ──────────────────────────────────────

test('a lift deletes the key and writes exactly one log entry', async () => {
  const store = makeStore();
  const expired = mode({ until: NOW - 1 });
  store.kv.set(OPS_MODE_KEY, JSON.stringify(expired));

  const won = await liftExpired(makeClient(store), expired, NOW);

  assert.equal(won, true);
  assert.equal(store.kv.has(OPS_MODE_KEY), false);

  const log = (store.lists.get(OPS_LOG_KEY) ?? []).map((s) => JSON.parse(s));
  assert.equal(log.length, 1);
  assert.equal(log[0].state, 'live');
  assert.equal(log[0].reason, AUTO_LIFT_REASON);
  assert.equal(log[0].liftedSetAt, expired.setAt);
});

test('two racing resolvers produce exactly one log entry', async () => {
  const store = makeStore();
  const expired = mode({ until: NOW - 1 });
  store.kv.set(OPS_MODE_KEY, JSON.stringify(expired));

  // Two warm instances, one shared key.
  const results = await Promise.all([
    liftExpired(makeClient(store), expired, NOW),
    liftExpired(makeClient(store), expired, NOW),
  ]);

  assert.deepEqual(results.filter(Boolean).length, 1, 'exactly one caller should win');
  assert.equal((store.lists.get(OPS_LOG_KEY) ?? []).length, 1);
});

test('the fallback path also logs exactly once when EVAL is unavailable', async () => {
  const store = makeStore();
  const expired = mode({ until: NOW - 1 });
  store.kv.set(OPS_MODE_KEY, JSON.stringify(expired));

  const results = await Promise.all([
    liftExpired(makeClient(store, { noEval: true }), expired, NOW),
    liftExpired(makeClient(store, { noEval: true }), expired, NOW),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((store.lists.get(OPS_LOG_KEY) ?? []).length, 1);
});

test('a lift does not clobber a manual write that landed first', async () => {
  const store = makeStore();
  const expired = mode({ until: NOW - 1, setAt: NOW - 5000 });
  // Someone set a fresh `down` between our read and our lift.
  const fresher = mode({ state: 'down', reason: 'Hotfix.', until: null, setAt: NOW });
  store.kv.set(OPS_MODE_KEY, JSON.stringify(fresher));

  const won = await liftExpired(makeClient(store), expired, NOW);

  assert.equal(won, false);
  const still = parseOpsMode(JSON.parse(store.kv.get(OPS_MODE_KEY)!));
  assert.equal(still?.reason, 'Hotfix.');
  assert.equal((store.lists.get(OPS_LOG_KEY) ?? []).length, 0);
});

test('the log is trimmed to OPS_LOG_MAX', async () => {
  const store = makeStore();
  store.lists.set(
    OPS_LOG_KEY,
    Array.from({ length: OPS_LOG_MAX + 20 }, (_, i) => JSON.stringify({ state: 'live', at: i }))
  );
  const expired = mode({ until: NOW - 1 });
  store.kv.set(OPS_MODE_KEY, JSON.stringify(expired));

  await liftExpired(makeClient(store), expired, NOW);

  assert.equal((store.lists.get(OPS_LOG_KEY) ?? []).length, OPS_LOG_MAX);
});

// ─── Retry-After derivation ──────────────────────────────────────────────────
// A flat 900 on a two-hour window tells clients to come back six times too
// early. The header is only worth serving if it is true.

test('Retry-After follows until, clamped to a sane band', () => {
  assert.equal(retryAfterSeconds(mode({ until: NOW + 30 * 60_000 }), NOW), 1800);
  assert.equal(retryAfterSeconds(mode({ until: NOW + 2 * 60 * 60_000 }), NOW), 3600, 'clamped up top');
  assert.equal(retryAfterSeconds(mode({ until: NOW + 5_000 }), NOW), 60, 'clamped at the bottom');
});

test('Retry-After falls back to 900 with no until', () => {
  assert.equal(retryAfterSeconds(mode({ until: null }), NOW), 900);
});

// ─── Parsing and normalisation ───────────────────────────────────────────────

test('parseOpsMode accepts both a JSON string and an object', () => {
  const m = mode();
  assert.equal(parseOpsMode(m)?.state, 'down');
  assert.equal(parseOpsMode(JSON.stringify(m))?.state, 'down');
});

test('parseOpsMode rejects an unknown state', () => {
  assert.equal(parseOpsMode({ state: 'exploded', setAt: 1 }), null);
});

test('a reason is trimmed and capped', () => {
  assert.equal(normalizeReason('  spaced  '), 'spaced');
  assert.equal(normalizeReason('x'.repeat(1000)).length, MAX_REASON_LENGTH);
  assert.equal(normalizeReason(undefined), '');
  assert.equal(normalizeReason(42), '');
});

test('parseLogEntry survives junk', () => {
  assert.equal(parseLogEntry('not json'), null);
  assert.equal(parseLogEntry({ state: 'nope' }), null);
  assert.equal(parseLogEntry({ state: 'live', at: 5 })?.at, 5);
});

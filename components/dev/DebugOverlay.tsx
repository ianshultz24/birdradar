'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { getTheme } from '@/lib/theme';
import {
  getDevSnapshot,
  getDevServerSnapshot,
  subscribeDev,
  type DebugSnapshot,
} from '@/lib/dev/client';

/**
 * Floating debug readout, mounted only for a verified dev session with
 * `showDebugBadges` on.
 *
 * ─── Where each number comes from, and why they arrive differently ───────────
 *
 * Cache tier, cache age, upstream eBird budget and per-IP rate limit are
 * genuinely **per request**, so they ride back on the eBird responses
 * themselves as `x-br-*` headers (`devDebugHeaders` in `lib/ebird-proxy.ts`)
 * and are captured by `recordDebugHeaders`. A poll would only ever show a
 * number from some adjacent moment and quietly invite you to attribute it to
 * the request you were actually looking at.
 *
 * The ORS circuit breaker has no per-request existence — it is a
 * deployment-wide latch that changes only when a drive-time call happens, which
 * may have been minutes ago or never. Polling is the right shape for that one,
 * so it comes from `/api/dev/debug`.
 *
 * ─── The dash is a value ─────────────────────────────────────────────────────
 *
 * Every field renders `—` when the number is genuinely unknown, and never `0`.
 * A Redis-tier cache hit has no recoverable age (the stored value shape is
 * unchanged on purpose), and an unreachable Upstash has no budget count. This
 * is the rule `PhaseE1_fixes.md` §4e set for the odds chip — *"an unscored
 * species must never borrow the look of a scored one"* — applied to the surface
 * whose entire job is to be believed.
 *
 * ─── Sensitive species (spec §9) ─────────────────────────────────────────────
 *
 * Nothing here renders observation data. No coordinates, no location names, no
 * `locId`s — counters, tiers and booleans only. `lib/location-privacy.ts` is
 * neither imported nor bypassed by any path that reaches this component.
 */

interface OrsDebug {
  configured: boolean;
  blocked: boolean | null;
  blockedForMs: number | null;
  dailyUsed: number | null;
  dailyBudget: number;
}

const ORS_POLL_MS = 30_000;

function dash(v: number | null | undefined, suffix = ''): string {
  return v === null || v === undefined ? '—' : `${v}${suffix}`;
}

function formatAge(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export default function DebugOverlay({ lightMode }: { lightMode: boolean }) {
  const t = getTheme(lightMode);
  const snapshot = useSyncExternalStore(subscribeDev, getDevSnapshot, getDevServerSnapshot);
  const [ors, setOrs] = useState<OrsDebug | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const active = snapshot.session === 'active' && snapshot.flags.showDebugBadges;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/dev/debug', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (!cancelled) setOrs(body.ors as OrsDebug);
      } catch {
        // Leave the last reading up rather than blanking the panel on one blip.
      }
    };

    void poll();
    const id = setInterval(poll, ORS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  if (!active) return null;

  const d: DebugSnapshot | null = snapshot.debug;

  const breaker =
    ors === null
      ? '—'
      : !ors.configured
        ? 'no key'
        : ors.blocked === null
          ? '—'
          : ors.blocked
            ? `OPEN${ors.blockedForMs ? ` ${Math.ceil(ors.blockedForMs / 1000)}s` : ''}`
            : 'closed';

  const breakerColor =
    ors?.blocked === true ? (lightMode ? '#B91C1C' : '#F87171') : t.fg2;

  return (
    <div
      style={{
        position: 'fixed',
        left: 10,
        top: 10,
        zIndex: 4001,
        minWidth: collapsed ? 0 : 210,
        background: t.cardBg,
        border: `1px solid ${t.line2}`,
        borderLeft: `3px solid ${t.accent}`,
        borderRadius: 8,
        boxShadow: t.shadowLg,
        fontFamily: t.mono,
        fontSize: 10.5,
        color: t.fg2,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: collapsed ? 'none' : `1px solid ${t.line1}`,
          padding: '6px 9px',
          cursor: 'pointer',
          color: t.accent,
          fontFamily: t.mono,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.06em',
        }}
        aria-expanded={!collapsed}
      >
        DEV {collapsed ? '▸' : '▾'}
      </button>

      {!collapsed && (
        <div style={{ padding: '7px 9px', display: 'grid', gap: 3 }}>
          <Row label="cache" value={d?.tier ?? '—'} t={t} />
          <Row label="age" value={formatAge(d?.ageMs ?? null)} t={t} />
          <Row
            label="ebird"
            value={
              d ? `${dash(d.budgetRemaining)}/${dash(d.budgetMax)}` : '—'
            }
            t={t}
          />
          <Row
            label="rate/ip"
            value={d ? `${dash(d.rateRemaining)}/${dash(d.rateMax)}` : '—'}
            t={t}
          />
          <Row label="ors" value={breaker} valueColor={breakerColor} t={t} />
          <Row
            label="ors/day"
            value={ors ? `${dash(ors.dailyUsed)}/${ors.dailyBudget}` : '—'}
            t={t}
          />
          {snapshot.flags.cacheBypass && (
            <div
              style={{
                marginTop: 3,
                paddingTop: 5,
                borderTop: `1px solid ${t.line1}`,
                color: lightMode ? '#B45309' : '#FBBF24',
                fontSize: 9.5,
                lineHeight: 1.35,
              }}
            >
              cache bypass ON — still spends eBird budget
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  valueColor,
  t,
}: {
  label: string;
  value: string;
  valueColor?: string;
  t: ReturnType<typeof getTheme>;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: t.fg3 }}>{label}</span>
      <span style={{ color: valueColor ?? t.fg1, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

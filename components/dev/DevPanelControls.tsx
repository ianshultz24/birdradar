'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { getTheme, text, type Theme } from '@/lib/theme';
import { setDevFlags } from '@/lib/dev/client';
import type { DevFlags } from '@/lib/dev/flags';
import type { OpsLogEntry, OpsMode, OpsState } from '@/lib/ops/state';

/**
 * The interactive half of `/dev`. The page itself is a server component that
 * reads the ops state and the audit log; this renders and writes.
 *
 * ─── Auto-lift defaults to 2h, and that is the whole design ──────────────────
 *
 * Spec §5: *"Default the auto-lift to 2h — I should have to deliberately opt out
 * of it, not deliberately opt in."* The failure this prevents is a site left
 * `down` overnight because someone got distracted between flipping the switch
 * and flipping it back. "None" is a real option and it is one click away; it is
 * simply not the resting state of the form.
 *
 * ─── The confirm step ────────────────────────────────────────────────────────
 *
 * A second, explicit click before any write. This is the one control in the app
 * that can take the whole site off the internet, and it sits next to a radio
 * group. The confirm shows the exact sentence about to take effect, so the thing
 * being agreed to is the outcome rather than the button.
 *
 * ─── Why the propagation lag is written on the screen ────────────────────────
 *
 * `writeOpsMode()` busts the *local* module cache, so this panel is correct
 * immediately. Other warm serverless instances keep their own 15 s cache
 * (`OPS_CACHE_TTL_MS`) and converge within it. Without that sentence on screen,
 * the first thing anyone does when a confirm feels slow is press it again — and
 * a double toggle on a maintenance switch is a bad habit to teach.
 */

interface Props {
  initialMode: OpsMode;
  initialLog: OpsLogEntry[];
  initialFlags: DevFlags;
  storeConfigured: boolean;
  forceDownActive: boolean;
  lightMode: boolean;
}

const AUTO_LIFT_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: '30 minutes', minutes: 30 },
  { label: '2 hours', minutes: 120 },
  { label: '6 hours', minutes: 360 },
  { label: 'None — stays down until I change it', minutes: null },
];

const STATE_COPY: Record<OpsState, { label: string; blurb: string }> = {
  live: { label: 'Live', blurb: 'Normal service. No banner.' },
  degraded: {
    label: 'Degraded',
    blurb: 'Site works normally, with a banner carrying your reason. Blocks nothing.',
  },
  down: {
    label: 'Down',
    blurb: 'Public visitors get a 503 maintenance page. You keep full access.',
  },
};

export default function DevPanelControls({
  initialMode,
  initialLog,
  initialFlags,
  storeConfigured,
  forceDownActive,
  lightMode,
}: Props) {
  const t = getTheme(lightMode);
  const router = useRouter();

  const [state, setState] = useState<OpsState>(initialMode.state);
  const [reason, setReason] = useState(initialMode.reason);
  // Spec §5: 2h is the resting value, so opting out is the deliberate act.
  const [autoLift, setAutoLift] = useState<number | null>(120);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [log, setLog] = useState(initialLog);
  const [flags, setFlags] = useState<DevFlags>(initialFlags);

  // A change to the selection invalidates a pending confirmation — otherwise the
  // sentence shown in the confirm step can describe a state other than the one
  // the button is about to write.
  useEffect(() => {
    setConfirming(false);
  }, [state, reason, autoLift]);

  const dirty =
    state !== initialMode.state || reason.trim() !== initialMode.reason.trim();

  async function commit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/dev/ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state,
          reason,
          // The server turns this into an absolute `until`, so this browser's
          // clock never decides when the site comes back up.
          autoLiftMinutes: state === 'live' ? null : autoLift,
        }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setMessage({
          kind: 'err',
          text: (body as { error?: string } | null)?.error ?? `Failed (${res.status})`,
        });
        return;
      }

      setLog(((body as { log?: OpsLogEntry[] }).log ?? []) as OpsLogEntry[]);
      setMessage({
        kind: 'ok',
        text: `Now ${state}. Other instances pick this up within 15 seconds.`,
      });
      setConfirming(false);
      router.refresh();
    } catch {
      setMessage({ kind: 'err', text: 'Could not reach the server. Nothing was changed.' });
    } finally {
      setBusy(false);
    }
  }

  function toggleFlag(key: keyof DevFlags) {
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next);
    setDevFlags(next);
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {forceDownActive && (
        <Callout t={t} tone="warn" lightMode={lightMode}>
          <strong>OPS_FORCE_DOWN=1 is set.</strong> The env var outranks everything below,
          so the site is down regardless of what you choose here. Clearing it needs a
          redeploy, not a toggle — that is the point of a break-glass.
        </Callout>
      )}

      {!storeConfigured && (
        <Callout t={t} tone="warn" lightMode={lightMode}>
          <strong>No Redis on this deployment.</strong> There is nowhere to store an ops
          state, so writes below will fail and the site always resolves to{' '}
          <code>live</code>. Use <code>OPS_FORCE_DOWN=1</code> instead.
        </Callout>
      )}

      {/* ─── Site status ─────────────────────────────────────────────────── */}
      <Section t={t} title="SITE STATUS">
        <div style={{ display: 'grid', gap: 8 }}>
          {(Object.keys(STATE_COPY) as OpsState[]).map((s) => (
            <label
              key={s}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                background: state === s ? t.accentBg : 'transparent',
                border: `1px solid ${state === s ? t.accentBorder : t.line2}`,
              }}
            >
              <input
                type="radio"
                name="ops-state"
                checked={state === s}
                onChange={() => setState(s)}
                style={{ marginTop: 2, accentColor: t.accent }}
              />
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    ...text.rowTitle(t),
                    display: 'block',
                    color: state === s ? t.accent : t.fg0,
                  }}
                >
                  {STATE_COPY[s].label}
                </span>
                <span style={{ ...text.rowMeta(t), display: 'block' }}>
                  {STATE_COPY[s].blurb}
                </span>
              </span>
            </label>
          ))}
        </div>

        <label
          htmlFor="ops-reason"
          style={{ ...text.microCaps(t), display: 'block', margin: '16px 0 6px' }}
        >
          REASON — SHOWN TO VISITORS
        </label>
        <textarea
          id="ops-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="Upgrading the sightings pipeline."
          style={{
            ...text.body(t),
            width: '100%',
            boxSizing: 'border-box',
            padding: '9px 11px',
            borderRadius: 8,
            border: `1px solid ${t.line3}`,
            background: t.bg1,
            color: t.fg0,
            resize: 'vertical',
            outline: 'none',
          }}
        />

        {state !== 'live' && (
          <>
            <label
              htmlFor="ops-autolift"
              style={{ ...text.microCaps(t), display: 'block', margin: '14px 0 6px' }}
            >
              AUTO-LIFT AFTER
            </label>
            <select
              id="ops-autolift"
              value={autoLift === null ? 'none' : String(autoLift)}
              onChange={(e) =>
                setAutoLift(e.target.value === 'none' ? null : Number(e.target.value))
              }
              style={{
                ...text.body(t),
                width: '100%',
                padding: '9px 11px',
                borderRadius: 8,
                border: `1px solid ${autoLift === null ? t.line3 : t.accentBorder}`,
                background: t.bg1,
                color: t.fg0,
              }}
            >
              {AUTO_LIFT_OPTIONS.map((o) => (
                <option key={o.label} value={o.minutes === null ? 'none' : String(o.minutes)}>
                  {o.label}
                </option>
              ))}
            </select>
            {autoLift === null && (
              <p
                style={{
                  ...text.rowMeta(t),
                  margin: '6px 0 0',
                  color: lightMode ? '#B45309' : '#FBBF24',
                }}
              >
                Nothing will bring the site back except you.
              </p>
            )}
          </>
        )}

        {/* ─── Confirm ───────────────────────────────────────────────────── */}
        <div style={{ marginTop: 18 }}>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={busy || (!dirty && state === initialMode.state)}
              style={{
                ...text.control(t),
                padding: '9px 16px',
                borderRadius: 8,
                border: `1px solid ${t.accentBorder}`,
                background: t.accentBg,
                color: t.accent,
                cursor: 'pointer',
                opacity: !dirty && state === initialMode.state ? 0.55 : 1,
              }}
            >
              Apply…
            </button>
          ) : (
            <div
              style={{
                padding: 14,
                borderRadius: 8,
                border: `1px solid ${t.line3}`,
                background: t.bg2,
              }}
            >
              <p style={{ ...text.body(t), margin: '0 0 12px' }}>
                {state === 'down'
                  ? 'Every visitor without a dev cookie will get a 503 maintenance page'
                  : state === 'degraded'
                    ? 'Every visitor will see a banner; nothing will be blocked'
                    : 'The site returns to normal service'}
                {state !== 'live' && autoLift !== null
                  ? `, lifting automatically after ${
                      AUTO_LIFT_OPTIONS.find((o) => o.minutes === autoLift)?.label
                    }`
                  : ''}
                .
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={commit}
                  disabled={busy}
                  style={{
                    ...text.control(t),
                    padding: '9px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: t.accent,
                    color: t.accentFg,
                    cursor: busy ? 'default' : 'pointer',
                  }}
                >
                  {busy ? 'Applying…' : `Yes, set ${state}`}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  style={{
                    ...text.control(t),
                    padding: '9px 16px',
                    borderRadius: 8,
                    border: `1px solid ${t.line3}`,
                    background: 'transparent',
                    color: t.fg2,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {message && (
          <p
            style={{
              ...text.rowMeta(t),
              margin: '12px 0 0',
              color:
                message.kind === 'ok'
                  ? t.accent
                  : lightMode
                    ? '#B91C1C'
                    : '#F87171',
            }}
          >
            {message.text}
          </p>
        )}

        <p style={{ ...text.caption(t), margin: '12px 0 0', textAlign: 'left' }}>
          This panel is correct immediately. Other warm instances cache the ops state for
          up to 15 seconds, so give it a moment before pressing anything twice.
        </p>
      </Section>

      {/* ─── Debug overlays ──────────────────────────────────────────────── */}
      <Section t={t} title="DEBUG OVERLAYS">
        <FlagRow
          t={t}
          label="Cache bypass"
          hint="Sends x-dev-nocache on eBird requests; both cache tiers are skipped. Still spends the shared upstream budget — it is a debugging tool, not a free refresh."
          on={flags.cacheBypass}
          onToggle={() => toggleFlag('cacheBypass')}
        />
        <FlagRow
          t={t}
          label="Debug badges"
          hint="Floating overlay: cache tier and age, remaining eBird budget, remaining per-IP rate limit, ORS breaker state."
          on={flags.showDebugBadges}
          onToggle={() => toggleFlag('showDebugBadges')}
        />
        <FlagRow
          t={t}
          label="Analytics capture"
          hint="Off by default for a dev session, so your own testing does not inflate the usage numbers. Turn on only when you are deliberately testing events."
          on={flags.analytics}
          onToggle={() => toggleFlag('analytics')}
        />
        <p style={{ ...text.caption(t), margin: '10px 0 0', textAlign: 'left' }}>
          Stored in the <code>br_dev_flags</code> cookie. The server ignores it entirely
          unless <code>br_dev</code> verifies, so it is a preference, never a permission.
        </p>
      </Section>

      {/* ─── Audit log ───────────────────────────────────────────────────── */}
      <Section t={t} title={`RECENT TOGGLES (${log.length})`}>
        {log.length === 0 ? (
          <p style={{ ...text.emptyState(t), margin: 0 }}>Nothing recorded yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {log.map((e, i) => (
              <div
                key={`${e.at}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  padding: '6px 0',
                  borderBottom: i === log.length - 1 ? 'none' : `1px solid ${t.line1}`,
                }}
              >
                <span
                  style={{
                    ...text.actionPill(t),
                    flexShrink: 0,
                    background: e.state === 'live' ? t.accentBg : t.bg2,
                    color: e.state === 'live' ? t.accent : t.fg1,
                    border: `1px solid ${t.line2}`,
                  }}
                >
                  {e.state}
                </span>
                <span style={{ ...text.rowMeta(t), flex: 1, minWidth: 0 }}>
                  {e.reason || <span style={{ color: t.fg3 }}>no reason given</span>}
                </span>
                <span style={{ ...text.metaChip(t), flexShrink: 0 }}>
                  {new Date(e.at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ─── Session ─────────────────────────────────────────────────────── */}
      <Section t={t} title="SESSION">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a
            href="/maintenance"
            style={{
              ...text.control(t),
              padding: '8px 14px',
              borderRadius: 8,
              border: `1px solid ${t.line3}`,
              color: t.fg1,
              textDecoration: 'none',
            }}
          >
            Preview maintenance page
          </a>
          <button
            onClick={async () => {
              await fetch('/api/dev/lock', { method: 'POST' });
              router.refresh();
            }}
            style={{
              ...text.control(t),
              padding: '8px 14px',
              borderRadius: 8,
              border: `1px solid ${t.line3}`,
              background: 'transparent',
              color: t.fg1,
              cursor: 'pointer',
            }}
          >
            Lock
          </button>
        </div>
        <p style={{ ...text.caption(t), margin: '10px 0 0', textAlign: 'left' }}>
          Lock clears the cookie in this browser. It does not revoke the token — rotating{' '}
          <code>DEV_MODE_SECRET</code> is the only kill switch, and on Vercel that needs a
          redeploy.
        </p>
      </Section>
    </div>
  );
}

// ─── Presentational helpers ──────────────────────────────────────────────────

function Section({
  t,
  title,
  children,
}: {
  t: Theme;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: t.cardBg,
        border: `1px solid ${t.line2}`,
        borderRadius: 12,
        padding: 20,
      }}
    >
      <h2 style={{ ...text.microCaps(t), margin: '0 0 14px' }}>{title}</h2>
      {children}
    </section>
  );
}

function Callout({
  t,
  tone,
  lightMode,
  children,
}: {
  t: Theme;
  tone: 'warn';
  lightMode: boolean;
  children: React.ReactNode;
}) {
  const accent = lightMode ? '#B45309' : '#FBBF24';
  return (
    <div
      style={{
        ...text.rowMeta(t),
        color: t.fg1,
        background: lightMode ? 'rgba(180,83,9,0.06)' : 'rgba(251,191,36,0.08)',
        border: `1px solid ${accent}33`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        padding: '10px 12px',
        lineHeight: 1.5,
      }}
      data-tone={tone}
    >
      {children}
    </div>
  );
}

function FlagRow({
  t,
  label,
  hint,
  on,
  onToggle,
}: {
  t: Theme;
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '9px 0',
        borderBottom: `1px solid ${t.line1}`,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={onToggle}
        style={{ marginTop: 3, accentColor: t.accent }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ ...text.rowTitle(t), display: 'block' }}>{label}</span>
        <span style={{ ...text.rowMeta(t), display: 'block', lineHeight: 1.45 }}>{hint}</span>
      </span>
    </label>
  );
}

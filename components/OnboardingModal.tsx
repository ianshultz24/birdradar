'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getTheme, type Theme } from '@/lib/theme';
import { legendRows, pinSearchGlyph } from '@/lib/marker-style';
import { LegendEntry, MarkerSwatch } from '@/components/MapLegend';
import { BellIcon, SettingsIcon, XIcon, CrosshairIcon } from '@/components/Icons';

/**
 * First-visit intro. Four steps, skippable at any point, re-openable from the
 * `?` button on the map.
 *
 * ─── Where the artwork comes from ────────────────────────────────────────────
 *
 * Step 1's swatches are `legendRows()` + `LegendEntry`, and step 2's crosshair is
 * `pinSearchGlyph()` through `MarkerSwatch` — the same descriptors the real
 * Leaflet icons are built from (lib/marker-style.ts). Hand-drawing them here is
 * exactly the drift that put light-mode greens in the dark-mode legend before
 * Phase C, and an onboarding screen that teaches the wrong glyph is worse than
 * no onboarding screen.
 *
 * ─── Why it does not own the "has seen" flag ─────────────────────────────────
 *
 * app/page.tsx decides whether to mount this, and writes the flag when it
 * closes. That keeps the ordering constraint in one place: on a first visit the
 * geolocation permission request must not fire until this is dismissed. A
 * browser permission sheet stacked behind an unread modal is how permissions get
 * denied by reflex, and a denied permission is not re-askable from the page.
 */

interface Props {
  lightMode: boolean;
  isMobile: boolean;
  /** Low battery / reduced motion — drops blur and transitions, as MapControls
   *  and MapLegend do. */
  lowFi: boolean;
  onClose: () => void;
}

interface Step {
  title: string;
  body: string;
  render: (t: Theme, lightMode: boolean) => React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: 'A radar for birds you haven’t seen',
    body:
      'BirdRadar plots recent eBird reports around you and ranks them against your life list. ' +
      'Shape and size carry the meaning — colour is the last cue, never the only one.',
    render: (t, lightMode) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {legendRows(lightMode)
          .filter((r) => r.section === 'sightings')
          .map((row) => (
            <LegendEntry key={row.id} row={row} t={t} pulseEnabled={false} />
          ))}
      </div>
    ),
  },
  {
    title: 'Search anywhere, not just here',
    body:
      'Hit “Pick a Spot” on the map, then tap where you want to look. The crosshair searches ' +
      'up to 50 km around that point — scout a weekend trip before you drive it.',
    render: (t) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <MarkerSwatch glyph={pinSearchGlyph()} />
        <div style={{ fontSize: 12, color: t.fg1, lineHeight: 1.35 }}>
          Your custom search pin
          <div style={{ fontSize: 10.5, color: t.fg3, marginTop: 1 }}>
            Clear it any time to go back to your own area
          </div>
        </div>
      </div>
    ),
  },
  {
    title: 'Alerts, and your list on every device',
    body:
      'Settings can notify you when a lifer turns up nearby — including with BirdRadar closed. ' +
      'A sync code copies your life list to another device. No account, just a code.',
    render: (t) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <IntroRow t={t} icon={<BellIcon size={15} style={{ color: t.accent }} />}
          label="Lifer alerts" detail="Within 10 mi of where you’re watching" />
        <IntroRow t={t} icon={<CrosshairIcon size={15} style={{ color: t.accent }} />}
          label="Sync code" detail="Settings → Sync Across Devices" />
      </div>
    ),
  },
  {
    title: 'Two settings worth knowing',
    body:
      'Low battery mode is on by default and stops marker animations. Precise location decides ' +
      'whether BirdRadar uses your exact GPS fix or a rough area from your connection.',
    render: (t) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <IntroRow t={t} icon={<SettingsIcon size={15} style={{ color: t.accent }} />}
          label="Low battery mode" detail="Map Display — animations off" />
        <IntroRow t={t} icon={<SettingsIcon size={15} style={{ color: t.accent }} />}
          label="Precise location" detail="Search — on by default" />
      </div>
    ),
  },
];

function IntroRow({ t, icon, label, detail }: {
  t: Theme; icon: React.ReactNode; label: string; detail: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <span style={{ width: 30, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: t.fg1, fontWeight: 500, lineHeight: 1.25 }}>{label}</div>
        <div style={{ fontSize: 10.5, color: t.fg3, lineHeight: 1.3, marginTop: 1 }}>{detail}</div>
      </div>
    </div>
  );
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function OnboardingModal({ lightMode, isMobile, lowFi, onClose }: Props) {
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const t = getTheme(lightMode);

  const last = step === STEPS.length - 1;
  const current = STEPS[step];

  const close = useCallback(() => onClose(), [onClose]);

  // Esc closes, Tab cycles inside the card. Without the trap, tabbing walks into
  // the map and the sidebar underneath — which are inert to the user but very
  // much reachable by a keyboard.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const nodes = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !cardRef.current?.contains(active))) {
        e.preventDefault();
        lastNode.focus();
      } else if (!e.shiftKey && active === lastNode) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close]);

  // Move focus in on mount so the trap above has somewhere to start.
  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, []);

  const btnBase: React.CSSProperties = {
    padding: '9px 16px', borderRadius: 8,
    fontSize: 13, fontWeight: 600, fontFamily: t.sans,
    cursor: 'pointer', transition: lowFi ? undefined : 'all 0.15s',
  };

  return (
    <div
      // Backdrop. `zIndex` clears MapControls (1001) and the mobile tab bar
      // (1200); the toasts at 9999 are transient and deliberately still on top.
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: lightMode ? 'rgba(17,24,39,0.32)' : 'rgba(0,0,0,0.58)',
        backdropFilter: lowFi ? undefined : 'blur(2px)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to BirdRadar"
        style={{
          width: isMobile ? '100%' : 'min(100%, 430px)',
          maxHeight: isMobile ? '88vh' : '86vh',
          display: 'flex', flexDirection: 'column',
          background: t.cardBg,
          border: `1px solid ${t.line2}`,
          borderRadius: isMobile ? '14px 14px 0 0' : 14,
          boxShadow: t.shadowLg,
          overflow: 'hidden',
          fontFamily: t.sans,
        }}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '15px 16px 0 18px', flexShrink: 0,
        }}>
          <svg width="20" height="20" viewBox="0 0 26 26" fill="none" aria-hidden>
            <circle cx="13" cy="13" r="12" stroke={t.accent} strokeWidth="1.5" />
            <circle cx="13" cy="13" r="6.5" stroke={t.accent} strokeWidth="1" opacity="0.4" />
            <circle cx="13" cy="13" r="2.5" fill={t.accent} />
          </svg>
          <span style={{
            flex: 1, fontSize: 13, fontWeight: 700, fontFamily: t.display,
            letterSpacing: '-0.02em', color: t.fg0,
          }}>
            BirdRadar
          </span>
          <span style={{ fontSize: 10.5, fontFamily: t.mono, color: t.fg3 }}>
            {step + 1} / {STEPS.length}
          </span>
          <button
            onClick={close}
            aria-label="Close intro"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: t.fg3, padding: 2, display: 'flex', alignItems: 'center',
            }}
          >
            <XIcon size={15} />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '14px 18px 4px', overflowY: 'auto', flex: 1 }}>
          <h2 style={{
            margin: 0, fontSize: 19, fontWeight: 700, fontFamily: t.display,
            letterSpacing: '-0.02em', color: t.fg0, lineHeight: 1.2,
          }}>
            {current.title}
          </h2>
          <p style={{
            margin: '8px 0 14px', fontSize: 12.5, color: t.fg2, lineHeight: 1.5,
          }}>
            {current.body}
          </p>
          <div style={{
            background: t.bg0, border: `1px solid ${t.line2}`,
            borderRadius: 10, padding: '12px 13px',
          }}>
            {current.render(t, lightMode)}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: isMobile ? '14px 18px calc(16px + env(safe-area-inset-bottom))' : '14px 18px 16px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 5, flex: 1 }} aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} style={{
                width: i === step ? 14 : 6, height: 6, borderRadius: 3,
                background: i === step ? t.accent : t.line3,
                transition: lowFi ? undefined : 'all 0.2s',
              }} />
            ))}
          </div>

          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              style={{ ...btnBase, background: 'transparent', border: `1px solid ${t.line2}`, color: t.fg2 }}
            >
              Back
            </button>
          )}
          {!last && (
            <button
              onClick={close}
              style={{ ...btnBase, background: 'transparent', border: 'none', color: t.fg3 }}
            >
              Skip
            </button>
          )}
          <button
            onClick={() => (last ? close() : setStep((s) => s + 1))}
            style={{
              ...btnBase,
              background: t.accent, border: `1px solid ${t.accent}`, color: t.accentFg,
            }}
          >
            {last ? 'Start birding' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

import { getTheme, text } from '@/lib/theme';
import { XIcon } from '@/components/Icons';
import { DETAIL_PANEL_WIDTH } from '@/components/SpeciesDetailPanel';

/**
 * Site-wide notice for the `degraded` ops state, and for a developer who is
 * bypassing a `down` state.
 *
 * ─── Two states, one component, because they are the same object ─────────────
 *
 * Both say "the app you are looking at is not behaving normally, and here is
 * why". They differ in tone (`degraded` is a warning to everyone; the bypass
 * notice is a reminder to one person) and in dismissibility, and nothing else.
 * Two components would be two places for the placement rules below to drift.
 *
 * ─── Placement, and the slot it must not take ────────────────────────────────
 *
 * **Not the bottom-centre band.** `app/page.tsx` renders the "Couldn't get your
 * location" notice there at `bottom: 24` (measured at y≈776 on desktop), and
 * `PhaseE2_rationale.md` §5.1 records `DonationBanner` being suppressed against
 * it for exactly that reason. Stacking a third thing in that band is how two of
 * them end up on top of each other on a short viewport.
 *
 * So: top of the map column, at `top: 52`, clearing the `StatusBar` chip at
 * `top: 12`. That is the same band `DonationBanner` uses on mobile — which is
 * why `app/page.tsx` suppresses the donation prompt whenever this is up, the
 * same way it already suppresses it against `locationNotice`.
 *
 * ─── Why it reads DETAIL_PANEL_WIDTH ─────────────────────────────────────────
 *
 * A full-width strip would run under the species / hotspot panel, which sits at
 * `zIndex: 1002` — above this. Invariant #3 of
 * `PhaseE1_bugfix_panels_order_pills.md`: that constant is the single source for
 * the panel's width and is already read by `MapControls` and `DonationBanner`. A
 * local `340` here would drift, and only while a panel is open, so it would be
 * found late.
 */

interface Props {
  /** Copy comes from the operator's reason string; may be empty. */
  reason: string;
  /**
   * `degraded` — everyone sees it, it is a warning.
   * `bypass`   — only a verified dev sees it; the site is down for everyone else.
   */
  variant: 'degraded' | 'bypass';
  lightMode: boolean;
  isMobile: boolean;
  lowFi: boolean;
  /** The union of both right-hand panels, as Map.tsx derives it. */
  rightPanelOpen: boolean;
  onDismiss?: () => void;
}

export default function DegradedBanner({
  reason,
  variant,
  lightMode,
  isMobile,
  lowFi,
  rightPanelOpen,
  onDismiss,
}: Props) {
  const t = getTheme(lightMode);

  const [entered, setEntered] = useState(lowFi);
  useEffect(() => {
    if (lowFi) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [lowFi]);

  const isBypass = variant === 'bypass';

  // Amber for degraded, accent for the dev bypass. Deliberately not tier red —
  // `PhaseC_rationale.md` §11 records that red encodes "eBird notable" and is
  // load-bearing; a red strip across the top of the map would read as a
  // sighting-tier signal.
  const accent = isBypass ? t.accent : lightMode ? '#B45309' : '#FBBF24';
  const tint = isBypass
    ? t.accentBg
    : lightMode
      ? 'rgba(180,83,9,0.06)'
      : 'rgba(251,191,36,0.08)';

  const headline = isBypass ? 'Maintenance mode — visible only to you' : 'Limited service';

  return (
    <div
      role="status"
      aria-label={headline}
      style={{
        position: 'absolute',
        top: 52,
        left: 10,
        right: 10 + (!isMobile && rightPanelOpen ? DETAIL_PANEL_WIDTH : 0),
        zIndex: 1001,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: t.cardBg,
        border: `1px solid ${t.line2}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        padding: '9px 12px',
        boxShadow: t.shadowLg,
        backdropFilter: lowFi ? undefined : 'blur(8px)',
        opacity: entered ? 1 : 0,
        transform: entered ? 'none' : 'translateY(-8px)',
        transition: lowFi
          ? undefined
          : 'opacity 0.2s, transform 0.2s, right 0.24s cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      <span
        style={{
          flexShrink: 0,
          padding: '2px 7px',
          borderRadius: 4,
          background: tint,
          border: `1px solid ${accent}33`,
          color: accent,
          fontFamily: t.mono,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.06em',
          whiteSpace: 'nowrap',
        }}
      >
        {isBypass ? 'DEV' : 'NOTICE'}
      </span>

      <span style={{ ...text.rowMeta(t), flex: 1, minWidth: 0, color: t.fg1 }}>
        <strong style={{ fontWeight: 600 }}>{headline}</strong>
        {reason ? <span style={{ color: t.fg2 }}> — {reason}</span> : null}
      </span>

      {/* `degraded` is dismissible because it does not block anything and the
          poll would otherwise re-assert it on every visibility change. The
          bypass notice is not: it is the only thing telling a developer that
          what they are looking at is invisible to everyone else, and dismissing
          that is how you forget the site is down. */}
      {onDismiss && !isBypass && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss notice"
          style={{
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: t.fg3,
            padding: 2,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <XIcon size={14} />
        </button>
      )}
    </div>
  );
}

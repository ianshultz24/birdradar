'use client';

import { useEffect, useState } from 'react';

import { getTheme } from '@/lib/theme';
import { donationUrl } from '@/lib/donation';
import { XIcon } from '@/components/Icons';
import { DETAIL_PANEL_WIDTH } from '@/components/SpeciesDetailPanel';

/**
 * Non-blocking donation prompt for Eastside Audubon.
 *
 * ─── Why it does not own the decision to appear ──────────────────────────────
 *
 * Same division as OnboardingModal: app/page.tsx decides whether to mount this,
 * writes the snooze and fires the PostHog events. This component renders and
 * reports two clicks. Keeping the policy at one call site is what stops "never
 * during the first session" from being enforced in two places that can disagree.
 *
 * ─── Why it is not a dialog ──────────────────────────────────────────────────
 *
 * `role="status"`, no backdrop, no focus trap, no Escape handler, and it never
 * moves focus. The brief asks for a banner, not a modal — an ask for money that
 * seizes the keyboard while someone is reading a map is the thing being avoided.
 * That also means it must not be the OnboardingModal shell with the backdrop
 * removed: it deliberately shares none of it.
 *
 * ─── Placement, which differs by breakpoint on purpose ───────────────────────
 *
 * The map's bottom band is already fully occupied: MapLegend's chip sits at
 * `left: 10` and MapControls' button stack at `right: 10`, both at
 * `bottom: isMobile ? 86 : 30` and both at `zIndex: 1001`.
 *
 *   - **Desktop** has ~1540 px between them, so a centred banner at the same
 *     offset clears both, including the legend expanded to its 268 px cap.
 *   - **Mobile has no such gap** — those two controls span the whole width — so a
 *     centred bottom banner would land on top of them. It goes to the top of the
 *     map column instead, under the StatusBar chip at `top: 12`, which is the only
 *     unoccupied band on that layout.
 *
 * There is no map-corner attribution to collide with in either case:
 * `attributionControl={false}` (components/Map.tsx) moved the Stadia / OSM and
 * OpenRouteService credits into Settings → Credits in Phase C, and this banner
 * renders inside the map column and cannot reach the sidebar. That is a licensing
 * obligation, so it was checked rather than assumed.
 *
 * ─── Why it steps aside for a right-hand panel ───────────────────────────────
 *
 * Measured, not predicted: with a species panel open at 1463 px the banner's
 * right edge overlapped it by 17 px and the panel (`zIndex: 1002`) clipped the
 * dismiss button. Centring inside the map column is not the same as centring
 * inside the *visible* map once a 340 px column is laid over it.
 *
 * So it shifts by half of `DETAIL_PANEL_WIDTH`, which re-centres it in what is
 * left — the same move `MapControls` makes with the same import
 * (`right: DETAIL_PANEL_WIDTH + 10`, components/Map.tsx:1205). That export is the
 * single source for the panel's width by standing invariant; a local `340` here
 * would drift the first time the panel is resized, and only while a panel is open,
 * so it would be found late.
 */

interface Props {
  lightMode: boolean;
  isMobile: boolean;
  /** Low battery / reduced motion — drops the entrance transition, as
   *  MapControls, MapLegend and OnboardingModal do. */
  lowFi: boolean;
  /** A species or hotspot panel is open. Desktop only — on mobile those are
   *  bottom sheets and this banner is at the top, so they never meet. */
  rightPanelOpen: boolean;
  /** Fires alongside the anchor's navigation — this does NOT preventDefault. */
  onDonate: () => void;
  onDismiss: () => void;
}

export default function DonationBanner({
  lightMode, isMobile, lowFi, rightPanelOpen, onDonate, onDismiss,
}: Props) {
  const t = getTheme(lightMode);
  const [hovDonate, setHovDonate] = useState(false);

  // Fade in on mount. Reduced motion starts at the resting position.
  const [entered, setEntered] = useState(lowFi);
  useEffect(() => {
    if (lowFi) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [lowFi]);

  // Half the panel width, so the banner re-centres in the map that is still
  // visible rather than in the map the panel is covering.
  const shift = !isMobile && rightPanelOpen ? DETAIL_PANEL_WIDTH / 2 : 0;

  const placement: React.CSSProperties = isMobile
    ? { top: 52, left: 10, right: 10 }
    : {
        bottom: 30,
        left: `calc(50% - ${shift}px)`,
        maxWidth: `min(460px, calc(100% - ${40 + shift * 2}px))`,
      };

  const offset = isMobile ? 'translateY(-8px)' : 'translateX(-50%) translateY(8px)';
  const resting = isMobile ? 'none' : 'translateX(-50%)';

  return (
    <div
      role="status"
      aria-label="Support Eastside Audubon"
      style={{
        position: 'absolute',
        ...placement,
        zIndex: 1001,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: t.cardBg,
        border: `1px solid ${t.accentBorder}`,
        // The one visual link to the accent language, borrowed from
        // NotificationToast's lifer stripe. Enough to read as "from the app"
        // rather than "from the map".
        borderLeft: `3px solid ${t.accent}`,
        borderRadius: 10,
        padding: '11px 12px 11px 14px',
        boxShadow: t.shadowLg,
        backdropFilter: lowFi ? undefined : 'blur(8px)',
        fontFamily: t.sans,
        opacity: entered ? 1 : 0,
        transform: entered ? resting : offset,
        // The `left` easing matches MapControls' step-aside so the two move
        // together when a panel opens rather than racing each other.
        transition: lowFi
          ? undefined
          : 'opacity 0.2s, transform 0.2s, left 0.24s cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          lineHeight: 1.4,
          color: t.fg1,
        }}
      >
        BirdRadar is free and supports Eastside Audubon.
      </span>

      <a
        href={donationUrl('donate_prompt')}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onDonate}
        onMouseEnter={() => setHovDonate(true)}
        onMouseLeave={() => setHovDonate(false)}
        style={{
          flexShrink: 0,
          padding: '7px 14px',
          borderRadius: 8,
          background: hovDonate ? t.accentBorder : t.accentBg,
          border: `1px solid ${t.accentBorder}`,
          color: t.accent,
          fontSize: 12.5,
          fontWeight: 600,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          transition: lowFi ? undefined : 'all 0.15s',
        }}
      >
        Donate
      </a>

      <button
        onClick={onDismiss}
        aria-label="Dismiss donation prompt"
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
    </div>
  );
}

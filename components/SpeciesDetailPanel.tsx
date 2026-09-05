'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ClassifiedObservation } from '@/lib/ebird';
import { timeAgo } from '@/lib/ebird';
import { getTheme, tierTokens, tierLabel, type Theme } from '@/lib/theme';
import { getSpeciesPhotoUrl } from '@/lib/species-photo';
import {
  formatCoords,
  isPrivateLocation,
  observationDirectionsUrl,
  PRIVATE_LOCATION_HINT,
  PRIVATE_LOCATION_LABEL,
} from '@/lib/location-privacy';
import { locKeyOf } from '@/lib/markers';
import type { LatLng } from '@/lib/drive-time';
import { LockIcon, NavigationIcon, XIcon } from '@/components/Icons';
import ChasePanel from './ChasePanel';
import DriveTimeBadge from './DriveTimeBadge';

/**
 * Species detail — the persistent replacement for the old marker popup.
 *
 * Clicking a pin opens this: a right-hand sidebar on desktop, a bottom sheet on
 * mobile. It stays open while the map is panned and zoomed, which the popup
 * could not do, and it leaves the map full-bleed underneath rather than
 * covering the pin the user just clicked.
 *
 * The parent keys this on the selected location, so switching pins remounts it
 * and resets the pager and the add-to-life-list form.
 */

/** Exported so the map controls can step aside by exactly this much. */
export const DETAIL_PANEL_WIDTH = 340;

interface Props {
  /** Every observation at the clicked location, already sorted by tier priority. */
  group: ClassifiedObservation[];
  lifeSet: Set<string>;
  /** Species focused from the sidebar — sorts to the front of the pager. */
  focusedCode: string | null;
  /** The user's GPS fix, for the drive-time badge. `null` when geolocation was
   *  denied — the badge is then omitted entirely rather than guessed at. */
  driveOrigin: LatLng | null;
  lightMode: boolean;
  isMobile: boolean;
  /** Low battery / reduced motion — drops the slide-in, matching the map controls. */
  reduceMotion: boolean;
  onAddToLifeList: (code: string, name: string, sciName?: string, date?: string, location?: string) => void;
  onClose: () => void;
}

export default function SpeciesDetailPanel({
  group,
  lifeSet,
  focusedCode,
  driveOrigin,
  lightMode,
  isMobile,
  reduceMotion,
  onAddToLifeList,
  onClose,
}: Props) {
  const t = getTheme(lightMode);

  // Focused species first, so opening a pin from the sidebar lands on the bird
  // the user was actually looking at.
  const ordered = useMemo(() => {
    if (!focusedCode || !group.some(o => o.speciesCode === focusedCode)) return group;
    return [...group].sort((a, b) => {
      const aFoc = a.speciesCode === focusedCode ? -1 : 0;
      const bFoc = b.speciesCode === focusedCode ? -1 : 0;
      return aFoc - bFoc;
    });
  }, [group, focusedCode]);

  const [index, setIndex] = useState(0);
  // A refetch can shrink the group under an open panel.
  const safeIndex = Math.min(index, ordered.length - 1);
  const obs = ordered[safeIndex];

  // Only *this* species' records seed the odds history — the pin may hold half a
  // dozen species and folding their reports in would inflate every one of them.
  const speciesCode = obs?.speciesCode;
  const seedObs = useMemo(
    () => (speciesCode ? group.filter(o => o.speciesCode === speciesCode) : []),
    [group, speciesCode],
  );

  // Slide in on mount. Reduced motion skips straight to the resting position.
  const [entered, setEntered] = useState(reduceMotion);
  useEffect(() => {
    if (reduceMotion) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [reduceMotion]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!obs) return null;

  const tc = tierTokens(obs.tier, t);
  const chaseWorthwhile = obs.tier !== 'seen';

  const shellStyle: React.CSSProperties = isMobile
    ? {
        position: 'fixed', left: 0, right: 0,
        // Clears the mobile tab bar; the sidebar drawer sits at the same offset
        // and the two are mutually exclusive (see openDrawer in app/page.tsx).
        bottom: 56,
        maxHeight: '60vh',
        borderTop: `1px solid ${t.line2}`,
        borderRadius: '12px 12px 0 0',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.16)',
        transform: entered ? 'translateY(0)' : 'translateY(100%)',
        zIndex: 1199,
      }
    : {
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: DETAIL_PANEL_WIDTH,
        borderLeft: `1px solid ${t.line2}`,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.10)',
        transform: entered ? 'translateX(0)' : `translateX(${DETAIL_PANEL_WIDTH}px)`,
        // Above the map controls (1001), which shift left to make room.
        zIndex: 1002,
      };

  return (
    <div
      role="dialog"
      aria-label={`${obs.comName} sighting details`}
      style={{
        ...shellStyle,
        background: t.bg1,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: t.sans,
        transition: reduceMotion ? undefined : 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      {isMobile && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, flexShrink: 0 }}>
          <div style={{ width: 32, height: 3, borderRadius: 2, background: t.line3 }} />
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: isMobile ? '10px 16px 12px' : '16px 16px 12px',
        borderBottom: `1px solid ${t.line2}`, flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{
              fontSize: 9.5, fontWeight: 700, fontFamily: t.mono,
              background: tc.bg, color: tc.color,
              border: `1px solid ${tc.border}`,
              borderRadius: 4, padding: '2px 6px', letterSpacing: '0.04em',
            }}>{tierLabel(obs.tier)}</span>
          </div>
          <div style={{
            fontSize: 17, fontWeight: 700, color: t.fg0, fontFamily: t.display,
            letterSpacing: '-0.02em', lineHeight: 1.2,
          }}>
            {obs.comName}
          </div>
          <div style={{ fontSize: 12, color: t.fg2, fontStyle: 'italic', marginTop: 2 }}>
            {obs.sciName}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent', border: `1px solid ${t.line2}`,
            borderRadius: 6, color: t.fg2, cursor: 'pointer',
            padding: 6, display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
        >
          <XIcon size={14} />
        </button>
      </div>

      {/* ── Species pager (several species at one location) ────── */}
      {ordered.length > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 12px', background: t.bg2,
          borderBottom: `1px solid ${t.line2}`, flexShrink: 0,
        }}>
          <button
            onClick={() => setIndex(i => Math.max(0, i - 1))}
            disabled={safeIndex === 0}
            aria-label="Previous species"
            style={pagerBtnStyle(t, safeIndex === 0)}
          >‹</button>
          <span style={{ fontSize: 10, color: t.fg3, fontFamily: t.mono, letterSpacing: '0.06em' }}>
            {safeIndex + 1} / {ordered.length} species here
          </span>
          <button
            onClick={() => setIndex(i => Math.min(ordered.length - 1, i + 1))}
            disabled={safeIndex === ordered.length - 1}
            aria-label="Next species"
            style={pagerBtnStyle(t, safeIndex === ordered.length - 1)}
          >›</button>
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 18px' }}>
        <SpeciesPhoto sciName={obs.sciName} comName={obs.comName} theme={t} />

        {chaseWorthwhile && (
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 9.5, fontWeight: 700, fontFamily: t.mono, color: t.fg3,
              letterSpacing: '0.06em',
            }}>
              SIGHTING ODDS
            </div>
            <ChasePanel
              key={obs.speciesCode}
              speciesCode={obs.speciesCode}
              lat={obs.lat}
              lng={obs.lng}
              lightMode={lightMode}
              seedObs={seedObs}
            />
          </div>
        )}

        <LocationRow obs={obs} theme={t} driveOrigin={driveOrigin} lightMode={lightMode} />

        <AddToLifeList
          obs={obs}
          theme={t}
          isOnLifeList={lifeSet.has(obs.speciesCode)}
          onAddToLifeList={onAddToLifeList}
        />
      </div>
    </div>
  );
}

function pagerBtnStyle(t: Theme, disabled: boolean): React.CSSProperties {
  return {
    background: 'none', border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? t.fg4 : t.accent,
    fontSize: 18, fontWeight: 700, padding: '0 6px', lineHeight: 1,
    opacity: disabled ? 0.3 : 1,
  };
}

// ─── Photo slot ───────────────────────────────────────────────────────────────
// Renders nothing until lib/species-photo.ts returns a URL. The slot exists so
// adding photography later is a one-line change there, not a layout rework here.

function SpeciesPhoto({ sciName, comName, theme }: { sciName: string; comName: string; theme: Theme }) {
  const url = getSpeciesPhotoUrl(sciName);
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote host is not in next.config images
    <img
      src={url}
      alt={comName}
      style={{
        width: '100%', height: 150, objectFit: 'cover',
        borderRadius: 10, border: `1px solid ${theme.line2}`,
        marginBottom: 14, display: 'block',
      }}
    />
  );
}

// ─── Location + sighting meta ─────────────────────────────────────────────────
// Kept as its own block with a name line, a badge row and a trailing action
// slot. Phase C landed the location-privacy treatment and the Directions action
// in the slot Phase B reserved for them, without restructuring the layout.
// Phase D landed the drive-time badge in the badge row — the last tenant this
// block was designed to receive, and again with no restructuring.
//
// Privacy and drive time are independent here, deliberately. A private location
// shows a drive-time badge AND no Directions button: a duration is a number with
// no address and no route, while a directions link is navigation. See
// PhaseC_rationale.md §7.4 — this pairing is the whole point of that distinction,
// not an oversight.
//
// Privacy: a private location is *labelled*, and eBird's own `locName` is kept
// beneath it in muted type. eBird publishes that name itself, so hiding it buys
// no privacy while costing real context ("Monohon Woods (Restricted Access)" is
// worth reading). What is withheld is the thing that actually enables a visit:
// the directions action, and coordinate precision.

function LocationRow({ obs, theme: t, driveOrigin, lightMode }: {
  obs: ClassifiedObservation;
  theme: Theme;
  driveOrigin: LatLng | null;
  lightMode: boolean;
}) {
  const isPrivate = isPrivateLocation(obs);
  const directions = observationDirectionsUrl(obs);

  return (
    <div style={{
      padding: '10px 12px', marginBottom: 14,
      background: t.bg2, border: `1px solid ${t.line2}`, borderRadius: 10,
    }}>
      {isPrivate ? (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12.5, color: t.fg1, fontWeight: 600, lineHeight: 1.35,
          }}>
            <LockIcon size={12} style={{ color: t.fg3 }} />
            {PRIVATE_LOCATION_LABEL}
          </div>
          <div style={{ fontSize: 11.5, color: t.fg3, lineHeight: 1.35, marginTop: 2 }}>
            {obs.locName}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: t.fg1, fontWeight: 600, lineHeight: 1.35 }}>
          {obs.locName}
        </div>
      )}

      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
        fontSize: 11.5, color: t.fg3, fontFamily: t.mono, marginTop: 6,
      }}>
        <span>{obs.howMany ? `${obs.howMany}×` : '1×'}</span>
        <span>{timeAgo(obs.obsDt)}</span>
        <span>{formatCoords(obs)}</span>
        {/* Not lazy: this panel shows one location at a time, so there is nothing
            to defer. Resolves from lib/drive-time.ts's cache when the list has
            already asked for this location. */}
        {driveOrigin && (
          <DriveTimeBadge
            origin={driveOrigin}
            locKey={locKeyOf(obs)}
            coords={[obs.lat, obs.lng]}
            lightMode={lightMode}
          />
        )}
      </div>

      {obs.reportCount != null && obs.reportCount > 1 && (
        <div style={{ fontSize: 11, color: t.fg3, fontFamily: t.mono, marginTop: 4 }}>
          Reported {obs.reportCount}× this week here
        </div>
      )}

      {/* Rendered on the URL, not on a disabled button holding a live href —
          there is nothing here to re-enable. */}
      {directions ? (
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginTop: 10, padding: '7px 0',
            background: t.accentBg, border: `1px solid ${t.accentBorder}`,
            borderRadius: 8, color: t.accent,
            fontSize: 12, fontWeight: 600, textDecoration: 'none',
            fontFamily: t.sans,
          }}
        >
          <NavigationIcon size={12} />
          Directions
        </a>
      ) : (
        // A silently missing button reads as a bug; say it was a decision.
        <div style={{
          marginTop: 8, fontSize: 10.5, color: t.fg3,
          lineHeight: 1.4, fontStyle: 'italic',
        }}>
          {PRIVATE_LOCATION_HINT}
        </div>
      )}
    </div>
  );
}

// ─── Add to life list ─────────────────────────────────────────────────────────

function AddToLifeList({
  obs,
  theme: t,
  isOnLifeList,
  onAddToLifeList,
}: {
  obs: ClassifiedObservation;
  theme: Theme;
  isOnLifeList: boolean;
  onAddToLifeList: (code: string, name: string, sciName?: string, date?: string, location?: string) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDate, setAddDate] = useState('');
  const [addLoc, setAddLoc] = useState('');

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 9px',
    background: t.bg2, border: `1px solid ${t.line2}`,
    borderRadius: 6, color: t.fg0, fontSize: 12,
    outline: 'none', boxSizing: 'border-box',
    fontFamily: t.sans,
  };

  if (isOnLifeList) {
    return (
      <div style={{ textAlign: 'center', fontSize: 11, color: t.accent, padding: '6px 0', fontFamily: t.mono }}>
        ✓ On life list
      </div>
    );
  }

  if (!showAddForm) {
    return (
      <button
        onClick={() => {
          setAddDate(obs.obsDt.split(' ')[0]);
          setAddLoc(obs.locName);
          setShowAddForm(true);
        }}
        style={{
          width: '100%', padding: '9px 0',
          background: t.accentBg, border: `1px solid ${t.accentBorder}`,
          borderRadius: 8, color: t.accent,
          fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
          fontFamily: t.sans,
        }}
      >
        + Add to Life List
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} style={inputStyle} />
      <input type="text" value={addLoc} onChange={e => setAddLoc(e.target.value)} placeholder="Location" style={inputStyle} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => {
            onAddToLifeList(obs.speciesCode, obs.comName, obs.sciName, addDate, addLoc);
            setShowAddForm(false);
          }}
          style={{
            flex: 1, padding: '6px 0',
            background: t.accentBg, border: `1px solid ${t.accentBorder}`,
            borderRadius: 6, color: t.accent,
            fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: t.sans,
          }}
        >
          ✓ Confirm
        </button>
        <button
          onClick={() => setShowAddForm(false)}
          style={{
            padding: '6px 12px',
            background: 'transparent', border: `1px solid ${t.line2}`,
            borderRadius: 6, color: t.fg2, fontSize: 11.5, cursor: 'pointer', fontFamily: t.sans,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

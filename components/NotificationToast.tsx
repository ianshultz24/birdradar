'use client';

import { useEffect } from 'react';
import { fmtDist } from '@/lib/ebird';
import { getTheme } from '@/lib/theme';
import { XIcon } from '@/components/Icons';

export interface ToastItem {
  id: number;
  speciesName: string;
  locName: string;
  distKm: number;
}

interface Props {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
  lightMode: boolean;
  useMetric?: boolean;
}

const AUTO_DISMISS_MS = 8000;

export default function NotificationToast({ toasts, onDismiss, lightMode, useMetric = true }: Props) {
  const t = getTheme(lightMode);

  useEffect(() => {
    if (!toasts.length) return;
    const latest = toasts[toasts.length - 1];
    const timer = setTimeout(() => onDismiss(latest.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toasts, onDismiss]);

  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none',
    }}>
      {toasts.slice(-3).map(toast => (
        <div key={toast.id} style={{
          background: t.cardBg, border: `1px solid ${t.accentBorder}`,
          borderLeft: `3px solid ${t.lifer}`,
          borderRadius: 10, padding: '12px 14px',
          boxShadow: t.shadowLg, minWidth: 280, maxWidth: 340,
          pointerEvents: 'all', display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                color: t.lifer, fontFamily: t.mono, marginBottom: 4,
                textTransform: 'uppercase',
              }}>
                Lifer Nearby
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.fg0, fontFamily: t.display, lineHeight: 1.3, marginBottom: 3 }}>
                {toast.speciesName}
              </div>
              <div style={{ fontSize: 11, color: t.fg2, fontFamily: t.mono }}>
                {toast.locName.length > 38 ? `${toast.locName.slice(0, 38)}…` : toast.locName}
                {' · '}
                {fmtDist(toast.distKm, useMetric)} away
              </div>
            </div>
            <button onClick={() => onDismiss(toast.id)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: t.fg3, padding: '2px', flexShrink: 0, marginTop: -1,
            }}>
              <XIcon size={14}/>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

'use client';

import { useEffect } from 'react';

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
}

const AUTO_DISMISS_MS = 8000;

export default function NotificationToast({ toasts, onDismiss, lightMode }: Props) {
  // Auto-dismiss each toast after AUTO_DISMISS_MS
  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1];
    const timer = setTimeout(() => onDismiss(latest.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;

  const bg = lightMode ? '#ffffff' : '#1a2332';
  const border = lightMode ? 'rgba(0,0,0,0.12)' : 'rgba(96,165,250,0.25)';
  const accent = '#60a5fa';
  const textPrimary = lightMode ? '#1a2332' : '#ddeeff';
  const textMuted = lightMode ? '#718096' : '#8899aa';
  const shadow = lightMode
    ? '0 4px 20px rgba(0,0,0,0.15)'
    : '0 4px 20px rgba(0,0,0,0.5)';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        pointerEvents: 'none',
      }}
    >
      {toasts.slice(-3).map((toast) => (
        <div
          key={toast.id}
          style={{
            background: bg,
            border: `1px solid ${border}`,
            borderLeft: `4px solid ${accent}`,
            borderRadius: 8,
            padding: '12px 14px',
            boxShadow: shadow,
            minWidth: 280,
            maxWidth: 340,
            pointerEvents: 'all',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  color: accent,
                  fontFamily: 'var(--font-jb-mono, monospace)',
                  marginBottom: 3,
                }}
              >
                🔔 LIFER NEARBY
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: textPrimary,
                  lineHeight: 1.3,
                  marginBottom: 2,
                }}
              >
                {toast.speciesName}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: textMuted,
                  fontFamily: 'var(--font-jb-mono, monospace)',
                }}
              >
                {toast.locName.length > 35 ? `${toast.locName.slice(0, 35)}…` : toast.locName}
                {' · '}
                {toast.distKm < 1
                  ? `${Math.round(toast.distKm * 1000)}m away`
                  : `${toast.distKm.toFixed(1)} km away`}
              </div>
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: textMuted,
                fontSize: 16,
                lineHeight: 1,
                padding: '0 2px',
                flexShrink: 0,
                marginTop: -2,
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

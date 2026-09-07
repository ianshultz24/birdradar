'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { getTheme, text } from '@/lib/theme';

/**
 * The password gate for `/dev`.
 *
 * ─── Why the password goes in a POST body ────────────────────────────────────
 *
 * `/api/dev/unlock` has no `GET` export, so this could not submit as a query
 * string even by accident. That is the point: a secret in a URL lands in browser
 * history, in the `Referer` of every subsequent request, and in server and CDN
 * access logs — none of which rotate when the secret does.
 *
 * ─── Why the errors are not smoothed over ────────────────────────────────────
 *
 * Three outcomes, three distinct messages, because they have three different
 * owners. A wrong password is the operator's typing; a 429 is the operator
 * having typed wrong five times; a 503 means `DEV_MODE_SECRET` was never set on
 * this deployment and *no* password will ever work. Collapsing the third into
 * "incorrect password" is how someone spends an hour retyping a secret that
 * could not have worked — the same distinction `PhaseE1_bugfix_sort_drivetime.md`
 * §4d drew between "the user's to fix" and "the operator's to fix".
 */
export default function DevUnlockForm({ lightMode }: { lightMode: boolean }) {
  const t = getTheme(lightMode);
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || password.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/dev/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setPassword('');
        // The page is a server component; re-running it is what swaps the form
        // for the panel, using the cookie the response just set.
        router.refresh();
        return;
      }

      const body = await res.json().catch(() => null);
      setError(
        (body as { error?: string } | null)?.error ??
          `Unlock failed (${res.status})`
      );
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        width: '100%',
        maxWidth: 340,
        background: t.cardBg,
        border: `1px solid ${t.line2}`,
        borderRadius: 12,
        padding: 24,
        boxShadow: t.shadow,
      }}
    >
      <h1 style={{ ...text.panelTitle(t), margin: '0 0 4px' }}>Developer Mode</h1>
      <p style={{ ...text.rowMeta(t), margin: '0 0 18px' }}>
        This area is not part of the app.
      </p>

      <label
        htmlFor="dev-password"
        style={{ ...text.microCaps(t), display: 'block', marginBottom: 6 }}
      >
        PASSWORD
      </label>
      <input
        id="dev-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
        style={{
          ...text.body(t),
          width: '100%',
          boxSizing: 'border-box',
          padding: '9px 11px',
          borderRadius: 8,
          border: `1px solid ${t.line3}`,
          background: t.bg1,
          color: t.fg0,
          outline: 'none',
        }}
      />

      {error && (
        <p
          style={{
            ...text.rowMeta(t),
            margin: '10px 0 0',
            color: lightMode ? '#B91C1C' : '#F87171',
          }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || password.length === 0}
        style={{
          ...text.control(t),
          width: '100%',
          marginTop: 16,
          padding: '9px 14px',
          borderRadius: 8,
          border: `1px solid ${t.accentBorder}`,
          background: busy ? t.bg2 : t.accentBg,
          color: t.accent,
          cursor: busy || password.length === 0 ? 'default' : 'pointer',
          opacity: password.length === 0 ? 0.6 : 1,
        }}
      >
        {busy ? 'Checking…' : 'Unlock'}
      </button>
    </form>
  );
}

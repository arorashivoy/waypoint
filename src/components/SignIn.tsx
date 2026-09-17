'use client';

import { useState } from 'react';
import { post } from './api';
import { COUNTRIES } from '@/lib/countries';

const READS = [
  'Profile and headline',
  'Experience and education',
  'Projects and publications',
  'Connections, shared schools and past employers',
  'Nothing is posted or sent on your behalf',
];

export default function SignIn({ onSignedIn, setToast, toast, requiresCode }: { onSignedIn: () => Promise<any>; setToast: (s: string) => void; toast: string | null; requiresCode?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');

  const signIn = async () => {
    if (requiresCode && !code.trim()) {
      setToast('Enter the passcode to continue.');
      return;
    }
    setBusy(true);
    try {
      // The real OIDC route redirects; without credentials configured it 400s and
      // we fall back to the local account, which is the same person either way.
      const res = await fetch('/api/auth/linkedin/start', { redirect: 'manual' });
      if (res.type === 'opaqueredirect' || res.status === 0) {
        window.location.href = '/api/auth/linkedin/start';
        return;
      }
      await post('/api/auth/local', { code: code.trim() });
      await onSignedIn();
    } catch (e) {
      setToast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-left">
        <div className="display wordmark" style={{ padding: 0 }}>Waypoint</div>
        <h1 className="display">Eight countries. One warm introduction at a time.</h1>
        <p className="login-lede">
          Jobs from the best boards in each country on your list, a referral route through people you already share
          something with, and a CV tuned to every description.
        </p>
        <div className="stack" style={{ borderTop: '1px solid var(--line)' }}>
          {COUNTRIES.map((c) => (
            <div key={c.cc} className="row" style={{ gap: 20, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <span className="mono" style={{ fontSize: 13, color: 'var(--muted-3)', width: 24 }}>{c.rank}</span>
              <span className="grow" style={{ fontSize: 17, fontWeight: 500 }}>{c.name}</span>
              <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{c.settleShort}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="login-right">
        <div className="mono" style={{ fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C9C2B3' }}>Sign in</div>
        {requiresCode && (
          <div className="stack" style={{ gap: 8 }}>
            <label htmlFor="wp-code" style={{ fontSize: 15, color: '#C9C2B3' }}>
              Passcode
            </label>
            <input
              id="wp-code"
              type="password"
              className="field"
              autoComplete="one-time-code"
              placeholder="Required when reached from outside your network"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') signIn(); }}
              style={{ width: '100%', background: '#2A3242', borderColor: '#3A4252', color: '#F4F1EA' }}
            />
          </div>
        )}

        <button className="login-cta" onClick={signIn} disabled={busy}>
          {busy ? 'Signing in…' : 'Continue with LinkedIn'}
        </button>
        <div className="stack" style={{ gap: 14 }}>
          <div style={{ fontSize: 15, color: '#C9C2B3' }}>What Waypoint reads from your profile</div>
          {READS.map((r) => (
            <div key={r} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', fontSize: 17, lineHeight: 1.4 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E7835A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                <path d="M5 12l5 5L20 7" />
              </svg>
              <span>{r}</span>
            </div>
          ))}
        </div>
        <p className="login-note">
          Signing in with LinkedIn returns only your name, email and photo. Experience, projects and connections come
          from your LinkedIn data export, which you upload on the Resume screen. Replies go out only when the answer is
          certain — everything else waits for you in Pending.
        </p>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

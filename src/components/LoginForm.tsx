'use client';

import { useState } from 'react';
import { post } from './api';

const input = { width: '100%', background: '#2A3242', borderColor: '#3A4252', color: '#F4F1EA' };

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/login', { email, password });
      window.location.assign(next);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-left">
        <div className="display wordmark" style={{ padding: 0 }}>Waypoint</div>
        <h1 className="display">One warm introduction at a time.</h1>
        <p className="login-lede">Waypoint is for invited users. Ask the admin for an invite link if you do not have an account.</p>
      </div>
      <form className="login-right" onSubmit={submit}>
        <div className="mono" style={{ fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C9C2B3' }}>Sign in</div>
        <label className="stack" style={{ gap: 8 }}>
          <span style={{ fontSize: 15, color: '#C9C2B3' }}>Email</span>
          <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
        </label>
        <label className="stack" style={{ gap: 8 }}>
          <span style={{ fontSize: 15, color: '#C9C2B3' }}>Password</span>
          <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
        </label>
        {error && <p role="alert" style={{ color: '#E7835A', fontSize: 15, margin: 0 }}>{error}</p>}
        <button className="login-cta" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="login-note">Forgot your password? Ask the admin for a reset link.</p>
      </form>
    </div>
  );
}

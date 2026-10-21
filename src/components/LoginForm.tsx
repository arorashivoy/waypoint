'use client';

import { useState } from 'react';
import { post } from './api';


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
        <div className="login-brand"><span className="sh-mark" aria-hidden="true" />Waypoint</div>
        <h1 className="display">One warm introduction at a time.</h1>
        <p className="login-lede">Waypoint is for invited users. Ask the admin for an invite link if you do not have an account.</p>
      </div>
      <form className="login-right" onSubmit={submit}>
        <h2 className="login-title">Sign in</h2>
        <label className="login-field">
          <span>Email</span>
          <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="login-field">
          <span>Password</span>
          <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" className="login-error">{error}</p>}
        <button className="login-cta" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="login-note">Forgot your password? Ask the admin for a reset link.</p>
      </form>
    </div>
  );
}

'use client';

import { useRef, useState } from 'react';
import { post } from './api';
import Turnstile from './Turnstile';

export default function LoginForm({ next, siteKey }: { next: string; siteKey: string | null }) {
  // The fields are not controlled. On a slow phone a person can type before React is ready, and a controlled field
  // then loses that text. The submit reads the values from the fields. The fields have no name, so a submit before
  // React is ready sends nothing in the address.
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const waiting = !!siteKey && !check;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/login', { email: emailRef.current?.value ?? '', password: passwordRef.current?.value ?? '', turnstile: check ?? undefined });
      window.location.assign(next);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      if (siteKey) setRound((r) => r + 1);
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
          <input className="field" type="email" autoComplete="email" required ref={emailRef} />
        </label>
        <label className="login-field">
          <span>Password</span>
          <input className="field" type="password" autoComplete="current-password" required ref={passwordRef} />
        </label>
        {siteKey && <Turnstile siteKey={siteKey} round={round} onToken={setCheck} />}
        {error && <p role="alert" className="login-error">{error}</p>}
        <button className="login-cta" type="submit" disabled={busy || waiting}>{busy ? 'Signing in…' : waiting ? 'Checking your browser…' : 'Sign in'}</button>
        <p className="login-note">Forgot your password? Ask the admin for a reset link.</p>
      </form>
    </div>
  );
}

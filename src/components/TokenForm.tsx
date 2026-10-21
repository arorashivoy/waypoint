'use client';

import { useEffect, useState } from 'react';
import { api, post } from './api';

type Info = { kind: 'invite' | 'reset'; email: string | null; name: string | null };

/** The page for an invite link or a reset link. On success the server signs the user in. */
export default function TokenForm({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Info>(`/api/invites/${encodeURIComponent(token)}`).then(setInfo, (e) => setError((e as Error).message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) {
      setError('The 2 passwords are not the same.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post(`/api/invites/${encodeURIComponent(token)}`, info?.kind === 'invite' ? { name, email, password } : { password });
      window.location.assign('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const title = info?.kind === 'reset' ? 'Set a new password' : 'Make your account';

  return (
    <div className="login">
      <div className="login-left">
        <div className="login-brand"><span className="sh-mark" aria-hidden="true" />Waypoint</div>
        <h1 className="display">{info ? title : 'Waypoint'}</h1>
        {info?.kind === 'reset' && <p className="login-lede">For {info.email}. A new password signs you out on all other devices.</p>}
      </div>
      <form className="login-right" onSubmit={submit}>
        {!info && !error && <p>Checking the link…</p>}
        {info?.kind === 'invite' && (
          <>
            <label className="login-field">
              <span>Name</span>
              <input className="field" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="login-field">
              <span>Email</span>
              {info.email ? (
                <input className="field" value={info.email} readOnly />
              ) : (
                <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              )}
            </label>
          </>
        )}
        {info && (
          <>
            <label className="login-field">
              <span>Password (12 characters or more)</span>
              <input className="field" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="login-field">
              <span>Type the password again</span>
              <input className="field" type="password" autoComplete="new-password" minLength={12} required value={again} onChange={(e) => setAgain(e.target.value)} />
            </label>
            <button className="login-cta" type="submit" disabled={busy}>{busy ? 'Saving…' : info.kind === 'reset' ? 'Set the password' : 'Make the account'}</button>
          </>
        )}
        {error && <p role="alert" className="login-error">{error}</p>}
      </form>
    </div>
  );
}

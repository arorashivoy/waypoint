'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, copyText, del, patch, post, put } from './api';

type Status = { mode: 'own' | 'shared' | 'cli' | 'none'; detail: string; keyHint: string | null; sharedAvailable: boolean; capUsd: number; sharedSpentUsd: number; capReached: boolean; resetsAt: string };
type SessionRow = { id: string; current: boolean; userAgent: string | null; createdAt: string; lastSeenAt: string };
type UserRow = { id: string; email: string; name: string; role: string; disabled: boolean; createdAt: string; lastSeenAt: string | null; sharedSpentUsd: number };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
const device = (ua: string | null) => {
  if (!ua) return 'Unknown device';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return ua.slice(0, 40);
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card stack" style={{ gap: 16, padding: 20, marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsScreen({ state, setToast }: { state: any; setToast: (s: string) => void }) {
  const isAdmin = state?.user?.role === 'admin';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [claude, setClaude] = useState<Status | null>(null);
  const [key, setKey] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [link, setLink] = useState<{ url: string; expiresAt: string; label: string } | null>(null);

  const load = useCallback(async () => {
    const [s, c] = await Promise.all([api<{ sessions: SessionRow[] }>('/api/account/sessions'), api<Status>('/api/account/claude')]);
    setSessions(s.sessions);
    setClaude(c);
    if (isAdmin) setUsers((await api<{ users: UserRow[] }>('/api/admin/users')).users);
  }, [isAdmin]);

  useEffect(() => {
    load().catch((e) => setToast((e as Error).message));
  }, [load, setToast]);

  /** True when the request worked. On an error it shows the message and returns false. */
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) setToast(done);
      await load();
      return true;
    } catch (e) {
      setToast((e as Error).message);
      return false;
    }
  };

  const leave = async (url: string, method: 'post' | 'del') => {
    if (await run(() => (method === 'post' ? post(url) : del(url)))) window.location.assign('/login');
  };

  return (
    <>
      <header className="screen-head"><h1 className="display">Settings</h1></header>
      <div className="settings-body">
      <div style={{ maxWidth: 760, minWidth: 0 }}>

      <Section title="Account">
        <div style={{ overflowWrap: 'anywhere' }}>{state?.user?.name} · {state?.user?.email}</div>
        <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); run(() => post('/api/account/password', { current, next }), 'Password changed. Your other devices are signed out.').then((ok) => { if (ok) { setCurrent(''); setNext(''); } }); }}>
          <div className="label">Change password</div>
          <input className="field" type="password" autoComplete="current-password" placeholder="Current password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input className="field" type="password" autoComplete="new-password" placeholder="New password, 12+ characters" minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} />
          <button className="btn btn-dark" type="submit">Change password</button>
        </form>
        <div className="label">Signed-in devices</div>
        {sessions.map((s) => (
          <div key={s.id} className="row" style={{ gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span>{device(s.userAgent)}{s.current ? ' (this device)' : ''} · last used {when(s.lastSeenAt)}</span>
            {!s.current && <button className="btn" onClick={() => run(() => del(`/api/account/sessions/${s.id}`), 'Signed out that device.')}>Sign out</button>}
          </div>
        ))}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => leave('/api/auth/signout', 'post')}>Sign out</button>
          <button className="btn" onClick={() => leave('/api/account/sessions', 'del')}>Sign out on all devices</button>
        </div>
      </Section>

      <Section title="Claude">
        {claude && (
          <>
            <div>{claude.detail}</div>
            {claude.sharedAvailable && (
              <div className="mono" style={{ fontSize: 14 }}>
                Shared key this month: ${claude.sharedSpentUsd.toFixed(2)} of ${claude.capUsd.toFixed(2)} · resets {new Date(claude.resetsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}
              </div>
            )}
            {claude.keyHint ? (
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <span>Your API key ends in {claude.keyHint}.</span>
                <button className="btn" onClick={() => run(() => del('/api/account/claude'), 'Removed your API key.')}>Remove key</button>
              </div>
            ) : (
              <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); run(() => put('/api/account/claude', { key }), 'Saved your API key.').then((ok) => { if (ok) setKey(''); }); }}>
                <div className="label">Your own Anthropic API key</div>
                <input className="field" type="password" autoComplete="off" placeholder="sk-ant-…" required value={key} onChange={(e) => setKey(e.target.value)} />
                <button className="btn btn-dark" type="submit">Save key</button>
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>The key is stored encrypted. Waypoint shows only its last 4 characters.</div>
              </form>
            )}
          </>
        )}
      </Section>

      {isAdmin && (
        <Section title="Admin">
          <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await post<{ url: string; expiresAt: string }>('/api/admin/invites', { email: inviteEmail }); setLink({ ...r, label: 'Invite link' }); setInviteEmail(''); }); }}>
            <div className="label">Invite a user</div>
            <input className="field" type="email" placeholder="Email (optional)" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <button className="btn btn-dark" type="submit">Make an invite link</button>
          </form>
          {link && (
            <div className="stack" style={{ gap: 8 }}>
              <div>{link.label}. Send it to the user. It works one time, until {when(link.expiresAt)}.</div>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <code className="mono" style={{ wordBreak: 'break-all', fontSize: 13 }}>{link.url}</code>
                <button className="btn" onClick={async () => setToast((await copyText(link.url)) ? 'Copied.' : 'Copy the link from the screen.')}>Copy</button>
              </div>
            </div>
          )}
          <div className="label">Users</div>
          {users.map((u) => (
            <div key={u.id} className="row" style={{ gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                {u.name} · {u.email} · {u.role}{u.disabled ? ' · disabled' : ''}
                <br />
                <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>shared key ${u.sharedSpentUsd.toFixed(2)} this month · last seen {when(u.lastSeenAt)}</span>
              </span>
              <span className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={() => run(async () => { const r = await post<{ url: string; expiresAt: string }>(`/api/admin/users/${u.id}/reset`); setLink({ ...r, label: `Reset link for ${u.email}` }); })}>Reset link</button>
                {u.role !== 'admin' && (
                  <button className="btn" onClick={() => run(() => patch(`/api/admin/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? 'User enabled.' : 'User disabled and signed out.')}>{u.disabled ? 'Enable' : 'Disable'}</button>
                )}
              </span>
            </div>
          ))}
        </Section>
      )}
      </div>
      </div>
    </>
  );
}

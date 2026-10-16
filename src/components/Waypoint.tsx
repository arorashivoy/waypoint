'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, post } from './api';
import { useIsPhone, useToast } from './hooks';
import JobsScreen from './JobsScreen';
import PendingScreen from './PendingScreen';
import ResumeScreen from './ResumeScreen';
import CountriesScreen from './CountriesScreen';
import ProfileScreen from './ProfileScreen';

export type Screen = 'jobs' | 'detail' | 'pending' | 'resume' | 'countries' | 'profile';

const NAV: { key: Screen; label: string; short: string }[] = [
  { key: 'jobs', label: 'Jobs', short: 'Jobs' },
  { key: 'pending', label: 'Pending', short: 'Pending' },
  { key: 'resume', label: 'Resume', short: 'Resume' },
  { key: 'countries', label: 'Countries and boards', short: 'Places' },
  { key: 'profile', label: 'Profile', short: 'Profile' },
];

export default function Waypoint() {
  const [state, setState] = useState<any>(null);
  const [screen, setScreen] = useState<Screen>('jobs');
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useToast();
  const phone = useIsPhone();

  const refresh = useCallback(async () => {
    const s = await api('/api/state');
    setState(s);
    return s;
  }, []);

  useEffect(() => {
    refresh().catch((e) => {
      if (e instanceof ApiError && e.status === 401) window.location.assign('/login');
      else setToast(String(e.message));
    });
  }, [refresh, setToast]);

  // While Claude is working through the queue, poll so estimates turn into real
  // scores without the user reloading.
  const analysing = state?.analysing;
  useEffect(() => {
    if (!analysing?.running) return;
    const t = setInterval(() => { refresh().catch(() => {}); }, 4000);
    return () => clearInterval(t);
  }, [analysing?.running, analysing?.done, refresh]);

  const needsCount = state?.needs?.length ?? 0;

  const openJob = (id: string) => {
    setSelected(id);
    if (phone) setScreen('detail');
  };

  const go = (key: Screen) => {
    setScreen(key);
    if (key === 'jobs' && phone) setSelected(null);
  };

  const countries = state?.countries ?? [];
  const toggleCountry = async (cc: string, on: boolean) => {
    setState((s: any) => ({ ...s, countries: s.countries.map((c: any) => (c.cc === cc ? { ...c, on } : c)) }));
    await post('/api/countries', { cc, on });
  };

  const screens = useMemo(
    () => ({ state, refresh, setToast, openJob, selected, setSelected, toggleCountry, go, phone }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, refresh, selected, phone],
  );

  if (state === null) {
    return <main style={{ padding: 40, fontSize: 15, color: 'var(--muted)' }}>Loading Waypoint…</main>;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="display wordmark">Waypoint</div>

        <nav className="stack" style={{ gap: 4 }}>
          {NAV.map((n) => (
            <button
              key={n.key}
              className="nav-item"
              data-on={screen === n.key || (n.key === 'jobs' && screen === 'detail')}
              onClick={() => go(n.key)}
            >
              <span className="grow">{n.label}</span>
              {n.key === 'pending' && needsCount > 0 && <span className="badge flash mono">{needsCount}</span>}
            </button>
          ))}
        </nav>

        <div className="stack" style={{ gap: 6 }}>
          <div className="label" style={{ padding: '0 12px 6px' }}>Countries, in your order</div>
          {countries.map((c: any) => (
            <button key={c.cc} className="country-row" aria-pressed={c.on} onClick={() => toggleCountry(c.cc, !c.on)}>
              <span className="country-box" style={{ background: c.on ? 'var(--ink)' : 'transparent' }} />
              <span className="grow" style={{ fontSize: 15, color: c.on ? 'var(--ink)' : 'var(--muted-3)' }}>{c.name}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--muted-3)' }}>{c.count}</span>
            </button>
          ))}
        </div>

        <div className="row" style={{ marginTop: 'auto', gap: 12, padding: 12, borderTop: '1px solid var(--line)' }}>
          <span className="avatar">{state.user.initials}</span>
          <div className="stack">
            <span style={{ fontSize: 15, fontWeight: 600 }}>{state.user.name}</span>
            <span style={{ fontSize: 13, color: 'var(--muted-2)' }}>
              {state.claude.mode === 'cli' ? 'Claude: your subscription' : state.claude.mode === 'api' ? 'Claude: API key' : 'Claude not connected'}
            </span>
          </div>
        </div>
      </aside>

      <main className="main">
        {state.claims && (
          <div
            role="alert"
            style={{
              margin: '12px 16px 0',
              padding: '10px 14px',
              border: '1px solid #b91c1c',
              background: '#fee2e2',
              color: '#7f1d1d',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              fontSize: 14,
            }}
          >
            <span className="grow">
              <strong>Your profile file is invalid, so Waypoint is using the LinkedIn import instead.</strong>{' '}
              <code style={{ fontSize: 13 }}>{state.claims.path}</code>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {state.claims.errors.slice(0, 3).map((e: string) => (
                  <li key={e} style={{ fontSize: 13 }}>
                    {e}
                  </li>
                ))}
                {state.claims.errors.length > 3 && (
                  <li style={{ fontSize: 13 }}>and {state.claims.errors.length - 3} more</li>
                )}
              </ul>
              <span style={{ fontSize: 13, display: 'block', marginTop: 6 }}>
                Fix them and run <code>npm run check:claims</code>, then recheck.
              </span>
            </span>
            <button className="btn" onClick={() => refresh()}>
              Recheck
            </button>
          </div>
        )}

        {(state.claude?.authFailure || state.claude?.quotaFailure) && (
          <div
            role="alert"
            style={{
              margin: '12px 16px 0',
              padding: '10px 14px',
              border: '1px solid #b45309',
              background: '#fef3c7',
              color: '#78350f',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 14,
            }}
          >
            <span className="grow">
              {state.claude.authFailure ? (
                <>
                  <strong>Claude authentication failed.</strong> {state.claude.authFailure.message}
                </>
              ) : (
                <>
                  <strong>Claude is out of usage.</strong> {state.claude.quotaFailure.message}
                </>
              )}
            </span>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await api('/api/claude');
                  await refresh();
                  setToast('Rechecked Claude connection.');
                } catch (e: any) {
                  setToast(String(e.message));
                }
              }}
            >
              Recheck
            </button>
          </div>
        )}
        {(screen === 'jobs' || screen === 'detail') && <JobsScreen {...screens} screen={screen} />}
        {screen === 'pending' && <PendingScreen {...screens} />}
        {screen === 'resume' && <ResumeScreen {...screens} />}
        {screen === 'countries' && <CountriesScreen {...screens} />}
        {screen === 'profile' && <ProfileScreen {...screens} />}
      </main>

      <nav className="tabbar">
        {NAV.map((n) => (
          <button
            key={n.key}
            className="tab"
            data-on={screen === n.key || (n.key === 'jobs' && screen === 'detail')}
            onClick={() => go(n.key)}
          >
            <span className="tab-bar-mark" />
            <span className="row" style={{ gap: 4 }}>
              {n.short}
              {n.key === 'pending' && needsCount > 0 && <span className="badge flash mono">{needsCount}</span>}
            </span>
          </button>
        ))}
      </nav>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

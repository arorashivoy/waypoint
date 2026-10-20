'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, post } from './api';
import { useToast } from './hooks';
import JobsScreen from './JobsScreen';
import PendingScreen from './PendingScreen';
import { Interim } from './shell/Interim';
import Loading from './shell/Loading';
import Rail from './shell/Rail';
import Sidebar from './shell/Sidebar';
import TabBar from './shell/TabBar';
import TopBar from './shell/TopBar';
import { claudeLine, taskLine } from './shell/task';
import { useCollapsed, useLocation } from './shell/useShell';
import { ErrorNote } from './ui';

export default function Waypoint() {
  const [state, setState] = useState<any>(null);
  const { loc, go, openJob, closeJob } = useLocation();
  const [collapsed, setCollapsed] = useCollapsed();
  const [toast, setToast] = useToast();
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await api('/api/state');
    setState(s);
    setLoadError(null);
    return s;
  }, []);

  useEffect(() => {
    refresh().catch((e) => {
      if (e instanceof ApiError && e.status === 401) return;
      setToast(String(e.message));
      setLoadError(String(e.message));
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

  const toggleCountry = async (cc: string, on: boolean) => {
    setState((s: any) => ({ ...s, countries: s.countries.map((c: any) => (c.cc === cc ? { ...c, on } : c)) }));
    await post('/api/countries', { cc, on });
  };

  const screens = useMemo(
    () => ({ state, refresh, setToast, openJob, selected: loc.job, toggleCountry }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, refresh, loc.job, openJob],
  );

  const toastEl = toast && <div className="toast" role="status">{toast}</div>;

  if (state === null) {
    return (
      <>
        <Loading error={loadError} onRetry={() => { refresh().catch((e) => setLoadError(String(e.message))); }} />
        {toastEl}
      </>
    );
  }

  const nav = { place: loc.view, go, needsCount: state.needs?.length ?? 0, task: taskLine(state.analysing) };
  const jobOpen = loc.view === 'jobs' && loc.job !== null;
  const failure = state.claude?.authFailure
    ? { what: 'Claude authentication failed.', fix: state.claude.authFailure.message as string }
    : state.claude?.quotaFailure
      ? { what: 'Claude is out of usage.', fix: state.claude.quotaFailure.message as string }
      : null;

  return (
    <div className="sh" data-collapsed={collapsed} data-place={loc.view} data-job={jobOpen ? 'open' : 'none'}>
      <Sidebar {...nav} user={state.user} claudeLine={claudeLine(state.claude.mode)} onCollapse={() => setCollapsed(true)} />
      <Rail {...nav} initials={state.user.initials} onExpand={() => setCollapsed(false)} />

      <div className="sh-body">
        <TopBar task={nav.task} jobOpen={jobOpen} onBack={closeJob} />

        <main className="main">
          {failure && (
            <div className="sh-banner">
              <ErrorNote
                live
                what={failure.what}
                fix={failure.fix}
                retryLabel="Recheck"
                onRetry={async () => {
                  try {
                    await api('/api/claude');
                    await refresh();
                    setToast('Rechecked Claude connection.');
                  } catch (e: any) {
                    setToast(String(e.message));
                  }
                }}
              />
            </div>
          )}
          <div className="sh-view">
            {loc.view === 'jobs' && <JobsScreen {...screens} />}
            {loc.view === 'pending' && <PendingScreen {...screens} />}
            {loc.view === 'profile' && <Interim.Profile {...screens} />}
            {loc.view === 'settings' && <Interim.Settings {...screens} />}
          </div>
        </main>
      </div>

      <TabBar {...nav} />

      {toastEl}
    </div>
  );
}

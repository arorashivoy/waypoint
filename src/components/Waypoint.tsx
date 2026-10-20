'use client';

import { useSWRConfig } from 'swr';
import { ApiError, api, post } from './api';
import { KEYS, useMe, useRefresh, type Me } from './data';
import { useToast } from './hooks';
import ProfileScreen from './ProfileScreen';
import SettingsScreen from './SettingsScreen';
import { JobsView, PendingView } from './shell/Views';
import Loading from './shell/Loading';
import Rail from './shell/Rail';
import Sidebar from './shell/Sidebar';
import TabBar from './shell/TabBar';
import TopBar from './shell/TopBar';
import { claudeLine, taskLine } from './shell/task';
import { sectionQuery } from './settings/model';
import { useCollapsed, useLocation } from './shell/useShell';
import { ErrorNote } from './ui';

export default function Waypoint() {
  const { data: state, error, mutate: reloadMe } = useMe();
  const refresh = useRefresh();
  const { mutate } = useSWRConfig();
  const { loc, go, openJob, closeJob } = useLocation();
  const [collapsed, setCollapsed] = useCollapsed();
  const [toast, setToast] = useToast();
  const loadError = state === undefined && error && !(error instanceof ApiError && error.status === 401) ? String(error.message) : null;

  const toggleCountry = async (cc: string, on: boolean) => {
    await mutate(
      KEYS.me,
      (me?: Me) => me && { ...me, countries: me.countries.map((c) => (c.cc === cc ? { ...c, on } : c)) },
      { revalidate: false },
    );
    try {
      await post('/api/countries', { cc, on });
    } finally {
      // The job list depends on the countries, so it loads again. On a failure this also puts back the real choice.
      await refresh();
    }
  };

  // The empty Jobs list opens the Job search section. Go to Settings first, then name the section in the URL before Settings reads it.
  const openJobSearch = () => {
    go('settings');
    window.history.replaceState(null, '', `${window.location.pathname}${sectionQuery('job-search')}`);
  };

  const toastEl = toast && <div className="toast" role="status">{toast}</div>;

  if (!state) {
    return (
      <Loading error={loadError} onRetry={() => { reloadMe(); }} />
    );
  }

  const nav = { place: loc.view, go, needsCount: state.needsCount, task: taskLine(state.analysing) };
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
            {loc.view === 'jobs' && <JobsView me={state} refresh={refresh} setToast={setToast} openJob={openJob} closeJob={closeJob} selected={loc.job} goToSettings={openJobSearch} />}
            {loc.view === 'pending' && <PendingView refresh={refresh} setToast={setToast} onJobs={() => go('jobs')} />}
            {loc.view === 'profile' && <ProfileScreen state={state} refresh={refresh} setToast={setToast} />}
            {loc.view === 'settings' && <SettingsScreen state={state} setToast={setToast} toggleCountry={toggleCountry} />}
          </div>
        </main>
      </div>

      <TabBar {...nav} />

      {toastEl}
    </div>
  );
}

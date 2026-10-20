'use client';

import { useCallback, useEffect, useState } from 'react';
import { del, leaveSession, post } from './api';
import { useSettings } from './data';
import { Tabs } from './ui';
import AccountSection from './settings/AccountSection';
import AdminSection from './settings/AdminSection';
import ClaudeSection from './settings/ClaudeSection';
import DataSection from './settings/DataSection';
import IntegrationsSection from './settings/IntegrationsSection';
import JobSearch from './settings/JobSearch';
import { readSection, sectionQuery, visibleSections, type SettingsSection } from './settings/model';

/** True from 640 px: the sections are a list on the left. Under 640 px they are tabs across the top. */
function useSideList() {
  const [side, setSide] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(min-width: 640px)');
    const update = () => setSide(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  return side;
}

type Props = { state: any; setToast: (s: string) => void; toggleCountry: (cc: string, on: boolean) => void | Promise<unknown> };

export default function SettingsScreen({ state, setToast, toggleCountry }: Props) {
  const isAdmin = state?.user?.role === 'admin';
  const [section, setSection] = useState<SettingsSection>('account');
  const side = useSideList();
  const settings = useSettings(isAdmin);

  // The section is in the URL (?view=settings&section=job-search), so a reload or a shared link keeps it.
  useEffect(() => {
    setSection(readSection(window.location.search, isAdmin));
    const onPop = () => setSection(readSection(window.location.search, isAdmin));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isAdmin]);
  // On a phone the tab strip scrolls sideways: bring the chosen tab into view.
  useEffect(() => {
    document.querySelector<HTMLElement>('.pf [role="tab"][aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [section, side]);
  const choose = useCallback((next: SettingsSection) => {
    setSection(next);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${sectionQuery(next)}`);
  }, []);

  /** True when the request worked. On an error it shows the message and returns false. */
  const run = useCallback(async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) setToast(done);
      await settings.reload();
      return true;
    } catch (e) {
      setToast((e as Error).message);
      return false;
    }
  }, [setToast, settings]);

  const leave = (url: string, method: 'post' | 'del') => leaveSession(() => (method === 'post' ? post(url) : del(url)), setToast);

  const panel = (id: SettingsSection) => {
    if (id !== section) return null;
    switch (id) {
      case 'account':
        return <AccountSection user={state?.user ?? {}} sessions={settings.sessions.data?.sessions} error={settings.sessions.error} retry={settings.sessions.mutate} run={run} leave={leave} />;
      case 'claude':
        return <ClaudeSection claude={settings.claude.data ?? null} error={settings.claude.error} retry={settings.claude.mutate} run={run} isAdmin={isAdmin} />;
      case 'job-search':
        return (
          <JobSearch
            countries={state?.countries ?? []}
            onToggle={toggleCountry}
            globalSites={state?.globalSites ?? []}
            careerLinks={state?.careerLinks ?? []}
            search={settings.search.data ?? null}
            searchError={settings.search.error}
            retrySearch={settings.search.mutate}
            boards={settings.feeds.data}
            boardsError={settings.feeds.error}
            retryBoards={settings.feeds.mutate}
            reload={settings.reload}
            setToast={setToast}
          />
        );
      case 'integrations':
        return <IntegrationsSection hint={settings.github.data?.hint} error={settings.github.error} retry={settings.github.mutate} run={run} />;
      case 'data':
        return <DataSection isAdmin={isAdmin} setToast={setToast} />;
      case 'admin':
        return <AdminSection users={settings.users.data?.users} error={settings.users.error} retry={settings.users.mutate} run={run} setToast={setToast} />;
    }
  };

  return (
    <>
      <header className="screen-head">
        <h1 className="display">Settings</h1>
        <p className="sub">Your account, Claude, your job search and your data</p>
      </header>
      <div className="pf st">
        <Tabs
          label="Settings sections"
          orientation={side ? 'vertical' : 'horizontal'}
          value={section}
          onChange={(id) => choose(id as SettingsSection)}
          tabs={visibleSections(isAdmin).map((s) => ({ id: s.id, label: s.label, panel: panel(s.id) }))}
        />
      </div>
    </>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSWRConfig } from 'swr';
import { del, leaveSession, patch, post } from './api';
import { KEYS, useSettings } from './data';
import { Tabs } from './ui';
import AccountSection from './settings/AccountSection';
import AdminSection from './settings/AdminSection';
import ClaudeSection from './settings/ClaudeSection';
import DataSection from './settings/DataSection';
import IntegrationsSection from './settings/IntegrationsSection';
import JobSearch from './settings/JobSearch';
import { readSection, sectionQuery, visibleSections, type SettingsSection } from './settings/model';
import { useSideList, useTabFade } from './shell/sideList';

type Props = { state: any; setToast: (s: string) => void; toggleCountry: (cc: string, on: boolean) => void | Promise<unknown>; /** The wizard may show again: the app stops skipping it. */ onReopenWizard?: () => void };

export default function SettingsScreen({ state, setToast, toggleCountry, onReopenWizard }: Props) {
  const isAdmin = state?.user?.role === 'admin';
  const [section, setSection] = useState<SettingsSection>(() => (typeof window === 'undefined' ? 'account' : readSection(window.location.search, isAdmin)));
  const side = useSideList();
  const settings = useSettings(isAdmin);
  const { mutate } = useSWRConfig();
  // A user who skipped the wizard can open it again. The address loses ?view=, so the wizard shows.
  const finishSetup = useCallback(async () => {
    try {
      await patch('/api/onboarding', { onboarded: false });
      window.history.replaceState(null, '', window.location.pathname);
      onReopenWizard?.();
      await mutate(KEYS.me);
    } catch (e) {
      setToast((e as Error).message);
    }
  }, [mutate, setToast, onReopenWizard]);

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
  useTabFade('.st [role="tablist"]', [side, section]);
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
        return <AccountSection user={state?.user ?? {}} sessions={settings.sessions.data?.sessions} error={settings.sessions.error} retry={settings.sessions.mutate} run={run} leave={leave} finishSetup={state?.onboarding?.step ? finishSetup : undefined} />;
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

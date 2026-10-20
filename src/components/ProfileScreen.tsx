'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProfile, type ProfileData } from './data';
import { Badge, Button, ErrorNote, Skeleton, Tabs } from './ui';
import { PROFILE_TABS, readTab, tabQuery, type ProfileTab } from './profile/model';
import { ProfileVersionContext, useProfileVersionValue } from './profile/version';
import ExperienceTab from './profile/ExperienceTab';
import ProjectsTab from './profile/ProjectsTab';
import ClaimsTab from './profile/ClaimsTab';
import ImportsTab from './profile/ImportsTab';
import ResumeTab from './profile/ResumeTab';

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

export default function ProfileScreen({ state: me, refresh, setToast }: { state: any; refresh: () => Promise<any>; setToast: (s: string) => void }) {
  const [tab, setTab] = useState<ProfileTab>('experience');
  const side = useSideList();
  // After a save or an accept, a quiet line points to the profile history, where the user can undo it.
  const [changedNote, setChangedNote] = useState(false);
  const { data, error, mutate } = useProfile();
  // The tabs read the summary, the contacts and the last import from the same state as before.
  const state = useMemo(() => (data ? { ...me, ...data.view } : me), [me, data]);

  // The tab is in the URL (?view=profile&tab=claims), so a reload or a shared link keeps it.
  useEffect(() => {
    setTab(readTab(window.location.search));
    const onPop = () => setTab(readTab(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // On a phone the tab strip scrolls sideways: bring the chosen tab into view.
  useEffect(() => {
    document.querySelector<HTMLElement>('.pf [role="tab"][aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [tab, side, data]);
  const choose = useCallback((next: ProfileTab) => {
    setTab(next);
    if (next === 'resume') setChangedNote(false);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${tabQuery(next)}`);
  }, []);

  // The profile history is the last panel of the Résumé tab: open the tab and bring the panel into view.
  const goto = useCallback((next: ProfileTab) => {
    choose(next);
    if (next === 'resume') setTimeout(() => document.getElementById('pf-history')?.scrollIntoView({ block: 'start' }), 60);
  }, [choose]);

  /** After a change: the new profile, and the other screens, because job scores read the profile. */
  const changed = useCallback(async () => {
    await refresh();
  }, [refresh]);
  // The reply of a save has the new version. Take it at once, so the next save does not send the old one.
  const onSaved = useCallback((reply?: { doc?: ProfileData['doc']; version?: number }) => {
    setChangedNote(true);
    if (reply?.doc && typeof reply.version === 'number') {
      const { doc, version } = reply;
      mutate((d?: ProfileData) => d && { ...d, doc, version }, { revalidate: false });
    }
    changed().catch((e) => setToast((e as Error).message));
  }, [changed, setToast, mutate]);

  const onCount = useCallback(
    (n: number) => { mutate((d?: ProfileData) => (d && d.pendingDrafts !== n ? { ...d, pendingDrafts: n } : d), { revalidate: false }); },
    [mutate],
  );

  const version = useProfileVersionValue(data, mutate);

  const drafts = data?.pendingDrafts ?? 0;
  const panel = (id: ProfileTab) => {
    if (!data || id !== tab) return null;
    switch (id) {
      case 'experience': return <ExperienceTab doc={data.doc} levels={me?.levels} onSaved={onSaved} setToast={setToast} onGoto={goto} />;
      case 'projects': return <ProjectsTab doc={data.doc} onSaved={onSaved} setToast={setToast} onGoto={goto} />;
      case 'claims': return <ClaimsTab doc={data.doc} warnings={data.warnings} onSaved={onSaved} setToast={setToast} />;
      case 'imports': return <ImportsTab doc={data.doc} version={data.version} state={state} changed={changed} setToast={setToast} onCount={onCount} drafts={drafts} onAccepted={() => setChangedNote(true)} />;
      case 'resume': return <ResumeTab state={state} version={data.version} changed={changed} setToast={setToast} />;
    }
  };

  return (
    <ProfileVersionContext.Provider value={version}>
      <header className="screen-head">
        <h1 className="display">Profile</h1>
        <p className="sub">{data ? [data.doc.profile.name, data.doc.profile.headline].filter(Boolean).join(', ') || 'Add your name and headline on the Experience tab.' : 'Loading your profile'}</p>
      </header>
      <div className="pf">
        {!data ? (
          error ? (
            <ErrorNote live what="Waypoint could not load your profile." fix={`${error.message.replace(/\.?$/, '.')} Check your connection, then try again.`} onRetry={() => { mutate(); }} />
          ) : (
            <Skeleton rows={4} />
          )
        ) : (
          <>
          {changedNote && tab !== 'resume' && (
            <p className="pf-undo">
              Profile changed. Made a mistake? <Button variant="link" onClick={() => goto('resume')}>See the profile history</Button>
            </p>
          )}
          <Tabs
            label="Profile sections"
            orientation={side ? 'vertical' : 'horizontal'}
            value={tab}
            onChange={(id) => choose(id as ProfileTab)}
            tabs={PROFILE_TABS.map((t) => ({
              id: t.id,
              label:
                t.id === 'imports' && drafts > 0 ? (
                  <>
                    {t.label} <Badge tone="coral">{drafts}</Badge>
                    <span className="sr-only">{countOfDrafts(drafts)}</span>
                  </>
                ) : (
                  t.label
                ),
              panel: panel(t.id),
            }))}
          />
          </>
        )}
      </div>
    </ProfileVersionContext.Provider>
  );
}

const countOfDrafts = (n: number) => ` (${n} ${n === 1 ? 'draft waits' : 'drafts wait'} for you)`;

'use client';

import { useCallback, useMemo, useState } from 'react';
import { STALE_PROFILE_MESSAGE } from '@/lib/profile/stale';
import { ApiError } from './api';
import { useProfile, type ProfileData } from './data';
import { ErrorNote } from './ui';
import { ProfileVersionContext } from './profile/version';
import ExperienceTab from './profile/ExperienceTab';
import ProjectsTab from './profile/ProjectsTab';
import ClaimsTab from './profile/ClaimsTab';
import ImportsTab from './profile/ImportsTab';

type Tab = 'experience' | 'projects' | 'claims' | 'imports';

const TABS: { key: Tab; label: string }[] = [
  { key: 'experience', label: 'Experience' },
  { key: 'projects', label: 'Projects' },
  { key: 'claims', label: 'Claims' },
  { key: 'imports', label: 'Imports' },
];

export default function ProfileScreen({ state: me, refresh, setToast }: { state: any; refresh: () => Promise<any>; setToast: (s: string) => void }) {
  const [tab, setTab] = useState<Tab>('experience');
  const { data, error, mutate } = useProfile();
  // The tabs read the summary, the contacts and the last import from the same state as before.
  const state = useMemo(() => (data ? { ...me, ...data.view } : me), [me, data]);

  /** After a change: the new profile, and the other screens, because job scores read the profile. */
  const changed = useCallback(async () => {
    await refresh();
  }, [refresh]);
  // The reply of a save has the new version. Take it at once, so the next save does not send the old one.
  const onSaved = useCallback((reply?: { doc?: ProfileData['doc']; version?: number }) => {
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

  const version = useMemo(
    () => ({
      version: data?.version ?? 0,
      reload: async () => (await mutate()) as ProfileData | undefined,
      onStale: (e: unknown) => {
        if (e instanceof ApiError && e.status === 409 && e.message === STALE_PROFILE_MESSAGE) mutate();
      },
    }),
    [data?.version, mutate],
  );

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.key);
    document.getElementById(`tab-${next.key}`)?.focus();
  };

  return (
    <ProfileVersionContext.Provider value={version}>
      <header className="screen-head">
        <h1 className="display">Profile</h1>
        <span className="sub">{data ? [data.doc.profile.name, data.doc.profile.headline].filter(Boolean).join(' · ') : 'Loading…'}</span>
      </header>
      <div role="tablist" aria-label="Profile sections" className="tabs">
        {TABS.map((t, i) => (
          <button key={t.key} id={`tab-${t.key}`} role="tab" aria-selected={tab === t.key} aria-controls={`panel-${t.key}`} tabIndex={tab === t.key ? 0 : -1} className="tab-btn" onClick={() => setTab(t.key)} onKeyDown={(e) => onKey(e, i)}>
            {t.label}
            {t.key === 'imports' && (data?.pendingDrafts ?? 0) > 0 && <span className="badge mono">{data!.pendingDrafts}</span>}
          </button>
        ))}
      </div>
      <div className="profile-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <div style={{ maxWidth: 860, minWidth: 0 }}>
          {!data ? (
            error ? (
              <ErrorNote live what="Waypoint could not load your profile." fix={`${error.message} Check your connection, then try again.`} onRetry={() => { mutate(); }} />
            ) : (
              <div className="empty">Loading the profile…</div>
            )
          ) : tab === 'experience' ? (
            <ExperienceTab doc={data.doc} levels={me?.levels} onSaved={onSaved} setToast={setToast} />
          ) : tab === 'projects' ? (
            <ProjectsTab doc={data.doc} onSaved={onSaved} setToast={setToast} />
          ) : tab === 'claims' ? (
            <ClaimsTab doc={data.doc} warnings={data.warnings} onSaved={onSaved} setToast={setToast} />
          ) : (
            <ImportsTab doc={data.doc} version={data.version} state={state} changed={changed} setToast={setToast} onCount={onCount} />
          )}
        </div>
      </div>
    </ProfileVersionContext.Provider>
  );
}

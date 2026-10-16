'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ClaimsDoc } from '@/lib/profile/doc';
import { api } from './api';
import ExperienceTab from './profile/ExperienceTab';
import ProjectsTab from './profile/ProjectsTab';
import ClaimsTab from './profile/ClaimsTab';
import LinkedInPanel from './profile/LinkedInPanel';

type Tab = 'experience' | 'projects' | 'claims' | 'imports';
export type ProfileData = { doc: ClaimsDoc; warnings: string[]; version: number; pendingDrafts: number };

const TABS: { key: Tab; label: string }[] = [
  { key: 'experience', label: 'Experience' },
  { key: 'projects', label: 'Projects' },
  { key: 'claims', label: 'Claims' },
  { key: 'imports', label: 'Imports' },
];

export default function ProfileScreen({ state, refresh, setToast }: { state: any; refresh: () => Promise<any>; setToast: (s: string) => void }) {
  const [tab, setTab] = useState<Tab>('experience');
  const [data, setData] = useState<ProfileData | null>(null);

  const load = useCallback(async () => setData(await api<ProfileData>('/api/profile')), []);
  useEffect(() => {
    load().catch((e) => setToast((e as Error).message));
  }, [load, setToast]);

  /** After a change: the new profile, and the app state, because job scores read the profile. */
  const changed = useCallback(async () => {
    await load();
    await refresh();
  }, [load, refresh]);
  const onSaved = useCallback(() => {
    changed().catch((e) => setToast((e as Error).message));
  }, [changed, setToast]);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.key);
    document.getElementById(`tab-${next.key}`)?.focus();
  };

  return (
    <>
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
            <div className="empty">Loading the profile…</div>
          ) : tab === 'experience' ? (
            <ExperienceTab key={data.version} doc={data.doc} onSaved={onSaved} setToast={setToast} />
          ) : tab === 'projects' ? (
            <ProjectsTab doc={data.doc} onSaved={onSaved} setToast={setToast} />
          ) : tab === 'claims' ? (
            <ClaimsTab doc={data.doc} warnings={data.warnings} onSaved={onSaved} setToast={setToast} />
          ) : (
            <LinkedInPanel state={state} refresh={changed} setToast={setToast} />
          )}
        </div>
      </div>
    </>
  );
}

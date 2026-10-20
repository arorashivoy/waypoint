'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../api';
import { Button, ErrorNote, Skeleton } from '../ui';
import { useProfileVersion } from './version';

type Revision = { id: string; note: string; createdAt: string };

export default function HistoryPanel({ version, changed, setToast }: { version: number; changed: () => Promise<void>; setToast: (s: string) => void }) {
  const { onStale } = useProfileVersion();
  const [revs, setRevs] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const load = useCallback(async () => {
    setRevs((await api<{ revisions: Revision[] }>('/api/profile/revisions')).revisions);
    setError(null);
  }, []);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load, version]);

  const restore = async (id: string) => {
    setAsking(null);
    try {
      await post(`/api/profile/revisions/${id}/restore`, { version });
      setToast('Restored. The change is in the history too, so you can undo it.');
      await changed();
    } catch (e) {
      onStale(e);
      setToast((e as Error).message);
    }
  };

  if (error && !revs) {
    return <ErrorNote what="Waypoint could not load the history." fix={`${error.replace(/\.?$/, '.')} Check your connection, then try again.`} onRetry={() => { load().catch((e) => setError((e as Error).message)); }} />;
  }
  if (!revs) return <Skeleton rows={2} />;
  if (!revs.length) return <p className="pf-note">No changes yet. Each change to your profile will show here.</p>;
  return (
    <div className="pf-stack-tight">
      <p className="pf-note">Each row is a change. Restore puts back the profile from before that change.</p>
      <ul className="pf-rows">
        {revs.map((r) => {
          const when = new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
          return (
            <li key={r.id} className="pf-row">
              <span className="pf-row-text">
                <span className="pf-row-title">{r.note}</span>
                <span className="pf-row-sub">{when}</span>
              </span>
              {asking === r.id ? (
                <span className="pf-row-actions">
                  <span className="pf-ask">Restore it?</span>
                  <Button aria-label={`Yes, restore the profile from before ${r.note}`} onClick={() => restore(r.id)}>Yes</Button>
                  <Button aria-label={`Keep the profile as it is (${r.note})`} onClick={() => setAsking(null)}>No</Button>
                </span>
              ) : (
                <Button aria-label={`Restore the profile from before ${r.note}, ${when}`} onClick={() => setAsking(r.id)}>Restore</Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

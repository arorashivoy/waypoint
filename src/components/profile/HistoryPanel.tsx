'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../api';
import { useProfileVersion } from './version';

type Revision = { id: string; note: string; createdAt: string };

export default function HistoryPanel({ version, changed, setToast }: { version: number; changed: () => Promise<void>; setToast: (s: string) => void }) {
  const { onStale } = useProfileVersion();
  const [revs, setRevs] = useState<Revision[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const load = useCallback(async () => setRevs((await api<{ revisions: Revision[] }>('/api/profile/revisions')).revisions), []);
  useEffect(() => {
    load().catch((e) => setToast((e as Error).message));
  }, [load, setToast, version]);

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

  if (!revs) return null;
  if (!revs.length) return <div className="empty" style={{ fontSize: 14 }}>No changes yet.</div>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="hint">Each row is a change. Restore puts back the profile from before that change.</span>
      {revs.map((r) => (
        <div key={r.id} className="row" style={{ gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <span className="stack grow" style={{ minWidth: 0 }}>
            <span style={{ overflowWrap: 'anywhere' }}>{r.note}</span>
            <span className="hint">{new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </span>
          {asking === r.id ? (
            <span className="row" style={{ gap: 8 }}>
              <span>Restore?</span>
              <button className="btn" onClick={() => restore(r.id)}>Yes</button>
              <button className="btn" onClick={() => setAsking(null)}>No</button>
            </span>
          ) : (
            <button className="btn" onClick={() => setAsking(r.id)}>Restore</button>
          )}
        </div>
      ))}
    </div>
  );
}

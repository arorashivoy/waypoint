'use client';

import { useState } from 'react';
import { copyAndOpen, patch, post } from './api';

/**
 * Nothing on this board can be driven by LinkedIn, so every transition is the
 * user telling Waypoint what happened: they replied with this text. In exchange Waypoint does the drafting and the certainty check.
 */
export default function PendingScreen({ state, refresh, setToast }: { state: any; refresh: () => Promise<any>; setToast: (s: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replying, setReplying] = useState<string | null>(null);
  const [incoming, setIncoming] = useState('');

  const send = async (n: any) => {
    setBusy(n.id);
    try {
      const body = drafts[n.id] ?? n.draft;
      const res = await patch<{ copy: string; open: string | null }>(`/api/outreach/${n.id}`, { handled: true, body });
      await copyAndOpen(res.copy, res.open);
      setToast('Message copied and LinkedIn opened. Paste and send it there.');
      await refresh();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submitReply = async (a: any) => {
    setBusy(a.id);
    try {
      const res = await post<{ certain: boolean }>('/api/outreach', { jobId: a.jobId, action: 'replied', incoming });
      setReplying(null);
      setIncoming('');
      await refresh();
      setToast(res.certain ? 'The answer was already on file, so the reply is drafted and marked safe to send.' : 'That reply needs a decision from you — it is in Needs you with the reason.');
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <header className="screen-head">
        <h1 className="display">Pending applications</h1>
        <span className="sub">
          Waypoint cannot see your LinkedIn inbox. When someone replies, paste it here; the answer is marked safe to send only when it was already on file.
        </span>
      </header>

      <div className="board">
        <div className="column">
          <div className="column-head">
            <span className="grow">Needs you</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--accent-ink)' }}>{state.needs.length}</span>
          </div>
          {state.needs.length === 0 && <div className="empty" style={{ padding: 14, fontSize: 14 }}>Nothing waiting on you.</div>}
          {state.needs.map((n: any) => (
            <article key={n.id} className="pend-card flash" data-needs="true">
              <span className="mono" style={{ fontSize: 12, color: 'var(--accent-ink)' }}>{n.kind} · {n.when}</span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="avatar avatar-light avatar-sm">{n.init}</span>
                <div className="stack">
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{n.who}</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{n.org}</span>
                </div>
              </div>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{n.role}</span>
              {n.quote && <p className="quote">“{n.quote}”</p>}
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{n.draftLabel}</span>
              {editing === n.id ? (
                <textarea
                  className="note-area"
                  style={{ minHeight: 140 }}
                  value={drafts[n.id] ?? n.draft}
                  onChange={(e) => setDrafts({ ...drafts, [n.id]: e.target.value })}
                />
              ) : (
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{drafts[n.id] ?? n.draft}</p>
              )}
              {n.reason && <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--accent-ink)' }}>{n.reason}</span>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-accent" style={{ height: 44, fontSize: 15 }} onClick={() => send(n)} disabled={busy === n.id}>
                  {busy === n.id ? 'Copying…' : n.action}
                </button>
                <button className="btn" style={{ padding: '0 14px' }} onClick={() => setEditing(editing === n.id ? null : n.id)}>
                  {editing === n.id ? 'Done' : 'Edit'}
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="column">
          <div className="column-head">
            <span className="grow">Waiting for a reply</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted-3)' }}>{state.awaiting.length}</span>
          </div>
          {state.awaiting.length === 0 && <div className="empty" style={{ padding: 14, fontSize: 14 }}>No referral requests out. Find a contact from a job.</div>}
          {state.awaiting.map((a: any) => (
            <article key={a.id} className="pend-card">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="avatar avatar-light avatar-sm">{a.init}</span>
                <div className="stack">
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{a.who}</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{a.org}</span>
                </div>
              </div>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{a.role}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--muted-3)' }}>{a.when}{a.why ? ` · ${a.why}` : ''}</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" style={{ height: 44, flexGrow: 1 }} onClick={() => { setReplying(replying === a.id ? null : a.id); setIncoming(''); }}>
                  They replied
                </button>
              </div>
              {replying === a.id && (
                <div className="stack" style={{ gap: 8 }}>
                  <label htmlFor={`in-${a.id}`} style={{ fontSize: 13, color: 'var(--muted)' }}>Paste what they wrote. Waypoint drafts the answer and decides whether it is safe to send.</label>
                  <textarea id={`in-${a.id}`} className="note-area" style={{ minHeight: 100 }} value={incoming} onChange={(e) => setIncoming(e.target.value)} />
                  <button className="btn btn-dark" style={{ height: 44 }} onClick={() => submitReply(a)} disabled={busy === a.id || !incoming.trim()}>
                    {busy === a.id ? 'Reading…' : 'Draft a reply'}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>

        <div className="column">
          <div className="column-head">
            <span className="grow">Safe to send</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted-3)' }}>{state.auto.length}</span>
          </div>
          {state.auto.length === 0 && <div className="empty" style={{ padding: 14, fontSize: 14 }}>Nothing was certain enough to answer on its own yet.</div>}
          {state.auto.map((r: any) => (
            <article key={r.id} className="pend-card">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="avatar avatar-light avatar-sm">{r.init}</span>
                <div className="stack">
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{r.who}</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{r.org}</span>
                </div>
              </div>
              <p className="quote">“{r.quote}”</p>
              <p className="sent-body">{r.sent}</p>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--positive)' }}>{r.why}</span>
              {!r.handled && (
                <button className="btn" style={{ height: 44 }} onClick={() => send({ id: r.id, draft: r.sent })} disabled={busy === r.id}>
                  {busy === r.id ? 'Copying…' : 'Copy and open LinkedIn'}
                </button>
              )}
            </article>
          ))}
        </div>

        <div className="column">
          <div className="column-head">
            <span className="grow">Applied</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted-3)' }}>{state.appliedList.length}</span>
          </div>
          {state.appliedList.length === 0 && <div className="empty" style={{ padding: 14, fontSize: 14 }}>Nothing yet. Mark a job applied and it moves here.</div>}
          {state.appliedList.map((p: any) => (
            <article key={p.id} className="pend-card" style={{ gap: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{p.role}</span>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{p.company} · {p.city}</span>
              {p.cvUrl && (
                <span style={{ fontSize: 13, color: 'var(--muted-2)' }}>
                  <a href={p.cvUrl} target="_blank" rel="noreferrer">The CV they read</a>
                  {p.cvLead ? ` · leads with ${p.cvLead}` : ''}
                  {p.cvSent ? ` · sent ${p.cvSent}` : ''}
                </span>
              )}
            </article>
          ))}
        </div>
      </div>
    </>
  );
}

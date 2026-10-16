'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClaimsDoc, DiffLine } from '@/lib/profile/doc';
import { ITEM_KINDS, type Item, type ItemKind } from '@/lib/profile/apply';
import { ApiError, api, post } from '../api';
import ItemEditor from './ItemEditor';
import { summaryOf } from './fields';

type Draft = {
  id: string; batchId: string; source: string; type: string; data: any; warnings: string[];
  warningsApproved: boolean; matches: string | null; existing: any; diff: DiffLine[] | null; createdAt: string;
};

const SOURCE: Record<string, string> = { linkedin: 'LinkedIn export', resume: 'Résumé', github: 'GitHub', yaml: 'claims.yml', test: 'Test' };
const isItem = (t: string): t is ItemKind => (ITEM_KINDS as readonly string[]).includes(t);
const blocked = (d: Draft) => d.warnings.length > 0 && !d.warningsApproved;

function Facts({ value }: { value: any }) {
  if (!value || typeof value !== 'object') return <span className="hint">—</span>;
  const rows = Object.entries(value).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
  return (
    <dl style={{ margin: 0, fontSize: 14, display: 'grid', gap: 4 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <dt className="label" style={{ display: 'inline' }}>{k} </dt>
          <dd style={{ display: 'inline', margin: 0, overflowWrap: 'anywhere' }}>{Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? x.text ?? x.match ?? x.target ?? x.surface ?? JSON.stringify(x) : x)).join(' · ') : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function DraftList({ doc, changed, setToast, onCount }: { doc: ClaimsDoc; changed: () => Promise<void>; setToast: (s: string) => void; onCount: (n: number) => void }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    const r = await api<{ drafts: Draft[] }>('/api/profile/drafts');
    setDrafts(r.drafts);
    onCount(r.drafts.length);
  }, [onCount]);
  useEffect(() => {
    load().catch((e) => setToast((e as Error).message));
  }, [load, setToast]);

  const batches = useMemo(() => {
    const m = new Map<string, Draft[]>();
    for (const d of drafts ?? []) m.set(d.batchId, [...(m.get(d.batchId) ?? []), d]);
    return [...m.entries()];
  }, [drafts]);

  const act = async (batchId: string, fn: () => Promise<unknown>, done: string) => {
    setErrors((e) => ({ ...e, [batchId]: [] }));
    try {
      await fn();
      setToast(done);
      await load();
      await changed();
    } catch (e) {
      setErrors((x) => ({ ...x, [batchId]: e instanceof ApiError && Array.isArray(e.data.errors) ? e.data.errors : [(e as Error).message] }));
    }
  };

  if (!drafts) return <div className="empty">Loading the drafts…</div>;
  if (!drafts.length) return <div className="empty" style={{ fontSize: 14 }}>No drafts wait for you. An import puts its drafts here, and the profile changes only when you accept them.</div>;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {batches.map(([batchId, list]) => {
        const ready = list.filter((d) => !blocked(d)).map((d) => d.id);
        return (
          <section key={batchId} className="card stack" style={{ gap: 12, padding: 18 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <h3 className="grow" style={{ margin: 0, fontSize: 18 }}>
                {SOURCE[list[0].source] ?? list[0].source} · {new Date(list[0].createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {list.length} draft{list.length === 1 ? '' : 's'}
              </h3>
              {list[0].type !== 'profile' && (
                <button className="btn btn-dark" disabled={!ready.length} onClick={() => act(batchId, () => post('/api/profile/drafts/accept', { ids: ready }), `Accepted ${ready.length} drafts.`)}>
                  Accept {ready.length === list.length ? 'all' : `${ready.length} without warnings`}
                </button>
              )}
              <button className="btn" onClick={() => act(batchId, () => post('/api/profile/drafts/reject', { ids: list.map((d) => d.id) }), 'Rejected.')}>Reject all</button>
            </div>
            {errors[batchId]?.length ? <ul className="err" role="alert">{errors[batchId].map((e) => <li key={e}>{e}</li>)}</ul> : null}

            {list.map((d) => {
              if (editing === d.id && isItem(d.type)) {
                return (
                  <ItemEditor key={d.id} kind={d.type} doc={doc} itemKey={null} item={d.data as Item} mode={{ draftId: d.id }} onCancel={() => setEditing(null)}
                    onDone={() => { setEditing(null); load().catch(() => {}); }} />
                );
              }
              const title = d.type === 'profile' ? 'The full profile from claims.yml' : d.type === 'meta' ? `Headline: ${d.data?.headline ?? ''}` : isItem(d.type) ? summaryOf(d.type, d.data).title : d.type;
              return (
                <div key={d.id} className="stack" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="tag">{d.type}</span>
                    <strong className="grow" style={{ overflowWrap: 'anywhere' }}>{title}</strong>
                    {d.matches && <span className="hint">matches “{d.matches}”</span>}
                  </div>
                  {d.warnings.length > 0 && (
                    <div className="stack" style={{ gap: 6, padding: 10, borderRadius: 8, background: '#FEF3C7', color: '#78350F' }} role="alert">
                      {d.warnings.map((w) => <span key={w} style={{ fontSize: 14 }}>{w}</span>)}
                      {!d.warningsApproved && (
                        <div><button className="btn" onClick={() => act(batchId, () => post(`/api/profile/drafts/${d.id}/approve`), 'Warning approved.')}>I checked it</button></div>
                      )}
                    </div>
                  )}
                  {d.diff ? (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                      {d.diff.slice(0, 40).map((x) => <li key={`${x.kind}:${x.key}`}>{x.change} {x.kind}: {x.label}</li>)}
                      {d.diff.length > 40 && <li>and {d.diff.length - 40} more</li>}
                    </ul>
                  ) : d.existing ? (
                    <div className="merge">
                      <div className="stack" style={{ gap: 4 }}><span className="label">Now</span><Facts value={d.existing} /></div>
                      <div className="stack" style={{ gap: 4 }}><span className="label">Draft (adds to it)</span><Facts value={d.data} /></div>
                    </div>
                  ) : (
                    <Facts value={d.data} />
                  )}
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-dark" disabled={blocked(d)} onClick={() => act(batchId, () => post('/api/profile/drafts/accept', { ids: [d.id] }), 'Accepted.')}>{d.type === 'profile' ? 'Replace my profile' : 'Accept'}</button>
                    {isItem(d.type) && <button className="btn" onClick={() => setEditing(d.id)}>Edit</button>}
                    <button className="btn" onClick={() => act(batchId, () => post('/api/profile/drafts/reject', { ids: [d.id] }), 'Rejected.')}>Reject</button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClaimsDoc, DiffLine } from '@/lib/profile/doc';
import { ITEM_KINDS, type Item, type ItemKind } from '@/lib/profile/apply';
import { ApiError, api, post } from '../api';
import { Button, ErrorNote, Sheet, Skeleton } from '../ui';
import ItemEditor from './ItemEditor';
import Problems from './Problems';
import { summaryOf } from './fields';
import { actionName, countOf, factRows } from './model';
import { useProfileVersion } from './version';

type Draft = {
  id: string; batchId: string; source: string; type: string; data: any; warnings: string[];
  warningsApproved: boolean; matches: string | null; existing: any; diff: DiffLine[] | null; createdAt: string;
};

const SOURCE: Record<string, string> = { linkedin: 'LinkedIn export', resume: 'Résumé', github: 'GitHub', yaml: 'claims.yml', test: 'Test' };
const TYPE: Record<string, string> = { position: 'Position', education: 'Education', project: 'Project', claim: 'Claim', meta: 'Headline', profile: 'Profile' };
const isItem = (t: string): t is ItemKind => (ITEM_KINDS as readonly string[]).includes(t);
const blocked = (d: Draft) => d.warnings.length > 0 && !d.warningsApproved;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function titleOf(d: Draft): string {
  if (d.type === 'profile') return 'The full profile from claims.yml';
  if (d.type === 'meta') return `Headline: ${d.data?.headline ?? ''}`;
  return isItem(d.type) ? summaryOf(d.type, d.data).title : d.type;
}

function Facts({ value }: { value: unknown }) {
  const rows = factRows(value);
  if (!rows.length) return <span className="pf-note">Nothing in it.</span>;
  return (
    <dl className="pf-facts">
      {rows.map((r) => (
        <div key={r.key}>
          <dt>{r.label}</dt>
          <dd>{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function DraftList({ doc, changed, setToast, onCount }: { doc: ClaimsDoc; changed: () => Promise<void>; setToast: (s: string) => void; onCount: (n: number) => void }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { version, onStale } = useProfileVersion();
  // One list of problems for the whole section: it is the only live region here.
  const [problems, setProblems] = useState<string[]>([]);

  const load = useCallback(async () => {
    const r = await api<{ drafts: Draft[] }>('/api/profile/drafts');
    setDrafts(r.drafts);
    setLoadError(null);
    onCount(r.drafts.length);
  }, [onCount]);
  useEffect(() => {
    load().catch((e) => setLoadError((e as Error).message));
  }, [load]);

  const batches = useMemo(() => {
    const m = new Map<string, Draft[]>();
    for (const d of drafts ?? []) m.set(d.batchId, [...(m.get(d.batchId) ?? []), d]);
    return [...m.entries()];
  }, [drafts]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    setProblems([]);
    try {
      await fn();
      setToast(done);
      await load();
      await changed();
    } catch (e) {
      onStale(e);
      setProblems(e instanceof ApiError && Array.isArray(e.data.errors) ? e.data.errors : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  if (loadError && !drafts) {
    return <ErrorNote what="Waypoint could not load the drafts." fix={`${loadError.replace(/\.?$/, '.')} Check your connection, then try again.`} onRetry={() => { load().catch((e) => setLoadError((e as Error).message)); }} />;
  }
  if (!drafts) return <Skeleton rows={2} />;
  if (!drafts.length) {
    return (
      <>
        <Problems live list={problems} />
        <p className="pf-note">No drafts wait for you. An import puts its drafts here, and the profile changes only when you accept them.</p>
      </>
    );
  }

  const editingDraft = editing ? drafts.find((d) => d.id === editing) : undefined;

  return (
    <div className="pf-stack">
      <Problems live list={problems} />
      {batches.map(([batchId, list]) => {
        const ready = list.filter((d) => !blocked(d)).map((d) => d.id);
        const source = SOURCE[list[0].source] ?? list[0].source;
        const where = `${source} of ${day(list[0].createdAt)}`;
        return (
          <section key={batchId} className="glass ui-panel pf-batch" aria-label={where}>
            <div className="pf-head">
              <div>
                <h3 className="ui-panel-title">{source}</h3>
                <p className="pf-sub">{day(list[0].createdAt)}, {countOf(list.length, 'draft')}</p>
              </div>
              <div className="pf-actions">
                {list[0].type !== 'profile' && (
                  <Button variant="go" aria-label={`Accept ${ready.length === list.length ? 'all' : `${ready.length} without warnings`} from ${where}`} disabled={busy || !ready.length}
                    onClick={() => act(() => post('/api/profile/drafts/accept', { ids: ready, version }), `Accepted ${countOf(ready.length, 'draft')}.`)}>
                    Accept {ready.length === list.length ? 'all' : `${ready.length} without warnings`}
                  </Button>
                )}
                <Button aria-label={`Reject all from ${where}`} disabled={busy} onClick={() => act(() => post('/api/profile/drafts/reject', { ids: list.map((d) => d.id) }), 'Rejected.')}>Reject all</Button>
              </div>
            </div>

            <ul className="pf-rows">
              {list.map((d) => {
                const title = titleOf(d);
                return (
                  <li key={d.id} className="pf-draft">
                    <div className="pf-draft-head">
                      <span className="tag">{TYPE[d.type] ?? d.type}</span>
                      <strong>{title}</strong>
                    </div>
                    {d.matches && <p className="pf-note">It matches “{d.matches}”, so accepting adds to that item.</p>}
                    {d.warnings.length > 0 && (
                      <div className="pf-warn">
                        <ul>{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                        {!d.warningsApproved && (
                          <Button aria-label={actionName('I checked', title)} disabled={busy} onClick={() => act(() => post(`/api/profile/drafts/${d.id}/approve`), 'Warning approved.')}>I checked it</Button>
                        )}
                      </div>
                    )}
                    {d.diff ? (
                      <ul className="pf-plain">
                        {d.diff.slice(0, 40).map((x) => <li key={`${x.kind}:${x.key}`}>{x.change} {x.kind}: {x.label}</li>)}
                        {d.diff.length > 40 && <li>and {d.diff.length - 40} more</li>}
                      </ul>
                    ) : d.existing ? (
                      <div className="pf-merge">
                        <div><span className="pf-group-title">Now</span><Facts value={d.existing} /></div>
                        <div><span className="pf-group-title">Draft (adds to it)</span><Facts value={d.data} /></div>
                      </div>
                    ) : (
                      <Facts value={d.data} />
                    )}
                    <div className="pf-actions">
                      <Button className="btn-dark" aria-label={actionName(d.type === 'profile' ? 'Replace my profile with' : 'Accept', title)} disabled={busy || blocked(d)}
                        onClick={() => act(() => post('/api/profile/drafts/accept', { ids: [d.id], version }), 'Accepted.')}>
                        {d.type === 'profile' ? 'Replace my profile' : 'Accept'}
                      </Button>
                      {isItem(d.type) && <Button aria-label={actionName('Edit', title)} onClick={() => setEditing(d.id)}>Edit</Button>}
                      <Button aria-label={actionName('Reject', title)} disabled={busy} onClick={() => act(() => post('/api/profile/drafts/reject', { ids: [d.id] }), 'Rejected.')}>Reject</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <Sheet open={!!editingDraft && isItem(editingDraft.type)} onClose={() => setEditing(null)} title="Edit draft" className="pf-sheet">
        {editingDraft && isItem(editingDraft.type) && (
          <ItemEditor
            key={editingDraft.id}
            kind={editingDraft.type}
            doc={doc}
            itemKey={null}
            item={editingDraft.data as Item}
            mode={{ draftId: editingDraft.id }}
            onCancel={() => setEditing(null)}
            onDone={() => { setEditing(null); load().catch((e) => setToast((e as Error).message)); }}
          />
        )}
      </Sheet>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClaimsDoc, DiffLine } from '@/lib/profile/doc';
import { ITEM_KINDS, type Item, type ItemKind } from '@/lib/profile/apply';
import { ApiError, api, post } from '../api';
import { Button, ErrorNote, Fold, Sheet, Skeleton } from '../ui';
import ItemEditor from './ItemEditor';
import Problems from './Problems';
import { summaryOf } from './fields';
import { actionName, BATCH_PAGE, countOf, factRows, isBlocked, makeGuard, mergeRows, readyIds, uniqueNames } from './model';
import { useProfileVersion } from './version';

type Draft = {
  id: string; batchId: string; source: string; type: string; data: any; warnings: string[];
  warningsApproved: boolean; matches: string | null; existing: any; diff: DiffLine[] | null; createdAt: string;
};

const SOURCE: Record<string, string> = { linkedin: 'LinkedIn export', resume: 'Résumé', github: 'GitHub', yaml: 'claims.yml', test: 'Test' };
const TYPE: Record<string, string> = { position: 'Position', education: 'Education', project: 'Project', claim: 'Claim', meta: 'Headline', profile: 'Profile' };
const isItem = (t: string): t is ItemKind => (ITEM_KINDS as readonly string[]).includes(t);
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

/** A draft that merges into an item: only the fields that differ, and one line for the rest. */
function Merge({ existing, data }: { existing: unknown; data: unknown }) {
  const { changed, same } = mergeRows(existing, data);
  return (
    <div className="pf-stack-tight">
      <p className="pf-note">Accepting adds the draft to the item that matches.</p>
      {changed.length > 0 && (
        <dl className="pf-facts">
          {changed.map((r) => (
            <div key={r.key}>
              <dt>{r.label}</dt>
              <dd className="pf-change">
                <span><span className="pf-was">Now</span> {r.now}</span>
                <span><span className="pf-was">Draft</span> {r.draft}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {changed.length === 0 && <p className="pf-note">The draft changes nothing.</p>}
      {same.length > 0 && <p className="pf-note">Unchanged: {same.join(', ')}.</p>}
    </div>
  );
}

export default function DraftList({ doc, changed, setToast, onCount, onAccepted }: { doc: ClaimsDoc; changed: () => Promise<void>; setToast: (s: string) => void; onCount: (n: number) => void; onAccepted?: () => void }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(makeGuard()).current;
  const [limit, setLimit] = useState<Record<string, number>>({});
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

  /** One action at a time. The flag in the guard stops a second click before the screen has drawn the busy state. */
  const act = (fn: () => Promise<unknown>, done: string, accepted = false) =>
    guard.run(async () => {
      setBusy(true);
      setProblems([]);
      try {
        await fn();
        setToast(done);
        await load();
        await changed();
        if (accepted) onAccepted?.();
      } catch (e) {
        onStale(e);
        setProblems(e instanceof ApiError && Array.isArray(e.data.errors) ? e.data.errors : [(e as Error).message]);
      } finally {
        setBusy(false);
      }
    });

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
        const ready = readyIds(list);
        const source = SOURCE[list[0].source] ?? list[0].source;
        const when = day(list[0].createdAt);
        const names = uniqueNames(list.map(titleOf));
        const cap = limit[batchId] ?? BATCH_PAGE;
        const visible = list.slice(0, cap);
        const headId = `batch-${batchId}`;
        return (
          <section key={batchId} className="glass ui-panel pf-batch" aria-labelledby={headId}>
            <div className="pf-head">
              <div>
                <h3 id={headId} className="ui-panel-title">{source}</h3>
                <p className="pf-sub">{when}, {countOf(list.length, 'draft')}</p>
              </div>
              <div className="pf-actions">
                {list[0].type !== 'profile' && ready.length > 0 && (
                  <Button variant="go" aria-label={`Accept ${ready.length === list.length ? 'all' : `the ${countOf(ready.length, 'draft')} with no warning`} from ${source}, ${when}`} disabled={busy}
                    onClick={() => act(() => post('/api/profile/drafts/accept', { ids: ready, version }), `Accepted ${countOf(ready.length, 'draft')}.`, true)}>
                    {ready.length === list.length ? 'Accept all' : `Accept the ${countOf(ready.length, 'draft')} with no warning`}
                  </Button>
                )}
                <Button aria-label={`Reject all from ${source}, ${when}`} disabled={busy} onClick={() => act(() => post('/api/profile/drafts/reject', { ids: list.map((d) => d.id) }), 'Rejected.')}>Reject all</Button>
              </div>
            </div>

            <ul className="pf-rows">
              {visible.map((d, i) => {
                const title = names[i];
                const held = isBlocked(d);
                const noteId = `warn-note-${d.id}`;
                const rows = factRows(d.data);
                const merge = d.existing && !d.diff ? mergeRows(d.existing, d.data) : null;
                const status = d.diff ? countOf(d.diff.length, 'change') : merge ? countOf(merge.changed.length, 'change') : countOf(rows.length, 'field');
                return (
                  <li key={d.id} className="pf-draft">
                    <div className="pf-draft-head">
                      <span className="pf-draft-id">
                        <span className="pf-kind">{TYPE[d.type] ?? d.type}</span>
                        <strong>{titleOf(d)}</strong>
                        {d.warnings.length > 0 && <span className={`pf-dot${held ? '' : ' pf-dot-ok'}`} role="img" aria-label={held ? 'Has a warning' : 'Warning checked'} />}
                      </span>
                      <span className="pf-actions">
                        <Button
                          aria-label={actionName(d.type === 'profile' ? 'Replace my profile with' : 'Accept', title)}
                          aria-disabled={held || undefined}
                          aria-describedby={held ? noteId : undefined}
                          disabled={busy}
                          onClick={() => { if (!held) act(() => post('/api/profile/drafts/accept', { ids: [d.id], version }), 'Accepted.', true); }}
                        >
                          {d.type === 'profile' ? 'Replace my profile' : 'Accept'}
                        </Button>
                        {isItem(d.type) && <Button variant="link" aria-label={actionName('Edit', title)} onClick={() => setEditing(d.id)}>Edit</Button>}
                        <Button variant="link" aria-label={actionName('Reject', title)} disabled={busy} onClick={() => act(() => post('/api/profile/drafts/reject', { ids: [d.id] }), 'Rejected.')}>Reject</Button>
                      </span>
                    </div>
                    {d.warnings.length > 0 && (
                      <div className="pf-warn">
                        <strong className="pf-warn-lead">{held ? 'Check this draft' : 'You checked this draft'}</strong>
                        <ul>{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                        {held && (
                          <>
                            <p id={noteId} className="pf-note">Check the warning first, then press I checked it.</p>
                            <Button aria-label={actionName('I checked', title)} disabled={busy} onClick={() => act(() => post(`/api/profile/drafts/${d.id}/approve`), 'Warning approved.')}>I checked it</Button>
                          </>
                        )}
                      </div>
                    )}
                    {d.matches && <p className="pf-note">It matches “{d.matches}”.</p>}
                    <Fold quiet title="Details" status={status} defaultOpen={d.warnings.length > 0}>
                      {d.diff ? (
                        <ul className="pf-plain">
                          {d.diff.slice(0, 40).map((x, n) => <li key={`${x.kind}:${x.key}:${n}`}>{x.change} {x.kind}: {x.label}</li>)}
                          {d.diff.length > 40 && <li>and {d.diff.length - 40} more</li>}
                        </ul>
                      ) : d.existing ? (
                        <Merge existing={d.existing} data={d.data} />
                      ) : (
                        <Facts value={d.data} />
                      )}
                    </Fold>
                  </li>
                );
              })}
            </ul>
            {list.length > cap && (
              <div>
                <Button onClick={() => setLimit((l) => ({ ...l, [batchId]: list.length }))}>Show {list.length - cap} more</Button>
              </div>
            )}
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

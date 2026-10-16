'use client';

import { useState } from 'react';
import type { ClaimsDoc } from '@/lib/profile/doc';
import { itemKey, type Item, type ItemKind } from '@/lib/profile/apply';
import { del } from '../api';
import ItemEditor from './ItemEditor';
import { summaryOf } from './fields';

type Props = { kind: ItemKind; title: string; empty: string; items: Item[]; doc: ClaimsDoc; onSaved: (reply: any) => void; setToast: (s: string) => void };

/** One section of the profile: the items of one kind, with Add, Edit and Remove. */
export default function ItemList({ kind, title, empty, items, doc, onSaved, setToast }: Props) {
  const [editing, setEditing] = useState<string | null>(null); // an item key, or '+new'
  const [removing, setRemoving] = useState<string | null>(null);

  const remove = async (key: string) => {
    try {
      onSaved(await del(`/api/profile/items/${kind}/${encodeURIComponent(key)}`));
      setToast('Removed. The history in the Imports tab can put it back.');
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="card stack" style={{ gap: 12, padding: 20, marginBottom: 20 }}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <h2 className="grow" style={{ margin: 0, fontSize: 20 }}>{title}</h2>
        <button className="btn" onClick={() => setEditing('+new')} disabled={editing !== null}>Add</button>
      </div>
      {editing === '+new' && (
        <ItemEditor kind={kind} doc={doc} itemKey={null} item={null} mode="profile" onCancel={() => setEditing(null)} onDone={(r) => { setEditing(null); onSaved(r); }} />
      )}
      {items.length === 0 && editing !== '+new' && <div className="empty" style={{ fontSize: 14, padding: 18 }}>{empty}</div>}
      {items.map((item) => {
        const key = itemKey(kind, item);
        if (editing === key) {
          return <ItemEditor key={key} kind={kind} doc={doc} itemKey={key} item={item} mode="profile" onCancel={() => setEditing(null)} onDone={(r) => { setEditing(null); onSaved(r); }} />;
        }
        const s = summaryOf(kind, item);
        return (
          <div key={key} className="row item-row" style={{ gap: 12, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <span className="stack grow" style={{ minWidth: 0, gap: 2 }}>
              <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{s.title}</span>
              {s.sub && <span style={{ fontSize: 14, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{s.sub}</span>}
            </span>
            {removing === key ? (
              <span className="row" style={{ gap: 8 }}>
                <span>Remove?</span>
                <button className="btn" onClick={() => remove(key)}>Yes</button>
                <button className="btn" onClick={() => setRemoving(null)}>No</button>
              </span>
            ) : (
              <span className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={() => setEditing(key)} disabled={editing !== null}>Edit</button>
                <button className="btn" onClick={() => setRemoving(key)}>Remove</button>
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
}

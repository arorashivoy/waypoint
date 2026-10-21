'use client';

import { useState } from 'react';
import type { ClaimsDoc } from '@/lib/profile/doc';
import { itemKey, type Item, type ItemKind } from '@/lib/profile/apply';
import { del } from '../api';
import { Button, EmptyState, Sheet } from '../ui';
import ItemEditor from './ItemEditor';
import { summaryOf } from './fields';
import { actionName } from './model';
import { useProfileVersion } from './version';

/** Why a list is empty, and what the user can do. `none` leaves out the action (an empty search has nothing to add). */
export type EmptyCopy = { cause: string; detail?: string; alt?: { label: string; onClick: () => void }; none?: boolean };

type Props = {
  kind: ItemKind;
  title: string;
  /** One item in the singular: "position". The Add button and the sheet use it. */
  noun: string;
  addLabel?: string;
  /** The Add button is the main action of the tab. Only one list in a tab sets it. */
  primary?: boolean;
  empty: EmptyCopy;
  items: Item[];
  doc: ClaimsDoc;
  onSaved: (reply: any) => void;
  setToast: (s: string) => void;
};

/** One section of the profile: the items of one kind, with Add, Edit and Remove. The editor opens in a sheet. */
export default function ItemList({ kind, title, noun, addLabel = `Add a ${noun}`, primary, empty, items, doc, onSaved, setToast }: Props) {
  const [editing, setEditing] = useState<string | null>(null); // an item key, or '+new'
  const [removing, setRemoving] = useState<string | null>(null);
  const { version, onStale } = useProfileVersion();

  const remove = async (key: string) => {
    try {
      onSaved(await del(`/api/profile/items/${kind}/${encodeURIComponent(key)}?version=${version}`));
      setToast('Removed. The profile history in the Résumé tab can put it back.');
    } catch (e) {
      onStale(e);
      setToast((e as Error).message);
    } finally {
      setRemoving(null);
    }
  };

  const editingItem = editing && editing !== '+new' ? items.find((i) => itemKey(kind, i) === editing) ?? null : null;
  const close = () => setEditing(null);

  return (
    <section className="pf-section" aria-labelledby={`${kind}-h`}>
      <div className="pf-head">
        <h2 id={`${kind}-h`}>{title}</h2>
        {items.length > 0 && <Button variant={primary ? 'go' : 'plain'} onClick={() => setEditing('+new')}>{addLabel}</Button>}
      </div>

      {items.length === 0 ? (
        <div className="pf-empty">
          <EmptyState cause={empty.cause} detail={empty.detail} action={empty.none ? undefined : { label: addLabel, onClick: () => setEditing('+new') }} />
          {empty.alt && !empty.none && <Button variant="link" onClick={empty.alt.onClick}>{empty.alt.label}</Button>}
        </div>
      ) : (
        <ul className="pf-rows">
          {items.map((item) => {
            const key = itemKey(kind, item);
            const s = summaryOf(kind, item);
            return (
              <li key={key} className="pf-row">
                <span className="pf-row-text">
                  <span className="pf-row-title">{s.title}</span>
                  {s.sub && <span className="pf-row-sub">{s.sub}</span>}
                </span>
                {removing === key ? (
                  <span className="pf-row-actions" role="group" aria-label={actionName('Remove', s.title)}>
                    <span className="pf-ask">Remove it?</span>
                    <Button aria-label={`Yes, remove ${s.title}`} onClick={() => remove(key)}>Yes</Button>
                    <Button aria-label={`Keep ${s.title}`} onClick={() => setRemoving(null)}>No</Button>
                  </span>
                ) : (
                  <span className="pf-row-actions">
                    <Button variant="link" aria-label={actionName('Edit', s.title)} onClick={() => setEditing(key)}>Edit</Button>
                    <Button variant="link" aria-label={actionName('Remove', s.title)} onClick={() => setRemoving(key)}>Remove</Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={editing !== null && (editing === '+new' || editingItem !== null)} onClose={close} title={editing === '+new' ? addLabel : `Edit ${noun}`} className="pf-sheet">
        {editing !== null && (
          <ItemEditor
            key={editing}
            kind={kind}
            doc={doc}
            itemKey={editing === '+new' ? null : editing}
            item={editing === '+new' ? null : editingItem}
            mode="profile"
            onCancel={close}
            onDone={(r) => { close(); onSaved(r); }}
          />
        )}
      </Sheet>
    </section>
  );
}

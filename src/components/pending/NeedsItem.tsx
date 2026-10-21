'use client';

import { useState } from 'react';
import { Button, ErrorNote } from '../ui';
import Person from './Person';
import type { PendingActions } from './usePendingActions';
import type { NeedsItem as Item } from './sections';

/** A reply that Waypoint cannot answer alone. The first item of the section has the one primary button. The others are plain. */
export default function NeedsItem({ item, actions, primary = false }: { item: Item; actions: PendingActions; primary?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const body = text ?? item.draft;
  const busy = actions.busy === item.id;
  const error = actions.errors[item.id];
  return (
    <li className="pn-item pn-needs" data-item={item.id}>
      <span className="pn-when">{item.kind} {item.when}</span>
      <Person init={item.init} who={item.who} org={item.org} />
      <span className="pn-role">{item.role}</span>
      {item.quote && <p className="quote">“{item.quote}”</p>}
      {editing ? (
        <>
          <label className="pn-label" htmlFor={`draft-${item.id}`}>{item.draftLabel}</label>
          <textarea id={`draft-${item.id}`} className="note-area pn-draft" value={body} onChange={(e) => setText(e.target.value)} />
        </>
      ) : (
        <>
          <span className="pn-label" id={`draft-${item.id}`}>{item.draftLabel}</span>
          <p className="pn-text" aria-labelledby={`draft-${item.id}`}>{body}</p>
        </>
      )}
      {item.reason && <p className="pn-reason">{item.reason}</p>}
      {error && <ErrorNote live what="Waypoint could not copy this reply." fix={error} />}
      <div className="pn-actions">
        <Button variant={primary ? 'go' : 'plain'} busy={busy} aria-label={`${item.action} to ${item.who}`} onClick={() => actions.send(item, body)}>{busy ? 'Copying…' : item.action}</Button>
        <Button variant="link" aria-label={`${editing ? 'Finish editing' : 'Edit'} the reply to ${item.who}`} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</Button>
      </div>
    </li>
  );
}

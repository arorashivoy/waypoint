'use client';

import { Button, ErrorNote } from '../ui';
import Person from './Person';
import type { PendingActions } from './usePendingActions';
import type { SafeItem as Item } from './sections';

/** A reply that Waypoint drafted from facts on file. The user copies it and sends it. */
export default function SafeItem({ item, actions }: { item: Item; actions: PendingActions }) {
  const busy = actions.busy === item.id;
  const error = actions.errors[item.id];
  return (
    <li className="pn-item">
      <Person init={item.init} who={item.who} org={item.org} />
      <p className="quote">“{item.quote}”</p>
      <p className="sent-body">{item.sent}</p>
      <p className="pn-why">{item.why}</p>
      {error && <ErrorNote live what="Waypoint could not copy this reply." fix={error} />}
      {item.handled ? (
        <span className="pn-when">You sent this reply.</span>
      ) : (
        <div className="pn-actions">
          <Button busy={busy} onClick={() => actions.send({ id: item.id, draft: item.sent })}>{busy ? 'Copying…' : 'Copy and open LinkedIn'}</Button>
        </div>
      )}
    </li>
  );
}

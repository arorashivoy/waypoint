'use client';

import { useState } from 'react';
import { Button, ErrorNote } from '../ui';
import Person from './Person';
import type { PendingActions } from './usePendingActions';
import type { AwaitingItem as Item } from './sections';

/** A request that went out. The user says what happened next: they replied, or an alumnus accepted. */
export default function AwaitingItem({ item, actions, initialForm = null }: { item: Item; actions: PendingActions; initialForm?: 'accepted' | 'replied' | null }) {
  const [form, setForm] = useState<'accepted' | 'replied' | null>(initialForm);
  const [who, setWho] = useState({ name: '', url: '' });
  const [incoming, setIncoming] = useState('');
  const busy = actions.busy === item.id;
  const error = actions.errors[item.id];
  const toggle = (next: 'accepted' | 'replied') => {
    actions.clearError(item.id);
    setForm(form === next ? null : next);
    setWho({ name: '', url: '' });
    setIncoming('');
  };
  return (
    <li className="pn-item" data-item={item.id}>
      <Person init={item.init} who={item.who} org={item.org} />
      <span className="pn-role">{item.role}</span>
      <span className="pn-when">{item.when}{item.why ? `. ${item.why}` : ''}</span>
      <div className="pn-actions">
        {item.alumni && <Button aria-label={`${item.who} accepted`} aria-expanded={form === 'accepted'} onClick={() => toggle('accepted')}>They accepted</Button>}
        <Button aria-label={`${item.who} replied`} aria-expanded={form === 'replied'} onClick={() => toggle('replied')}>They replied</Button>
        {item.alumni && item.contactUrl && (
          <a className="btn ui-btn link" aria-label={`Alumni search at ${item.org}`} href={item.contactUrl} target="_blank" rel="noopener noreferrer">Alumni search</a>
        )}
      </div>
      {form === 'accepted' && (
        <div className="pn-form">
          <label htmlFor={`acc-${item.id}`} className="pn-hint">Who accepted? Their name goes in the greeting. Their profile link is optional.</label>
          <input id={`acc-${item.id}`} className="field" placeholder="Full name" autoComplete="off" value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} />
          <label htmlFor={`url-${item.id}`} className="sr-only">Profile link</label>
          <input id={`url-${item.id}`} className="field" placeholder="https://www.linkedin.com/in/…" autoComplete="off" value={who.url} onChange={(e) => setWho({ ...who, url: e.target.value })} />
          {error && form === 'accepted' && <ErrorNote live what="Waypoint could not draft the referral message." fix={error} />}
          <Button
            variant="go"
            busy={busy}
            aria-label={`Draft the referral message for ${item.who}`}
            disabled={!who.name.trim()}
            onClick={async () => { if (await actions.draftReferral(item, who)) setForm(null); }}
          >
            {busy ? 'Drafting the referral and your CV…' : 'Draft the referral message'}
          </Button>
        </div>
      )}
      {form === 'replied' && (
        <div className="pn-form">
          <label htmlFor={`in-${item.id}`} className="pn-hint">Paste what they wrote. Waypoint drafts the answer and decides whether it is safe to send.</label>
          <textarea id={`in-${item.id}`} className="note-area" value={incoming} onChange={(e) => setIncoming(e.target.value)} />
          {error && form === 'replied' && <ErrorNote live what="Waypoint could not read this reply." fix={error} />}
          <Button
            variant="go"
            busy={busy}
            aria-label={`Draft a reply to ${item.who}`}
            disabled={!incoming.trim()}
            onClick={async () => { if (await actions.submitReply(item, incoming)) { setForm(null); setIncoming(''); } }}
          >
            {busy ? 'Reading…' : 'Draft a reply'}
          </Button>
        </div>
      )}
    </li>
  );
}

'use client';

import { useRef, useState } from 'react';
import { copyText, patch, post } from '../api';
import type { UserRow } from '../data';
import { Badge, Button, Field, Sheet } from '../ui';
import { plural, when } from './model';
import { LoadError, Row, SectionHead, type Run } from './parts';

type Link = { url: string; expiresAt: string; label: string };
type Props = { users?: UserRow[]; error?: Error; retry: () => unknown; run: Run; setToast: (s: string) => void };

export default function AdminSection({ users, error, retry, run, setToast }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<Link | null>(null);
  const opener = useRef<HTMLButtonElement>(null);

  return (
    <div className="pf-stack">
      <SectionHead
        title="Admin"
        state={users ? plural(users.length, 'user') : 'Loading the users'}
        action={<Button ref={opener} variant="go" onClick={() => setOpen(true)}>Invite a user</Button>}
      />
      <LoadError what="the users" error={error} retry={retry} />
      {link && (
        <div className="pf-stack-tight" role="status">
          <p className="pf-note">{link.label}. Send it to the user. It works one time, until {when(link.expiresAt)}.</p>
          <div className="pf-actions">
            <code className="mono st-link">{link.url}</code>
            <Button onClick={async () => setToast((await copyText(link.url)) ? 'Copied.' : 'Copy the link from the screen.')}>Copy link</Button>
          </div>
        </div>
      )}
      {users && (
        <ul className="pf-rows">
          {users.map((u) => (
            <Row
              key={u.id}
              title={<>{u.name} {u.role === 'admin' && <Badge tone="lav">Admin</Badge>} {u.disabled && <Badge tone="coral">Disabled</Badge>}</>}
              sub={`${u.email}. Shared key $${u.sharedSpentUsd.toFixed(2)} this month. Last seen ${when(u.lastSeenAt)}.`}
            >
              <Button onClick={() => run(async () => { const r = await post<{ url: string; expiresAt: string }>(`/api/admin/users/${u.id}/reset`); setLink({ ...r, label: `Reset link for ${u.email}` }); })}>Reset link<span className="sr-only"> for {u.email}</span></Button>
              {u.role !== 'admin' && (
                <Button onClick={() => run(() => patch(`/api/admin/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? 'User enabled.' : 'User disabled and signed out.')}>
                  {u.disabled ? 'Enable' : 'Disable'}<span className="sr-only"> {u.email}</span>
                </Button>
              )}
            </Row>
          ))}
        </ul>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Invite a user" opener={opener} className="pf-sheet">
        <form
          className="pf-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const ok = await run(async () => { const r = await post<{ url: string; expiresAt: string }>('/api/admin/invites', { email }); setLink({ ...r, label: 'Invite link' }); });
            setBusy(false);
            if (ok) { setEmail(''); setOpen(false); }
          }}
        >
          <div className="pf-wide">
            <Field label="Email" hint="Optional. Leave it empty for a link that anyone can use one time.">
              {(c) => <input {...c} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
          </div>
          <div className="pf-actions pf-wide">
            <Button type="submit" variant="go" busy={busy}>Make an invite link</Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}

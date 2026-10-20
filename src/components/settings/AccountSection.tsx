'use client';

import { useRef, useState } from 'react';
import { del, post } from '../api';
import type { SessionRow } from '../data';
import { Button, Field, Sheet } from '../ui';
import { device, when } from './model';
import { LoadError, Row, SectionHead, type Run } from './parts';

/** The form that changes the password. The onboarding wizard uses it too. */
export function PasswordForm({ run, onDone }: { run: Run; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="pf-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await run(() => post('/api/account/password', { current, next }), 'Password changed. Your other devices are signed out.');
        setBusy(false);
        if (ok) onDone();
      }}
    >
      <Field label="Current password">
        {(c) => <input {...c} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
      </Field>
      <Field label="New password" hint="Use 12 characters or more.">
        {(c) => <input {...c} type="password" autoComplete="new-password" minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} />}
      </Field>
      <div className="pf-actions pf-wide">
        <Button type="submit" variant="go" busy={busy}>Change password</Button>
      </div>
    </form>
  );
}

type Props = {
  user: { name?: string; email?: string };
  sessions?: SessionRow[];
  error?: Error;
  retry: () => unknown;
  run: Run;
  leave: (url: string, method: 'post' | 'del') => Promise<void>;
};

export default function AccountSection({ user, sessions, error, retry, run, leave }: Props) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <div className="pf-stack">
      <SectionHead
        title="Account"
        state={<span style={{ overflowWrap: 'anywhere' }}>{[user.name, user.email].filter(Boolean).join(', ')}</span>}
        action={<Button ref={opener} variant="go" onClick={() => setOpen(true)}>Change password</Button>}
      />
      <section className="pf-section" aria-labelledby="st-devices">
        <div className="pf-head">
          <h3 id="st-devices" className="pf-group-title">Signed-in devices</h3>
          <Button variant="link" onClick={() => leave('/api/account/sessions', 'del')}>Sign out on all devices</Button>
        </div>
        <LoadError what="your signed-in devices" error={error} retry={retry} />
        {sessions && (
          <ul className="pf-rows">
            {sessions.map((s) => (
              <Row key={s.id} title={`${device(s.userAgent)}${s.current ? ' (this device)' : ''}`} sub={`Last used ${when(s.lastSeenAt)}`}>
                {/* Each Sign out button sits on the row of the device that it signs out. */}
                {s.current
                  ? <Button onClick={() => leave('/api/auth/signout', 'post')}>Sign out<span className="sr-only"> of this device</span></Button>
                  : <Button onClick={() => run(() => del(`/api/account/sessions/${s.id}`), 'Signed out that device.')}>Sign out<span className="sr-only"> of {device(s.userAgent)}</span></Button>}
              </Row>
            ))}
          </ul>
        )}
        <p className="pf-note">Sign out on all devices also signs out this device.</p>
      </section>
      <Sheet open={open} onClose={() => setOpen(false)} title="Change password" opener={opener} className="pf-sheet">
        <PasswordForm run={run} onDone={() => setOpen(false)} />
      </Sheet>
    </div>
  );
}

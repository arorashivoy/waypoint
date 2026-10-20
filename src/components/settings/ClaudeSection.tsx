'use client';

import { useRef, useState } from 'react';
import { del, put } from '../api';
import type { ClaudeStatus } from '../data';
import { Button, Field, Sheet } from '../ui';
import { capLine, CLI_OFF_LINE, claudeDetail } from './model';
import { LoadError, Row, SectionHead, type Run } from './parts';

/** The form that saves the own API key of the user. The onboarding wizard uses it too. */
export function ClaudeKeyForm({ run, onDone }: { run: Run; onDone: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="pf-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await run(() => put('/api/account/claude', { key }), 'Saved your API key.');
        setBusy(false);
        if (ok) {
          setKey('');
          onDone();
        }
      }}
    >
      <div className="pf-wide">
        <Field label="Your Anthropic API key" hint="Waypoint stores the key encrypted. It shows only the last 4 characters.">
          {(c) => <input {...c} type="password" autoComplete="off" placeholder="sk-ant-…" required value={key} onChange={(e) => setKey(e.target.value)} />}
        </Field>
      </div>
      <div className="pf-actions pf-wide">
        <Button type="submit" variant="go" busy={busy} disabled={!key.trim()}>Save key</Button>
      </div>
    </form>
  );
}

/** What pays for Claude, the use against the monthly cap with the reset date, and the CLI state for the admin. */
export function ClaudeStatusView({ claude, isAdmin }: { claude: ClaudeStatus; isAdmin: boolean }) {
  const cap = capLine(claude);
  const cliOff = isAdmin && claude.cliOff;
  if (!cap && !cliOff) return null;
  return (
    <ul className="pf-rows">
      {cap && <Row title="Shared key" sub={cap} />}
      {cliOff && <Row title="Claude CLI" sub={CLI_OFF_LINE} />}
    </ul>
  );
}

type Props = { claude: ClaudeStatus | null; error?: Error; retry: () => unknown; run: Run; isAdmin: boolean };

export default function ClaudeSection({ claude, error, retry, run, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <div className="pf-stack">
      <SectionHead
        title="Claude"
        state={claude ? claudeDetail(claude.detail) : 'Loading the Claude settings'}
        action={
          claude &&
          (claude.keyHint ? (
            <Button ref={opener} onClick={() => run(() => del('/api/account/claude'), 'Removed your API key.')}>Remove key</Button>
          ) : (
            <Button ref={opener} variant="go" onClick={() => setOpen(true)}>Add your own key</Button>
          ))
        }
      />
      <LoadError what="the Claude settings" error={error} retry={retry} />
      {claude && <ClaudeStatusView claude={claude} isAdmin={isAdmin} />}
      <Sheet open={open} onClose={() => setOpen(false)} title="Add your own key" opener={opener} className="pf-sheet">
        <ClaudeKeyForm run={run} onDone={() => setOpen(false)} />
      </Sheet>
    </div>
  );
}

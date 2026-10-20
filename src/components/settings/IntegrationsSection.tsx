'use client';

import { useEffect, useRef, useState } from 'react';
import { del, put } from '../api';
import { Button, Field, Sheet } from '../ui';
import { LoadError, Row, SectionHead, type Run } from './parts';

type Props = { hint?: string | null; error?: Error; retry: () => unknown; run: Run };

export default function IntegrationsSection({ hint, error, retry, run }: Props) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  // The row follows each new load.
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => { if (hint !== undefined) setShown(hint); }, [hint]);
  return (
    <div className="pf-stack">
      <SectionHead title="Integrations" state={shown ? `GitHub is connected. The token ends in ${shown}.` : 'GitHub is not connected.'} />
      <LoadError what="your GitHub token" error={error} retry={retry} />
      <ul className="pf-rows">
        <Row
          title="GitHub"
          sub={shown ? 'The GitHub import can read your private repositories.' : 'A token is optional. It lets the GitHub import read your private repositories.'}
        >
          {shown ? (
            <Button onClick={() => run(async () => { await del('/api/account/github'); setShown(null); }, 'Removed your GitHub token.')}>Remove token</Button>
          ) : (
            <Button ref={opener} variant="go" onClick={() => setOpen(true)}>Add token</Button>
          )}
        </Row>
        <Row title="Google Drive" sub="The admin sets the Google Drive links in the server settings." />
      </ul>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add a GitHub token" opener={opener} className="pf-sheet">
        <form
          className="pf-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const ok = await run(async () => { const r = await put<{ hint: string }>('/api/account/github', { token }); setShown(r.hint); }, 'Saved your GitHub token.');
            setBusy(false);
            if (ok) { setToken(''); setOpen(false); }
          }}
        >
          <div className="pf-wide">
            <Field label="Personal access token" hint="Give the token read access to repository contents only. Waypoint stores it encrypted. It shows only the last 4 characters.">
              {(c) => <input {...c} type="password" autoComplete="off" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />}
            </Field>
          </div>
          <div className="pf-actions pf-wide">
            <Button type="submit" variant="go" busy={busy} disabled={!token.trim()}>Save token</Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}

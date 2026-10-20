'use client';

import { useRef, useState } from 'react';
import { api, ApiError, leaveSession, upload } from '../api';
import { Button, Field, Sheet } from '../ui';
import { Row, SectionHead } from './parts';

type Props = { isAdmin: boolean; setToast: (s: string) => void };

export default function DataSection({ isAdmin, setToast }: Props) {
  const [yamlErrors, setYamlErrors] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setYamlErrors([]);
    try {
      const r = await upload<{ diff: unknown[] }>('/api/profile/yaml', f);
      setToast(`The file is ready (${r.diff.length} changes). Review it in Profile, on the Imports tab, then accept it.`);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.data.errors)) setYamlErrors(err.data.errors);
      else setToast((err as Error).message);
    }
  };

  return (
    <div className="pf-stack">
      <SectionHead title="Data" state="Your profile as a claims.yml file. You can download it, or import one." />
      <ul className="pf-rows">
        <Row title="Export" sub="Download your profile as claims.yml.">
          <a className="btn" href="/api/profile/export" download="claims.yml">Download claims.yml</a>
        </Row>
        <Row title="Import" sub="Choose a claims.yml file. Waypoint shows the changes first. Nothing changes until you accept them.">
          <Button onClick={() => file.current?.click()}>Import claims.yml</Button>
          <input
            ref={file}
            type="file"
            accept=".yml,.yaml,text/yaml,application/yaml"
            hidden
            aria-label="claims.yml file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              pick(f);
            }}
          />
        </Row>
      </ul>
      {yamlErrors.length > 0 && <ul className="err" role="alert" style={{ overflowWrap: 'anywhere' }}>{yamlErrors.map((x) => <li key={x}>{x}</li>)}</ul>}

      {!isAdmin && (
        <section className="pf-section" aria-labelledby="st-danger">
          <h3 id="st-danger" className="pf-group-title">Delete account</h3>
          <ul className="pf-rows">
            <Row title="Delete my account" sub="This removes your profile, drafts, applications, contacts, keys and files.">
              <Button ref={opener} className="st-danger" onClick={() => setOpen(true)}>Delete my account</Button>
            </Row>
          </ul>
        </section>
      )}

      <Sheet open={open} onClose={() => { setOpen(false); setPassword(''); }} title="Delete my account" opener={opener} className="pf-sheet">
        <form
          className="pf-form"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            leaveSession(() => api('/api/account', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }), (m) => { setBusy(false); setToast(m); });
          }}
        >
          <p className="pf-note pf-wide">
            Waypoint deletes your profile, drafts, applications, contacts, keys and files now. You cannot undo this. Download claims.yml first if you want to keep your profile.
          </p>
          <div className="pf-wide">
            <Field label="Your password">
              {(c) => <input {...c} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
          </div>
          <div className="pf-actions pf-wide">
            <Button type="submit" className="st-danger" busy={busy} disabled={!password}>Delete my account</Button>
            <Button variant="link" onClick={() => { setOpen(false); setPassword(''); }}>Keep my account</Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}

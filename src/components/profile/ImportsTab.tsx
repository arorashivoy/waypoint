'use client';

import { useRef, useState } from 'react';
import type { ClaimsDoc } from '@/lib/profile/doc';
import { ApiError, upload } from '../api';
import DraftList from './DraftList';
import GithubSource from './GithubSource';
import HistoryPanel from './HistoryPanel';
import LinkedInPanel from './LinkedInPanel';

type Props = { doc: ClaimsDoc; version: number; state: any; changed: () => Promise<void>; setToast: (s: string) => void; onCount: (n: number) => void };

function FileButton({ label, accept, run }: { label: string; accept: string; run: (f: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Reading…' : label}</button>
      <input ref={input} type="file" accept={accept} hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setBusy(true);
        try { await run(f); } finally { setBusy(false); }
      }} />
    </>
  );
}

export default function ImportsTab({ doc, version, state, changed, setToast, onCount }: Props) {
  const [listKey, setListKey] = useState(0);
  const [yamlErrors, setYamlErrors] = useState<string[]>([]);
  const imported = async () => {
    setListKey((k) => k + 1);
    await changed();
  };
  const fail = (e: unknown) => setToast((e as Error).message);

  return (
    <>
      <section className="card stack" style={{ gap: 16, padding: 20, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Import</h2>
        <span className="hint">Each import makes drafts. Your profile changes only when you accept a draft.</span>

        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Résumé (PDF or .tex, 10 MB or less)</span>
          <div><FileButton label="Upload a résumé" accept=".pdf,.tex,application/pdf" run={async (f) => {
            try {
              const r = await upload<{ drafts: number; dropped: number; hidden: number }>('/api/profile/resume-import', f);
              setToast(`Made ${r.drafts} drafts.${r.dropped ? ` Dropped ${r.dropped} items whose quote is not in the file.` : ''}${r.hidden ? ' The file has hidden text: see the warnings.' : ''}`);
              await imported();
            } catch (e) { fail(e); }
          }} /></div>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <span className="label">GitHub</span>
          <GithubSource done={imported} setToast={setToast} />
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <span className="label">claims.yml (1 MB or less)</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <FileButton label="Import claims.yml" accept=".yml,.yaml,text/yaml,application/yaml" run={async (f) => {
              setYamlErrors([]);
              try {
                const r = await upload<{ diff: unknown[] }>('/api/profile/yaml', f);
                setToast(`The file is ready to replace your profile (${r.diff.length} changes). Review the draft below.`);
                await imported();
              } catch (e) {
                if (e instanceof ApiError && Array.isArray(e.data.errors)) setYamlErrors(e.data.errors);
                else fail(e);
              }
            }} />
            <a className="btn" href="/api/profile/export" download="claims.yml">Download claims.yml</a>
          </div>
          {yamlErrors.length > 0 && <ul className="err" role="alert">{yamlErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      </section>

      <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>Drafts</h2>
      <DraftList key={listKey} doc={doc} changed={changed} setToast={setToast} onCount={onCount} />

      <h2 style={{ margin: '24px 0 12px', fontSize: 20 }}>LinkedIn and connections</h2>
      <LinkedInPanel state={state} refresh={imported} setToast={setToast} />

      <h2 style={{ margin: '24px 0 12px', fontSize: 20 }}>History</h2>
      <section className="card" style={{ padding: 20 }}>
        <HistoryPanel version={version} changed={changed} setToast={setToast} />
      </section>
    </>
  );
}

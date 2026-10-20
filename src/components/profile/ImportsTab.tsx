'use client';

import { useState } from 'react';
import type { ClaimsDoc } from '@/lib/profile/doc';
import { ApiError, upload } from '../api';
import { Fold } from '../ui';
import { runTask } from '../tasks';
import DraftList from './DraftList';
import FileButton from './FileButton';
import GithubSource from './GithubSource';
import LinkedInPanel from './LinkedInPanel';
import Problems from './Problems';
import { countOf, FILE_ACCEPT } from './model';

type Props = { doc: ClaimsDoc; version: number; state: any; changed: () => Promise<void>; setToast: (s: string) => void; onCount: (n: number) => void; /** How many drafts wait. With drafts, the import panels fold, so the drafts lead. */ drafts?: number; onAccepted?: () => void };

export default function ImportsTab({ doc, state, changed, setToast, onCount, drafts = 0, onAccepted }: Props) {
  const [listKey, setListKey] = useState(0);
  const [yamlErrors, setYamlErrors] = useState<string[]>([]);
  const imported = async () => {
    setListKey((k) => k + 1);
    await changed();
  };
  const fail = (e: unknown) => setToast((e as Error).message);

  return (
    <div className="pf-stack">
      <section className="pf-section" aria-labelledby="pf-drafts-h">
        <div className="pf-head"><h2 id="pf-drafts-h">Drafts</h2></div>
        <DraftList key={listKey} doc={doc} changed={changed} setToast={setToast} onCount={onCount} onAccepted={onAccepted} />
      </section>

      {drafts > 0 ? (
        <Fold title="Import more" status="A résumé, GitHub or a claims.yml file">
          <div className="pf-stack-tight">
        <p className="pf-note">Each import makes drafts. Your profile changes only when you accept a draft.</p>

        <div className="pf-source">
          <div className="pf-source-text">
            <strong>Résumé</strong>
            <span className="pf-note">A PDF or a .tex file, 10 MB or less.</span>
          </div>
          <FileButton label="Upload a résumé" accept={FILE_ACCEPT.resume} run={async (f) => {
            try {
              const r = await runTask<{ drafts: number; dropped: number; hidden: number }>(() => upload<{ taskId: string }>('/api/profile/resume-import', f));
              setToast(`Made ${countOf(r.drafts, 'draft')}.${r.dropped ? ` Dropped ${countOf(r.dropped, 'item')} whose quote is not in the file.` : ''}${r.hidden ? ' The file has hidden text. Check the warnings on the drafts.' : ''}`);
              await imported();
            } catch (e) { fail(e); }
          }} />
        </div>

        <div className="pf-source pf-source-col">
          <div className="pf-source-text">
            <strong>GitHub</strong>
            <span className="pf-note">Waypoint drafts one project for each repository you pick.</span>
          </div>
          <GithubSource done={imported} setToast={setToast} />
        </div>

        <div className="pf-source">
          <div className="pf-source-text">
            <strong>claims.yml</strong>
            <span className="pf-note">1 MB or less. The file replaces the whole profile, after you accept it.</span>
          </div>
          <div className="pf-actions">
            <FileButton label="Import claims.yml" accept={FILE_ACCEPT.yaml} run={async (f) => {
              setYamlErrors([]);
              try {
                const r = await upload<{ diff: unknown[] }>('/api/profile/yaml', f);
                setToast(`The file is ready to replace your profile (${countOf(r.diff.length, 'change')}). Review the draft above.`);
                await imported();
              } catch (e) {
                if (e instanceof ApiError && Array.isArray(e.data.errors)) setYamlErrors(e.data.errors);
                else fail(e);
              }
            }} />
            <a className="btn ui-btn" href="/api/profile/export" download="claims.yml">Download claims.yml</a>
          </div>
        </div>
        <Problems live list={yamlErrors} />
          </div>
        </Fold>
      ) : (
        <section className="glass ui-panel" aria-labelledby="pf-import-h">
          <h2 id="pf-import-h" className="ui-panel-title">Import</h2>
        <p className="pf-note">Each import makes drafts. Your profile changes only when you accept a draft.</p>

        <div className="pf-source">
          <div className="pf-source-text">
            <strong>Résumé</strong>
            <span className="pf-note">A PDF or a .tex file, 10 MB or less.</span>
          </div>
          <FileButton label="Upload a résumé" accept={FILE_ACCEPT.resume} run={async (f) => {
            try {
              const r = await runTask<{ drafts: number; dropped: number; hidden: number }>(() => upload<{ taskId: string }>('/api/profile/resume-import', f));
              setToast(`Made ${countOf(r.drafts, 'draft')}.${r.dropped ? ` Dropped ${countOf(r.dropped, 'item')} whose quote is not in the file.` : ''}${r.hidden ? ' The file has hidden text. Check the warnings on the drafts.' : ''}`);
              await imported();
            } catch (e) { fail(e); }
          }} />
        </div>

        <div className="pf-source pf-source-col">
          <div className="pf-source-text">
            <strong>GitHub</strong>
            <span className="pf-note">Waypoint drafts one project for each repository you pick.</span>
          </div>
          <GithubSource done={imported} setToast={setToast} />
        </div>

        <div className="pf-source">
          <div className="pf-source-text">
            <strong>claims.yml</strong>
            <span className="pf-note">1 MB or less. The file replaces the whole profile, after you accept it.</span>
          </div>
          <div className="pf-actions">
            <FileButton label="Import claims.yml" accept={FILE_ACCEPT.yaml} run={async (f) => {
              setYamlErrors([]);
              try {
                const r = await upload<{ diff: unknown[] }>('/api/profile/yaml', f);
                setToast(`The file is ready to replace your profile (${countOf(r.diff.length, 'change')}). Review the draft above.`);
                await imported();
              } catch (e) {
                if (e instanceof ApiError && Array.isArray(e.data.errors)) setYamlErrors(e.data.errors);
                else fail(e);
              }
            }} />
            <a className="btn ui-btn" href="/api/profile/export" download="claims.yml">Download claims.yml</a>
          </div>
        </div>
        <Problems live list={yamlErrors} />
        </section>
      )}

      <LinkedInPanel state={state} refresh={imported} setToast={setToast} folded={drafts > 0} />
    </div>
  );
}

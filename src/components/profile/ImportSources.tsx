'use client';

import { useState } from 'react';
import { ApiError, upload } from '../api';
import { importResult, parser } from '../task-results';
import { runTask } from '../tasks';
import FileButton from './FileButton';
import GithubSource from './GithubSource';
import Problems from './Problems';
import { countOf, FILE_ACCEPT } from './model';

/** The 3 file and GitHub imports. The Profile tab and the onboarding wizard use it. Each import makes drafts. */
export default function ImportSources({ imported, setToast }: { imported: () => Promise<void>; setToast: (s: string) => void }) {
  const [yamlErrors, setYamlErrors] = useState<string[]>([]);
  const fail = (e: unknown) => setToast((e as Error).message);
  return (
    <>
      <p className="pf-note">Each import makes drafts. Your profile changes only when you accept a draft.</p>

      <div className="pf-source">
        <div className="pf-source-text">
          <strong>Résumé</strong>
          <span className="pf-note">A PDF or a .tex file, 10 MB or less.</span>
        </div>
        <FileButton label="Upload a résumé" accept={FILE_ACCEPT.resume} run={async (f) => {
          try {
            const r = await runTask(() => upload<{ taskId: string }>('/api/profile/resume-import', f), { parse: parser(importResult) });
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
              setToast(`The file is ready to replace your profile (${countOf(r.diff.length, 'change')}). Review the draft.`);
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
    </>
  );
}

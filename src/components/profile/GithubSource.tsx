'use client';

import { useState } from 'react';
import { post } from '../api';
import { githubResult, parser } from '../task-results';
import { runTask } from '../tasks';
import { Button, Field } from '../ui';
import { countOf } from './model';

type Repo = { name: string; description: string | null; fork: boolean; language: string | null; stars: number; private: boolean };
const MAX = 10;

export default function GithubSource({ done, setToast }: { done: () => Promise<void>; setToast: (s: string) => void }) {
  const [username, setUsername] = useState('');
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const list = async () => {
    setBusy(true);
    try {
      const r = await post<{ repos: Repo[] }>('/api/profile/github/repos', { username: username.trim() });
      setRepos(r.repos);
      // Forks are not selected by default (spec 3.3).
      setPicked(r.repos.filter((x) => !x.fork).slice(0, MAX).map((x) => x.name));
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const { taskIds } = await post<{ taskIds: string[] }>('/api/profile/github/import', { username: username.trim(), repos: picked });
      const results = await Promise.allSettled(taskIds.map((taskId) => runTask(async () => ({ taskId }), { parse: parser(githubResult) })));
      let drafts = 0;
      let dropped = 0;
      let firstError = '';
      for (const r of results) {
        if (r.status === 'fulfilled') {
          drafts += r.value.drafts;
          dropped += r.value.dropped;
        } else if (!firstError) {
          firstError = (r.reason as Error).message;
        }
      }
      const failed = results.filter((r) => r.status === 'rejected').length;
      const counts = `Made ${countOf(drafts, 'draft')}.${dropped ? ` Dropped ${countOf(dropped, 'item')} that had no quote from the repository.` : ''}`;
      setToast(failed ? `${counts} ${failed} of ${results.length} repositories failed: ${firstError}` : counts);
      setRepos(null);
      await done();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-github">
      <form className="pf-inline" onSubmit={(e) => { e.preventDefault(); list(); }}>
        <Field label="GitHub user name">
          {(c) => <input {...c} type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" autoCorrect="off" />}
        </Field>
        <Button type="submit" busy={busy && !repos} disabled={busy || !username.trim()}>{busy && !repos ? 'Reading…' : 'List repositories'}</Button>
      </form>
      {repos && (
        <fieldset className="pf-group">
          <legend className="pf-group-title">Select up to {MAX}. Claude drafts one project for each, from its README.</legend>
          {repos.length === 0 && <p className="pf-note">This user has no public repositories.</p>}
          {repos.map((r) => {
            const on = picked.includes(r.name);
            return (
              <label key={r.name} className="pf-check pf-repo">
                <input type="checkbox" checked={on} disabled={!on && picked.length >= MAX} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.name] : p.filter((x) => x !== r.name)))} />
                <span className="pf-row-text">
                  <span className="pf-row-title">{r.name}{r.fork ? ' (fork)' : ''}{r.private ? ' (private)' : ''}</span>
                  <span className="pf-row-sub">{[r.language, r.description].filter(Boolean).join('. ')}</span>
                </span>
              </label>
            );
          })}
          <div><Button variant="go" busy={busy} disabled={!picked.length} onClick={run}>{busy ? 'Drafting…' : `Import ${picked.length}`}</Button></div>
        </fieldset>
      )}
    </div>
  );
}

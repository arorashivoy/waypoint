'use client';

import { useState } from 'react';
import { post } from '../api';

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
      const r = await post<{ drafts: number; dropped: number }>('/api/profile/github/import', { username: username.trim(), repos: picked });
      setToast(`Made ${r.drafts} drafts.${r.dropped ? ` Dropped ${r.dropped} items that had no quote from the repository.` : ''}`);
      setRepos(null);
      await done();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); list(); }}>
        <label className="sr-only" htmlFor="gh-user">GitHub user name</label>
        <input id="gh-user" className="field grow" style={{ minWidth: 0 }} placeholder="GitHub user name" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        <button className="btn" type="submit" disabled={busy || !username.trim()}>{busy && !repos ? 'Reading…' : 'List repositories'}</button>
      </form>
      {repos && (
        <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
          <legend className="hint">Select up to {MAX}. Claude drafts one project for each, from its README.</legend>
          {repos.map((r) => {
            const on = picked.includes(r.name);
            return (
              <label key={r.name} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={on} disabled={!on && picked.length >= MAX} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.name] : p.filter((x) => x !== r.name)))} />
                <span className="stack" style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.name}{r.fork ? ' (fork)' : ''}{r.private ? ' (private)' : ''}</span>
                  <span className="hint" style={{ overflowWrap: 'anywhere' }}>{[r.language, r.description].filter(Boolean).join(' · ')}</span>
                </span>
              </label>
            );
          })}
          <div><button className="btn btn-dark" type="button" disabled={busy || !picked.length} onClick={run}>{busy ? 'Drafting…' : `Import ${picked.length}`}</button></div>
        </fieldset>
      )}
    </div>
  );
}

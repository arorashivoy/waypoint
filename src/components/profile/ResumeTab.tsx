'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, del } from '../api';
import { Button, ErrorNote, Fold, Skeleton } from '../ui';
import FileButton from './FileButton';
import HistoryPanel from './HistoryPanel';
import Problems from './Problems';
import { countOf, FILE_ACCEPT, HISTORY_TITLE } from './model';

type Props = { state: any; version: number; changed: () => Promise<void>; setToast: (s: string) => void };
type Source = { mode: 'template' | 'own-tex'; hasOwnTex: boolean };

/** What the user reads about the source of the résumé. */
function sourceText(s: Source): { title: string; detail: string } {
  if (s.mode === 'own-tex' && s.hasOwnTex) return { title: 'Your own .tex file', detail: 'Waypoint tailors your file for each job. It finds your bullets by their “match” phrase.' };
  if (s.mode === 'own-tex') return { title: 'The .tex file of this server', detail: 'The server admin set this file. Upload your own file to use it in its place.' };
  return { title: 'The Classic template', detail: 'Waypoint writes your résumé from your profile. Upload a .tex file if you want to keep your own layout.' };
}

export default function ResumeTab({ state, version, changed, setToast }: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setSource(await api<Source>('/api/resume/own-tex'));
    setError(null);
  }, []);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const sendFile = async (file: File) => {
    setProblems([]);
    try {
      const form = new FormData();
      form.append('file', file);
      setSource(await api<Source>('/api/resume/own-tex', { method: 'PUT', body: form }));
      setToast('Your .tex file is saved. Waypoint uses it for new CVs.');
    } catch (e) {
      // The server message already holds the reasons, in plain words.
      setProblems([(e as Error).message]);
    }
  };
  const remove = async () => {
    setRemoving(false);
    try {
      setSource(await del<Source>('/api/resume/own-tex'));
      setProblems([]);
      setToast('Your .tex file is removed. Waypoint uses the Classic template.');
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const picks: { role: string; lead: string; then: string }[] = state?.picks ?? [];
  const text = source && sourceText(source);

  return (
    <div className="pf-stack">
      <section className="pf-section" aria-labelledby="pf-src-h">
        <div className="pf-head"><h2 id="pf-src-h">Résumé source</h2></div>
        <div className="pf-box">
          {error && !source ? (
            <ErrorNote what="Waypoint could not load your résumé source." fix={`${error.replace(/\.?$/, '.')} Check your connection, then try again.`} onRetry={() => { load().catch((e) => setError((e as Error).message)); }} />
          ) : (
            <div className="pf-source">
              <div className="pf-source-text">
                {source && (
                  <ul className="pf-choice" aria-label="Résumé source in use">
                    <li data-on={source.mode === 'template'}>Classic template</li>
                    <li data-on={source.mode === 'own-tex'}>Your own .tex file</li>
                  </ul>
                )}
                {text ? (
                  <>
                    <strong>{text.title}</strong>
                    <span className="pf-note">{text.detail}</span>
                  </>
                ) : (
                  <Skeleton rows={1} />
                )}
              </div>
              <div className="pf-actions">
                <FileButton label={source?.hasOwnTex ? 'Replace the .tex file' : 'Upload a .tex file'} accept={FILE_ACCEPT.ownTex} run={sendFile} />
                {source?.hasOwnTex && (removing ? (
                  <>
                    <Button aria-label="Yes, remove my .tex file" onClick={remove}>Yes, remove it</Button>
                    <Button onClick={() => setRemoving(false)}>Keep it</Button>
                  </>
                ) : (
                  <Button onClick={() => setRemoving(true)}>Remove my .tex file</Button>
                ))}
              </div>
            </div>
          )}
          <p className="pf-note">A .tex file must be 1 MB or less. Waypoint refuses a file that can read files or run commands.</p>
          <Problems live list={problems} />
        </div>
      </section>

      <Fold title="Which project leads, by role" status={picks.length ? countOf(picks.length, 'role') : 'No roles yet'}>
        {picks.length === 0 ? (
          <p className="pf-note">Add projects and claims first. Then Waypoint shows which project leads for each kind of role.</p>
        ) : (
          <ul className="pf-rows">
            {picks.map((p) => (
              <li key={p.role} className="pf-row pf-pick">
                <span className="pf-row-title">{p.role}</span>
                <span className="pf-row-text">
                  <span>{p.lead}</span>
                  {p.then && <span className="pf-row-sub">Then {p.then}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Fold>

      <section id="pf-history" className="pf-section" aria-labelledby="pf-hist-h">
        <div className="pf-head"><h2 id="pf-hist-h">{HISTORY_TITLE}</h2></div>
        <div className="pf-box">
          <p className="pf-note">Every change to your profile. Restore puts back the profile from before a change, so you can undo an accepted draft or a save.</p>
          <HistoryPanel version={version} changed={changed} setToast={setToast} />
        </div>
      </section>
    </div>
  );
}

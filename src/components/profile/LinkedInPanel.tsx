'use client';

import { useMemo, useState } from 'react';
import { Field, Fold } from '../ui';
import FileButton from './FileButton';
import { countOf, emptySearchText, FILE_ACCEPT } from './model';

export default function LinkedInPanel({ state, refresh, setToast, folded }: { state: any; refresh: () => Promise<any>; setToast: (s: string) => void; /** Wraps the panel in a closed fold, when drafts wait. */ folded?: boolean }) {
  const [query, setQuery] = useState('');

  const upload = async (file: File) => {
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/profile/import', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      await refresh();
      setToast(
        data.scope === 'contacts'
          ? `Refreshed ${countOf(data.counts.contacts, 'connection')}. Profile and job analyses left as they were.`
          : `Made ${countOf(data.drafts, 'draft')} and refreshed ${countOf(data.counts.contacts ?? 0, 'connection')}. Review the drafts at the top of this tab.`,
      );
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const lastImport = state.lastImport;
  const contacts: any[] = state.contacts ?? [];
  const contactCount: number = state.contactCount ?? 0;
  const topCompanies: any[] = state.topContactCompanies ?? [];
  const capped = contactCount > contacts.length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => `${c.name} ${c.company} ${c.position}`.toLowerCase().includes(q));
  }, [contacts, query]);

  const importedAt = lastImport
    ? new Date(lastImport.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  const counts: [string, number][] = lastImport
    ? [
        ['Positions', lastImport.counts.positions ?? 0],
        ['Education', lastImport.counts.educations ?? 0],
        ['Projects', lastImport.counts.projects ?? 0],
        ['Skills', lastImport.counts.skills ?? 0],
        ['Connections', lastImport.counts.contacts ?? 0],
      ]
    : [];

  const body = (
    <div className="pf-stack">
      <section className="pf-section" aria-labelledby="pf-li-h">
        <div className="pf-head"><h2 id="pf-li-h">LinkedIn</h2></div>
        <div className="pf-box">
          <div className="pf-source">
            <div className="pf-source-text">
              {lastImport ? (
                <>
                  <strong>{lastImport.filename}</strong>
                  <span className="pf-note">Imported on {importedAt}. Sign-in gives only your name, email and photo. The rest came from the archive.</span>
                </>
              ) : (
                <>
                  <strong>No LinkedIn export yet</strong>
                  <span className="pf-note">
                    In LinkedIn, open <em>Settings, Data privacy, Get a copy of your data</em>. Pick the full archive and upload the .zip here.
                    Your experience, projects and connections exist only in that archive.
                  </span>
                </>
              )}
            </div>
            <FileButton label={lastImport ? 'Import again' : 'Import an export'} accept={FILE_ACCEPT.linkedin} run={upload} />
          </div>
          {lastImport && (
            <dl className="pf-counts">
              {counts.map(([label, n]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{n}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      <Fold quiet title="Connections" status={contactCount === 0 ? 'None imported' : `${contactCount} first-degree`}>
        <div className="pf-stack-tight">
          <p className="pf-note">
            Referral routing runs on these connections. A job at one of these companies gets a named contact. A company that is not here gets an honest empty list.
          </p>
          {contactCount === 0 ? (
            <p className="pf-note">
              No connections imported. <code>Connections.csv</code> is in the LinkedIn archive. Without it, every job says “no 1st-degree contact found”.
            </p>
          ) : (
            <>
              {topCompanies.length > 0 && (
                <div className="pf-stack-tight">
                  <span className="pf-group-title">Where they work, top {topCompanies.length}</span>
                  <ul className="pf-rows">
                    {topCompanies.map((c) => (
                      <li key={c.company} className="pf-row pf-row-tight">
                        <span className="pf-row-title">{c.company}</span>
                        <span className="pf-count">{c.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Field label="Search connections">
                {(c) => <input {...c} type="search" placeholder="Name, company or role" value={query} onChange={(e) => setQuery(e.target.value)} />}
              </Field>
              <p className="pf-note" aria-live="polite">
                {shown.length} shown{capped && `. The newest ${contacts.length} of ${contactCount} are on this screen. Routing still searches all of them.`}
              </p>
              <div className="pf-contacts">
                {shown.length === 0 && <p className="pf-note">{emptySearchText(query, 'connection')}</p>}
                {shown.map((c) => {
                  const body = (
                    <>
                      <span className="avatar avatar-light avatar-sm">{c.init}</span>
                      <span className="pf-row-text">
                        <span className="pf-row-title">{c.name}</span>
                        <span className="pf-row-sub">{[c.position, c.company].filter(Boolean).join(', ') || 'No role in the export'}</span>
                        <span className="pf-row-sub">{c.connected ? `Connected ${c.connected}` : 'Connection date not in the export'}</span>
                      </span>
                      {c.profileUrl && <span className="pf-out" aria-hidden="true">↗</span>}
                    </>
                  );
                  return c.profileUrl ? (
                    <a key={c.id} className="contact pf-contact" href={c.profileUrl} target="_blank" rel="noreferrer">{body}<span className="sr-only">Opens the LinkedIn profile in a new tab.</span></a>
                  ) : (
                    <div key={c.id} className="contact pf-contact">{body}</div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Fold>
    </div>
  );
  return folded ? (
    <Fold title="LinkedIn and connections" status={lastImport ? `Imported on ${importedAt}` : 'No export yet'}>{body}</Fold>
  ) : (
    body
  );
}

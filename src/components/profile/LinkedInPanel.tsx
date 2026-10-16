'use client';

import { useMemo, useRef, useState } from 'react';

export default function LinkedInPanel({ state, refresh, setToast }: { state: any; refresh: () => Promise<any>; setToast: (s: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/profile/import', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      await refresh();
      setToast(
        data.scope === 'contacts'
          ? `Refreshed ${data.counts.contacts} connections. Profile and job analyses left as they were.`
          : `Made ${data.drafts} ${data.drafts === 1 ? 'draft' : 'drafts'} and refreshed ${data.counts.contacts ?? 0} connections. Review the drafts in this tab.`,
      );
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
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
    return contacts.filter((c) =>
      `${c.name} ${c.company} ${c.position}`.toLowerCase().includes(q),
    );
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

  return (
    <div className="stack" style={{ gap: 20 }}>
            <div className="panel stack" style={{ gap: 18, padding: 28 }}>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <h2 className="display grow" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>How this data got here</h2>
                <button className="btn" style={{ height: 44, fontSize: 14 }} onClick={() => input.current?.click()} disabled={busy}>
                  {busy ? 'Reading…' : lastImport ? 'Re-import' : 'Import export'}
                </button>
                <input
                  ref={input}
                  type="file"
                  accept=".zip,.csv"
                  hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
                />
              </div>

              {!lastImport ? (
                <div className="empty" style={{ fontSize: 14, padding: 18 }}>
                  No LinkedIn export imported yet. Signing in with LinkedIn (OpenID Connect) returns your name, email and
                  photo and nothing else — your experience, projects and connections exist only in the data archive. In
                  LinkedIn go to <strong>Settings → Data privacy → Get a copy of your data</strong>, pick the full
                  archive, and upload the .zip here.
                </div>
              ) : (
                <>
                  <div className="stack" style={{ gap: 4 }}>
                    <span style={{ fontSize: 15, lineHeight: 1.5 }}>
                      Imported from <strong>{lastImport.filename}</strong> on {importedAt}.
                    </span>
                    <span style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
                      Name, email and photo come from LinkedIn sign-in. Everything below came out of that archive — the
                      API returns none of it.
                    </span>
                  </div>
                  <div className="two-col-tight">
                    {counts.map(([label, n]) => (
                      <div key={label} className="row" style={{ gap: 8, padding: '8px 0', borderBottom: '1px solid var(--line-2)' }}>
                        <span className="grow" style={{ fontSize: 14 }}>{label}</span>
                        <span className="mono" style={{ fontSize: 14 }}>{n}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="panel stack" style={{ gap: 16, padding: 28 }}>
              <div className="stack" style={{ gap: 4 }}>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <h2 className="display grow" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Connections</h2>
                  <span className="mono" style={{ fontSize: 18 }}>{contactCount}</span>
                </div>
                <span style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
                  These 1st-degree connections are what referral routing runs on: a job at one of the companies below
                  gets a named contact, and a company absent from this list gets an honest empty list instead.
                </span>
              </div>

              {contactCount === 0 ? (
                <div className="empty" style={{ fontSize: 14, padding: 18 }}>
                  No connections imported. <code>Connections.csv</code> lives in the LinkedIn data archive; without it
                  every job falls back to “no 1st-degree contact found”.
                </div>
              ) : (
                <>
                  <div className="stack" style={{ gap: 8 }}>
                    <h3 className="label">Where they work, top {topCompanies.length}</h3>
                    {topCompanies.map((c) => (
                      <div key={c.company} className="row" style={{ gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line-2)' }}>
                        <span className="grow" style={{ fontSize: 14, minWidth: 0, overflowWrap: 'anywhere' }}>{c.company}</span>
                        <span className="mono" style={{ fontSize: 13, color: 'var(--muted-3)' }}>{c.count}</span>
                      </div>
                    ))}
                  </div>

                  <div className="stack" style={{ gap: 10 }}>
                    <label className="sr-only" htmlFor="wp-contact-search">Search connections</label>
                    <input
                      id="wp-contact-search"
                      className="field"
                      type="search"
                      placeholder="Search name, company or role"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <span className="mono" style={{ fontSize: 12, color: 'var(--muted-3)' }}>
                      {shown.length} shown
                      {capped && ` · newest ${contacts.length} of ${contactCount} sent to this screen; routing still searches all of them`}
                    </span>

                    <div className="stack" style={{ gap: 8, maxHeight: 520, overflowY: 'auto' }}>
                      {shown.length === 0 && (
                        <div className="empty" style={{ fontSize: 14, padding: 18 }}>No connection matches “{query}”.</div>
                      )}
                      {shown.map((c) => {
                        const body = (
                          <>
                            <span className="avatar avatar-light avatar-sm">{c.init}</span>
                            <span className="stack grow" style={{ minWidth: 0, gap: 1 }}>
                              <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere', color: 'var(--ink)' }}>{c.name}</span>
                              <span style={{ fontSize: 13, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                                {[c.position, c.company].filter(Boolean).join(' · ') || 'No role in the export'}
                              </span>
                              <span className="mono" style={{ fontSize: 11, color: 'var(--muted-3)' }}>
                                {c.connected ? `Connected ${c.connected}` : 'Connection date not in the export'}
                              </span>
                            </span>
                            {c.profileUrl && <span style={{ fontSize: 13, color: 'var(--link)', flexShrink: 0 }}>↗</span>}
                          </>
                        );
                        // The whole card is the link, so the touch target is the
                        // full row rather than a button squeezed beside wrapping text.
                        return c.profileUrl ? (
                          <a key={c.id} className="contact" href={c.profileUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                            {body}
                          </a>
                        ) : (
                          <div key={c.id} className="contact">{body}</div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
    </div>
  );
}

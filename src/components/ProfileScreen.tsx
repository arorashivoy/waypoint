'use client';

import { useMemo, useRef, useState } from 'react';

const SECTION_BLURB: Record<string, string> = {
  Experience: 'Every position in the export, oldest role last.',
  Education: 'Schools in the export. Alumni overlap is one of the referral routes.',
  Projects: 'Ranked per posting on the job screen; shown here in full.',
};

export default function ProfileScreen({ state, refresh, setToast }: { state: any; refresh: () => Promise<any>; setToast: (s: string) => void }) {
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
          : `Imported ${data.counts.positions} positions, ${data.counts.educations} schools, ${data.counts.projects} projects, ${data.counts.skills} skills and ${data.counts.contacts} connections.`,
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
  const contactLimit: number = state.contactLimit ?? contacts.length;
  const topCompanies: any[] = state.topContactCompanies ?? [];
  const skills: string[] = state.skills ?? [];
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
    <>
      <header className="screen-head">
        <h1 className="display">Profile</h1>
        <span className="sub">Your LinkedIn identity and everything the data export brought in</span>
      </header>

      <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '24px 36px 48px' }}>
        <div className="two-col" style={{ alignItems: 'start' }}>
          <div className="stack" style={{ gap: 20 }}>
            <div className="panel stack" style={{ gap: 18, padding: 28 }}>
              <div className="row" style={{ gap: 14 }}>
                {state.user.picture ? (
                  <img
                    src={state.user.picture}
                    alt=""
                    width={56}
                    height={56}
                    style={{ width: 56, height: 56, borderRadius: 28, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--line)' }}
                  />
                ) : (
                  <span className="avatar" style={{ width: 56, height: 56, borderRadius: 28, fontSize: 18 }}>{state.user.initials}</span>
                )}
                <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="display" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{state.user.name}</span>
                  <span style={{ fontSize: 15, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{state.user.email}</span>
                </div>
              </div>
              <span style={{ fontSize: 16, lineHeight: 1.45 }}>{state.user.headline}</span>
              {state.user.linkedin && (
                <a href={state.user.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: 'var(--link)' }}>
                  LinkedIn profile
                </a>
              )}
            </div>

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

            {state.profile.map((sec: any) => (
              <div key={sec.label} className="panel stack" style={{ gap: 12, padding: 28 }}>
                <div className="stack" style={{ gap: 4 }}>
                  <h2 className="display" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{sec.label}</h2>
                  <span style={{ fontSize: 14, color: 'var(--muted)' }}>{SECTION_BLURB[sec.label]}</span>
                </div>
                {sec.items.length === 0 ? (
                  <div className="empty" style={{ fontSize: 14, padding: 18 }}>
                    Nothing under {sec.label.toLowerCase()} in the imported export.
                  </div>
                ) : (
                  sec.items.map((it: any, i: number) => (
                    <div key={i} className="stack" style={{ gap: 2, paddingBottom: 10, borderBottom: '1px solid var(--line-2)' }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{it.t}</span>
                      <span style={{ fontSize: 14, color: 'var(--muted)' }}>{it.o}</span>
                      {it.y && it.y !== it.d && <span className="mono" style={{ fontSize: 12, color: 'var(--muted-3)' }}>{it.y}</span>}
                      <span style={{ fontSize: 14, lineHeight: 1.45 }}>{it.d}</span>
                    </div>
                  ))
                )}
              </div>
            ))}

            <div className="panel stack" style={{ gap: 12, padding: 28 }}>
              <h2 className="display" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Skills</h2>
              {skills.length === 0 ? (
                <div className="empty" style={{ fontSize: 14, padding: 18 }}>No skills in the imported export.</div>
              ) : (
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {skills.map((s, i) => <span key={i} className="tag">{s}</span>)}
                </div>
              )}
            </div>
          </div>

          <div className="stack" style={{ gap: 20 }}>
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

            <div className="panel stack" style={{ gap: 8, padding: 28 }}>
              <h2 className="display" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Inferred level</h2>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {state.levels.map((l: string) => <span key={l} className="tag tag-dark">{l}</span>)}
              </div>
              <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--muted)' }}>
                Read from the titles and dates in your imported positions, not set by hand. It is what the “From
                LinkedIn” level filter on the Jobs screen selects, and it feeds the level half of every match score.
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

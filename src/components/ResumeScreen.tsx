'use client';

import { useRef, useState } from 'react';

export default function ResumeScreen({ state, refresh, setToast }: { state: any; refresh: () => Promise<any>; setToast: (s: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

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

  const hasProfile = state.profile.some((s: any) => s.items.length);

  return (
    <>
      <header className="screen-head">
        <h1 className="display">Resume</h1>
        <span className="sub">Imported from your LinkedIn data export and checked against every saved job</span>
      </header>

      <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '24px 36px 48px' }}>
        <div className="two-col" style={{ alignItems: 'start' }}>
          <div className="panel stack resume-import" style={{ gap: 22, padding: 28 }}>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <h2 className="display grow" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>From your LinkedIn</h2>
              <button className="btn" style={{ height: 40, fontSize: 14 }} onClick={() => input.current?.click()} disabled={busy}>
                {busy ? 'Reading…' : hasProfile ? 'Re-import' : 'Import export'}
              </button>
              <input
                ref={input}
                type="file"
                accept=".zip,.csv"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
              />
            </div>

            {!hasProfile && (
              <div className="empty" style={{ fontSize: 14 }}>
                Nothing imported yet. In LinkedIn go to <strong>Settings → Data privacy → Get a copy of your data</strong>,
                pick the full archive, and upload the .zip here. Signing in with LinkedIn returns only your name and email;
                your experience, projects and — most importantly — your connections only exist in that archive. Connections
                are what let Waypoint find a 1st-degree contact at a hiring company.
              </div>
            )}

            {state.profile.map((sec: any) => (
              sec.items.length > 0 && (
                <div key={sec.label} className="stack" style={{ gap: 10 }}>
                  <h3 className="label">{sec.label}</h3>
                  {sec.items.map((it: any, i: number) => (
                    <div key={i} className="stack" style={{ gap: 2, paddingBottom: 10, borderBottom: '1px solid var(--line-2)' }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{it.t}</span>
                      <span style={{ fontSize: 14, color: 'var(--muted)' }}>{it.o}</span>
                      <span style={{ fontSize: 14, lineHeight: 1.45 }}>{it.d}</span>
                    </div>
                  ))}
                </div>
              )
            ))}
          </div>

          <div className="stack resume-rules" style={{ gap: 20 }}>
            <div className="panel stack" style={{ gap: 6, padding: 24 }}>
              <h2 className="display" style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>Which project leads, by role</h2>
              <div className="three-col desktop-only" style={{ gap: 12, padding: '8px 0', borderBottom: '1px solid var(--ink)' }}>
                <span className="label" style={{ letterSpacing: '0.08em' }}>Role</span>
                <span className="label" style={{ letterSpacing: '0.08em' }}>Lead with</span>
                <span className="label" style={{ letterSpacing: '0.08em' }}>Then</span>
              </div>
              {state.picks.map((p: any) => (
                <div key={p.role} className="three-col" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line-2)', fontSize: 14, lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 600 }}>{p.role}</span>
                  <span>{p.lead}</span>
                  <span style={{ color: 'var(--muted)' }}>{p.then}</span>
                </div>
              ))}
            </div>

            <div className="panel stack" style={{ gap: 8, padding: 24 }}>
              <h2 className="display" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Level inferred from your positions</h2>
              <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--muted)' }}>
                The “From LinkedIn” level filter shows roles at {state.levels.join(' and ')}, read from your imported
                titles and years.
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

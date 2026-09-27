'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, copyAndOpen, patch, post } from './api';
import { FILTER_GROUPS, POSTED_WINDOWS } from '@/lib/countries';
import type { Screen } from './Waypoint';

type Props = {
  state: any;
  screen: Screen;
  refresh: () => Promise<any>;
  setToast: (s: string) => void;
  openJob: (id: string) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  toggleCountry: (cc: string, on: boolean) => void;
  go: (s: Screen) => void;
  phone: boolean;
};

// Defaults to the last 7 days: an advert older than that is usually filled, and
// a referral request against a filled role wastes a connection.
const DEFAULT_FILTERS = { field: 'All', mode: 'Any', level: 'Any', posted: 'This week' } as Record<string, string>;

export default function JobsScreen({ state, screen, refresh, setToast, openJob, selected, setSelected, toggleCountry, go, phone }: Props) {
  const [q, setQ] = useState('');
  const [f, setF] = useState(DEFAULT_FILTERS);
  const [sponsorOnly, setSponsorOnly] = useState(false);
  const [topOnly, setTopOnly] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const onCcs = new Set(state.countries.filter((c: any) => c.on).map((c: any) => c.cc));

  const jobs = useMemo(
    () =>
      state.jobs.filter((j: any) => {
        if (!onCcs.has(j.cc)) return false;
        if (f.field !== 'All' && j.field !== f.field) return false;
        if (f.mode !== 'Any' && j.mode !== f.mode) return false;
        if (f.level === 'From LinkedIn') {
          if (!state.levels.includes(j.level)) return false;
        } else if (f.level !== 'Any' && j.level !== f.level) return false;
        if (j.days > (POSTED_WINDOWS[f.posted] ?? Infinity)) return false;
        if (sponsorOnly && !j.sponsor) return false;
        if (topOnly && !j.priority) return false;
        if (q) {
          const hay = `${j.role} ${j.company} ${j.city}`.toLowerCase();
          if (!hay.includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.jobs, state.countries, state.levels, f, sponsorOnly, topOnly, q],
  );

  const activeId = selected && jobs.some((j: any) => j.id === selected) ? selected : phone ? selected : jobs[0]?.id ?? null;

  const activeFilters =
    Object.entries(f).filter(([k, v]) => v !== DEFAULT_FILTERS[k]).length + (sponsorOnly ? 1 : 0) + (topOnly ? 1 : 0);

  const countLabel = `${jobs.length} ${jobs.length === 1 ? 'role' : 'roles'}`;

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await post<{ added: number; total: number; report: any[]; analysing?: { total: number } }>('/api/jobs/refresh');
      await refresh();
      const failed = (res.report || []).filter((r) => r.error);
      const queued = res.analysing?.total || 0;
      setToast(
        `${res.added} new, ${res.total} live in your countries.` +
          (queued ? ` Claude is reading the top ${queued}.` : '') +
          (failed.length ? ` ${failed.length} source${failed.length > 1 ? 's' : ''} failed: ${failed.map((r) => r.source).join(', ')}.` : ''),
      );
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  if (screen === 'detail' && activeId) {
    return <JobDetail id={activeId} state={state} refresh={refresh} setToast={setToast} onBack={() => { setSelected(null); go('jobs'); }} phone={phone} />;
  }

  return (
    <>
      <header className="screen-head" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div className="stack grow">
          <h1 className="display">Jobs</h1>
          <span className="sub desktop-only">
            {countLabel} ·{' '}
            {state.analysing?.running
              ? `Claude is reading ${state.analysing.done + 1} of ${state.analysing.total} · ~ estimates update as it goes`
              : state.claude.mode === 'none'
                ? 'Claude not connected: scores are keyword estimates'
                : `ranked by fit · read by Claude (${state.claude.mode === 'cli' ? 'your subscription' : 'API key'})`}
          </span>
        </div>
        <label className="sr-only" htmlFor="wp-search">Search roles</label>
        <input
          id="wp-search"
          type="search"
          className="field desktop-only"
          style={{ width: 320 }}
          placeholder="Search role, company, city"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn desktop-only" onClick={doRefresh} disabled={refreshing}>
          {refreshing ? 'Fetching…' : 'Refresh feeds'}
        </button>
        <button className="btn mobile-only" style={{ borderRadius: 22 }} onClick={() => setSheet(true)}>
          Filters{activeFilters ? ` · ${activeFilters}` : ''}
        </button>
      </header>

      <div className="filters">
        {FILTER_GROUPS.map((g) => (
          <div key={g.key} role="group" aria-label={g.label} className="filter-group">
            <span className="label">{g.label}</span>
            {g.options.map((o) => (
              <button key={o} className="chip" data-on={f[g.key] === o} aria-pressed={f[g.key] === o} onClick={() => setF({ ...f, [g.key]: o })}>
                {o}
              </button>
            ))}
          </div>
        ))}
        <button className="chip" data-on={sponsorOnly} aria-pressed={sponsorOnly} onClick={() => setSponsorOnly(!sponsorOnly)}>
          Sponsors visa
        </button>
        <button className="chip" data-on={topOnly} aria-pressed={topOnly} onClick={() => setTopOnly(!topOnly)}>
          ★ Top companies
        </button>
      </div>

      <div className="mobile-only" style={{ padding: '0 16px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="sr-only" htmlFor="wp-m-search">Search roles</label>
        <input id="wp-m-search" type="search" className="field" style={{ width: '100%' }} placeholder="Search role, company, city" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {state.countries.map((c: any) => (
            <button
              key={c.cc}
              className="chip"
              style={{ flexShrink: 0, height: 36, borderRadius: 18 }}
              data-on={c.on}
              aria-pressed={c.on}
              onClick={() => toggleCountry(c.cc, !c.on)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="grow" style={{ fontSize: 13, color: 'var(--muted-2)' }}>{countLabel}</span>
          <button className="btn" style={{ height: 36, fontSize: 14 }} onClick={doRefresh} disabled={refreshing}>
            {refreshing ? 'Fetching…' : 'Refresh feeds'}
          </button>
        </div>
      </div>

      <div className="jobs-split">
        <div className="jobs-list">
          {jobs.length === 0 && (
            <div className="empty">
              {state.jobs.length === 0
                ? 'No jobs fetched yet. Press “Refresh feeds” to pull from the company boards in config/watchlist.json, Arbeitnow and Adzuna.'
                : 'No roles match these filters. Loosen a filter or turn a country back on.'}
            </div>
          )}
          {jobs.map((j: any) => (
            <button key={j.id} className="job-card" data-on={!phone && j.id === activeId} onClick={() => openJob(j.id)}>
              <div className="row" style={{ gap: 8, width: '100%' }}>
                <span className="mono grow" style={{ fontSize: 12, color: 'var(--muted)' }}>{j.place} · {j.mode}</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--positive)', fontWeight: 500 }}>{j.matchLabel}</span>
              </div>
              <span className="role">{j.role}</span>
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>{j.priority && <span title="Priority company" style={{ color: 'var(--ink)' }}>★ </span>}{j.company} · {j.field} · {j.level}</span>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', width: '100%' }}>
                <span className="tag">{j.path}</span>
                {j.isSent && !j.isApplied && <span className="tag tag-dark">In pending</span>}
                {j.isApplied && <span className="tag tag-green">Applied</span>}
                <span className="mono" style={{ fontSize: 12, color: 'var(--muted-3)', marginLeft: 'auto' }}>{j.posted}</span>
              </div>
            </button>
          ))}
        </div>

        {!phone && activeId && (
          <section className="jobs-detail">
            <JobDetail id={activeId} state={state} refresh={refresh} setToast={setToast} phone={false} />
          </section>
        )}
      </div>

      {sheet && (
        <div className="sheet" onClick={() => setSheet(false)}>
          <div className="sheet-body" role="dialog" aria-label="Job filters" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2 className="display grow" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Filters</h2>
              <button style={{ height: 44, padding: '0 8px', border: 0, background: 'transparent', fontSize: 15, textDecoration: 'underline' }} onClick={() => { setF(DEFAULT_FILTERS); setSponsorOnly(false); setTopOnly(false); }}>
                Reset
              </button>
            </div>
            {FILTER_GROUPS.map((g) => (
              <div key={g.key} role="group" aria-label={g.label} className="stack" style={{ gap: 8 }}>
                <span className="label" style={{ letterSpacing: '0.08em' }}>{g.label}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {g.options.map((o) => (
                    <button key={o} className="chip" data-on={f[g.key] === o} aria-pressed={f[g.key] === o} onClick={() => setF({ ...f, [g.key]: o })}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button className="chip" style={{ alignSelf: 'flex-start' }} data-on={sponsorOnly} aria-pressed={sponsorOnly} onClick={() => setSponsorOnly(!sponsorOnly)}>
              Sponsors visa only
            </button>
            <button className="chip" style={{ alignSelf: 'flex-start' }} data-on={topOnly} aria-pressed={topOnly} onClick={() => setTopOnly(!topOnly)}>
              ★ Top companies only
            </button>
            <button className="btn btn-dark" style={{ height: 52, borderRadius: 10, fontSize: 16, fontWeight: 600 }} onClick={() => setSheet(false)}>
              Show {countLabel}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function JobDetail({ id, state, refresh, setToast, onBack, phone }: { id: string; state: any; refresh: () => Promise<any>; setToast: (s: string) => void; onBack?: () => void; phone: boolean }) {
  const [job, setJob] = useState<any>(null);
  const [note, setNote] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setJob(null);
    setNote('');
    api(`/api/jobs/${id}`)
      .then(async (j: any) => {
        if (!live) return;
        setJob(j);
        setNote(j.note || '');
        if (j.noteReady) return;
        // Second round trip: the posting and the referral route are already on
        // screen while Claude writes the note.
        setDrafting(true);
        try {
          const { note: fresh } = await post<{ note: string }>(`/api/jobs/${id}/note`);
          if (live) setNote(fresh);
        } catch (e) {
          if (live) setToast((e as Error).message);
        } finally {
          if (live) setDrafting(false);
        }
      })
      .catch((e) => setToast(e.message));
    return () => { live = false; };
  }, [id, setToast]);

  if (!job) {
    return (
      <div className="panel stack" style={{ gap: 16, fontSize: 15, color: 'var(--muted)' }}>
        {onBack && (
          <button onClick={onBack} style={{ alignSelf: 'flex-start', height: 44, padding: '0 4px', border: 0, background: 'transparent', fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
            ← All jobs
          </button>
        )}
        Reading the description and checking it against your profile…
      </div>
    );
  }

  const best = job.routes[0] || null;
  const overLimit = note.length > 300;

  const saveNote = (v: string) => {
    setNote(v);
    patch(`/api/jobs/${id}`, { note: v }).catch(() => {});
  };

  const redraft = async () => {
    setBusy('note');
    try {
      const { note: fresh } = await post<{ note: string }>(`/api/jobs/${id}/note`);
      setNote(fresh);
      setToast('Note redrafted from the description.');
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sendRequest = async () => {
    setBusy('send');
    try {
      await patch(`/api/jobs/${id}`, { note });
      const res = await post<{ copy: string; open: string }>('/api/outreach', { jobId: id, action: 'send-request' });
      await copyAndOpen(res.copy, res.open);
      await refresh();
      setJob({ ...job, isSent: true });
      setToast('Note copied and LinkedIn opened. Paste it into the connection request, then send it there.');
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const markApplied = async () => {
    await patch(`/api/jobs/${id}`, { applied: !job.isApplied });
    setJob({ ...job, isApplied: !job.isApplied });
    await refresh();
  };

  return (
    <div className="panel stack" style={{ gap: 28 }}>
      {onBack && (
        <button onClick={onBack} style={{ alignSelf: 'flex-start', height: 44, padding: '0 4px', border: 0, background: 'transparent', fontSize: 15, fontWeight: 500 }}>
          ← All jobs
        </button>
      )}

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="stack grow" style={{ gap: 8, minWidth: 240 }}>
          <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{job.place} · {job.mode} · {job.visa}</span>
          <h2 className="display" style={{ margin: 0, fontSize: phone ? 28 : 34, lineHeight: 1.1, fontWeight: 700, letterSpacing: '-0.02em' }}>{job.role}</h2>
          <span style={{ fontSize: 16, color: 'var(--muted)' }}>{job.company} · found on {job.sourceList} · {job.match}% match</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <a className="btn" href={job.url} target="_blank" rel="noopener noreferrer">Open posting</a>
          <button className="btn btn-dark" onClick={markApplied}>{job.isApplied ? 'Applied' : 'Mark applied'}</button>
        </div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <h3 className="label">What the description asks for</h3>
        <div className="two-col-tight">
          {job.reqs.map((r: any, i: number) => (
            <div key={i} className="req" data-ok={r.ok}>
              <span className="grow">{r.t}</span>
              <span className="mono mark">{r.ok ? 'ON PROFILE' : 'NOT ON PROFILE'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="two-col">
        <div className="stack" style={{ gap: 14 }}>
          <h3 className="label">Referral route</h3>

          {job.routes.length === 0 && (
            <div className="empty" style={{ padding: 14, fontSize: 14 }}>
              No 1st-degree connection at {job.company} in your imported export. Re-upload a fresh export on the Resume
              screen, or search LinkedIn for {state.profile?.[1]?.items?.[0]?.o || 'your school'} alumni there.
            </div>
          )}

          {job.routes.map((c: any) => (
            <div key={c.name} className="contact" data-best={c.best}>
              <span className="avatar avatar-light">{c.init}</span>
              <div className="stack grow" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{c.role}</span>
                <span style={{ fontSize: 13, color: 'var(--link)' }}>{c.why}</span>
              </div>
              {c.best && <span className="mono" style={{ fontSize: 11, padding: '3px 6px', borderRadius: 4, background: 'var(--ink)', color: 'var(--ground)' }}>BEST</span>}
            </div>
          ))}

          <div className="stack" style={{ gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <label htmlFor="wp-note" style={{ fontSize: 14, fontWeight: 600, flexGrow: 1 }}>Connection note, written from the description</label>
              <button onClick={redraft} disabled={busy === 'note' || drafting} style={{ border: 0, background: 'transparent', fontSize: 13, textDecoration: 'underline', padding: 0 }}>
                {busy === 'note' || drafting ? 'Drafting…' : 'Redraft'}
              </button>
              <span className="mono" style={{ fontSize: 12, color: overLimit ? 'var(--danger)' : 'var(--muted-3)' }}>{note.length}/300</span>
            </div>
            <textarea
              id="wp-note"
              className="note-area"
              value={note}
              placeholder={drafting ? 'Claude is writing this from the description…' : ''}
              onChange={(e) => saveNote(e.target.value)}
            />
          </div>

          {!job.isSent ? (
            <button className="btn-accent" onClick={sendRequest} disabled={busy === 'send' || drafting || !best}>
              {busy === 'send' ? 'Copying…' : drafting ? 'Waiting for the note…' : best ? `Send connect request to ${best.name}` : 'No contact to send to'}
            </button>
          ) : (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--ink)', color: 'var(--ground)', fontSize: 14, lineHeight: 1.5 }}>
              Request sent. This job is in Pending — mark it accepted there when {best?.name || 'they'} accept
              {best ? 's' : ''}, and the referral message will be drafted for you.
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 14 }}>
          <h3 className="label">Your CV for this role</h3>
          <div className="must">
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent-ink)' }}>Must be on it</span>
            {job.must.map((m: string, i: number) => (
              <div key={i} style={{ fontSize: 14, lineHeight: 1.45, display: 'flex', gap: 8 }}>
                <span className="dash">—</span><span>{m}</span>
              </div>
            ))}
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Projects to lead with</span>
            {job.projects.map((p: any) => (
              <div key={p.rank} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line-2)' }}>
                <span className="mono" style={{ fontSize: 13, color: 'var(--muted-3)', width: 18 }}>{p.rank}</span>
                <div className="stack" style={{ gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{p.n}</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.4 }}>{p.why}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

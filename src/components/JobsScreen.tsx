'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, copyAndOpen, copyText, del, draftCopyOpen, patch, post } from './api';
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
// a referral request against a filled role wastes a connection. Level defaults to
// the profile's own, so roles asking for more experience than it has stay out of
// the way until asked for.
const DEFAULT_FILTERS = { field: 'All', mode: 'Any', level: 'From LinkedIn', posted: 'This week' } as Record<string, string>;

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

      <div className="mobile-only" style={{ padding: '0 var(--gutter) 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
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

/** LinkedIn's cap on a connection note; the server drafts within it, and the
 *  counter is for edits made here. */
const NOTE_LIMIT = 300;

/**
 * Waypoint cannot search LinkedIn, so the search is a link and the choice of
 * person is the user's. The guide is what it would rank on if it could.
 */
function AlumniAsk({ alumni, company, city, busy, onFind }: { alumni: { school: string }; company: string; city: string; busy: boolean; onFind: () => void }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="must">
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent-ink)' }}>Whom to pick from the results</span>
        {[
          'A recruiter, HR or talent-acquisition person: routing referrals is their job, and they are paid to answer.',
          'Otherwise the most senior engineer in this role’s team or field.',
          'Otherwise anyone from your own programme.',
          `Among equals, someone who lists ${city || 'the job’s city'} or its country.`,
        ].map((t, i) => (
          <div key={i} style={{ fontSize: 14, lineHeight: 1.45, display: 'flex', gap: 8 }}>
            <span className="dash">{i < 3 ? `${i + 1}.` : '—'}</span><span>{t}</span>
          </div>
        ))}
      </div>
      <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
        They are not connections, so this drafts a {NOTE_LIMIT}-character connection note — no room for your CV link; the
        referral message with it comes once they accept.
      </span>
      <button className="btn-accent" onClick={onFind} disabled={busy}>
        {busy ? 'Drafting the connection note…' : `Find ${alumni.school} alumni at ${company}`}
      </button>
    </div>
  );
}

function AlumniNote({ referral, blocked, setToast }: { referral: { copy: string; open: string | null; name: string }; blocked: boolean; setToast: (s: string) => void }) {
  const [text, setText] = useState(referral.copy);
  return (
    <div className="stack" style={{ gap: 10, padding: '12px 14px', borderRadius: 8, background: 'var(--ink)', color: 'var(--ground)', fontSize: 14, lineHeight: 1.5 }}>
      <span>
        Connection note for {referral.name}. Pick one person, press Connect → Add a note, and paste. This job is in Pending —
        when they accept, press They accepted there for the referral message with your CV.
      </span>
      <textarea className="note-area" style={{ minHeight: 110, color: 'var(--ink)' }} value={text} onChange={(e) => setText(e.target.value)} />
      <span className="mono" style={{ fontSize: 12, alignSelf: 'flex-end', color: text.length > NOTE_LIMIT ? 'var(--accent)' : 'inherit' }}>
        {text.length}/{NOTE_LIMIT}{text.length > NOTE_LIMIT ? ' — LinkedIn will reject this' : ''}
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => copyText(text).then((ok) => setToast(ok ? 'Connection note copied.' : 'The browser blocked the clipboard; select the note and copy it.'))}>Copy note</button>
        {referral.open && (
          <a className={blocked ? 'btn-accent' : 'btn'} href={referral.open} target="_blank" rel="noopener noreferrer">
            Open alumni search
          </a>
        )}
      </div>
    </div>
  );
}

type ChatTurn = { role: 'you' | 'claude'; text: string; at: string };
type Cv = {
  pdfUrl: string;
  driveUrl: string | null;
  driveReason?: string | null;
  tailored?: boolean;
  lead?: string | null;
  projects?: string[];
  bullets?: string[];
  skills?: string[];
  reason?: string | null;
  chat: ChatTurn[];
};

function JobDetail({ id, state, refresh, setToast, onBack, phone }: { id: string; state: any; refresh: () => Promise<any>; setToast: (s: string) => void; onBack?: () => void; phone: boolean }) {
  const [job, setJob] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Shown only when the browser blocked the new tab, so opening it costs one
  // more click instead of silently not happening.
  const [blocked, setBlocked] = useState(false);
  const [cv, setCv] = useState<Cv | null>(null);
  const [cvBusy, setCvBusy] = useState<'generate' | 'refine' | 'reset' | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  // A compile outlives a click to another job; its answer must not land on that job.
  const shown = useRef(id);

  useEffect(() => {
    let live = true;
    shown.current = id;
    setJob(null);
    setBlocked(false);
    setCv(null);
    setCvBusy(null);
    setCvError(null);
    api(`/api/jobs/${id}`)
      .then((j: any) => {
        if (!live) return;
        setJob(j);
        setCv(j.cv);
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

  const findContact = async () => {
    setBusy('send');
    try {
      type Referral = { copy: string; open: string | null; name: string; resume: { tailored: boolean; lead: string | null; publicUrl: string | null; reason: string | null; shareReason: string | null } | null };
      const { res, copied, opened } = await draftCopyOpen(post<Referral>('/api/outreach', { jobId: id, action: 'referral' }));
      setJob({ ...job, isSent: true, referral: { copy: res.copy, open: res.open, name: res.name } });
      setBlocked(!opened);
      // The referral built and uploaded the CV, so the generator above now has a file to show.
      api<any>(`/api/jobs/${id}`).then((j) => { if (shown.current === id) setCv(j.cv); }).catch(() => {});
      await refresh();
      const built = res.resume;
      const cvNote = !built ? null : built.publicUrl ? `CV link in the message${built.tailored && built.lead ? `, leading with ${built.lead}` : ''}.` : built.shareReason || built.reason;
      const did = copied && opened ? `Referral message copied and ${res.name}'s profile opened. Paste it into a message there.`
        : copied ? `Referral message copied. The browser blocked the new tab, so open ${res.name}'s profile below.`
        : `The browser blocked the clipboard. Use the buttons below to copy the message and open ${res.name}'s profile.`;
      setToast([did, cvNote].filter(Boolean).join(' '));
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const findAlumni = async () => {
    setBusy('alumni');
    try {
      const { res, copied, opened } = await draftCopyOpen(post<{ copy: string; open: string; name: string }>('/api/outreach', { jobId: id, action: 'alumni' }));
      setJob({ ...job, isSent: true, referral: { copy: res.copy, open: res.open, name: res.name, alumni: true } });
      setBlocked(!opened);
      await refresh();
      setToast(
        copied && opened ? `Connection note copied and the ${job.alumni.school} alumni search opened. Pick one person, press Connect → Add a note, and paste.`
        : copied ? 'Connection note copied. The browser blocked the new tab, so open the alumni search below.'
        : 'The browser blocked the clipboard. Copy the note below and open the alumni search.',
      );
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

  const cvCall = async (kind: 'generate' | 'refine' | 'reset', call: () => Promise<Cv>) => {
    const forId = id;
    setCvBusy(kind);
    setCvError(null);
    try {
      const fresh = await call();
      if (shown.current === forId) setCv(fresh);
      return true;
    } catch (e) {
      if (shown.current === forId) setCvError((e as Error).message);
      return false;
    } finally {
      if (shown.current === forId) setCvBusy(null);
    }
  };
  const generateCv = () => cvCall('generate', () => post<Cv>(`/api/jobs/${id}/resume`));
  const refineCv = (message: string) => cvCall('refine', () => post<Cv>(`/api/jobs/${id}/resume/refine`, { message }));
  const resetCv = () => cvCall('reset', () => del<Cv>(`/api/jobs/${id}/resume/refine`));

  const cvProps = { cv, busy: cvBusy, onGenerate: generateCv };

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
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <h3 className="label grow" style={{ margin: 0 }}>What the description asks for</h3>
          <GenerateCv {...cvProps} />
        </div>
        <div className="two-col-tight">
          {job.reqs.map((r: any, i: number) => (
            <div key={i} className="req" data-ok={r.ok}>
              <span className="grow">{r.t}</span>
              <span className="mono mark">{r.ok ? 'ON PROFILE' : 'NOT ON PROFILE'}</span>
            </div>
          ))}
        </div>
        <CvStatus busy={cvBusy} error={cvError} />
        {cv && (
          <div className="stack" style={{ gap: 12, padding: 14, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)' }}>
            <CvLinks cv={cv} setToast={setToast} />
            <CvSummary cv={cv} />
            <RefineCv cv={cv} busy={cvBusy} onRefine={refineCv} onReset={resetCv} />
          </div>
        )}
      </div>

      <div className="two-col">
        <div className="stack" style={{ gap: 14 }}>
          <h3 className="label">Referral route</h3>

          {job.routes.length === 0 && (
            <div className="empty" style={{ padding: 14, fontSize: 14 }}>
              No 1st-degree connection at {job.company} in your imported export. Re-upload a fresh export on the Resume
              screen, or ask {job.alumni ? `a ${job.alumni.school}` : 'an'} alumnus there with a connection note.
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

          <div className="stack" style={{ gap: 8 }}>
            {cv ? (
              <>
                <CvLinks cv={cv} setToast={setToast} />
                {cv.driveUrl && (
                  <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
                    The referral message links this same file, so refining it later updates what they see.
                  </span>
                )}
              </>
            ) : (
              <GenerateCv {...cvProps} />
            )}
            {!cv && <CvStatus busy={cvBusy} error={cvError} />}
          </div>

          {job.referral?.alumni ? (
            <AlumniNote key={id} referral={job.referral} blocked={blocked} setToast={setToast} />
          ) : !job.referral && !best && job.alumni ? (
            <AlumniAsk alumni={job.alumni} company={job.company} city={job.city} busy={busy === 'alumni'} onFind={findAlumni} />
          ) : !job.referral ? (
            <button className="btn-accent" onClick={findContact} disabled={busy === 'send' || !best}>
              {busy === 'send' ? 'Drafting the referral and your CV…' : best ? `Find contact: ${best.name}` : 'No contact to ask'}
            </button>
          ) : (
            <div className="stack" style={{ gap: 10, padding: '12px 14px', borderRadius: 8, background: 'var(--ink)', color: 'var(--ground)', fontSize: 14, lineHeight: 1.5 }}>
              <span>
                Referral message drafted for {job.referral.name}. This job is in Pending — when they reply, paste it there.
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => copyAndOpen(job.referral.copy).then(() => setToast('Referral message copied.'))}>Copy message</button>
                {job.referral.open && (
                  <a className={blocked ? 'btn-accent' : 'btn'} href={job.referral.open} target="_blank" rel="noopener noreferrer">
                    Open {job.referral.name.split(' ')[0]}&apos;s profile
                  </a>
                )}
              </div>
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

type CvBusy = 'generate' | 'refine' | 'reset' | null;

function GenerateCv({ cv, busy, onGenerate }: { cv: Cv | null; busy: CvBusy; onGenerate: () => void }) {
  return (
    <button className="btn" style={{ alignSelf: 'flex-start', height: 36, fontSize: 14 }} onClick={onGenerate} disabled={!!busy}>
      {busy === 'generate' ? 'Building résumé…' : cv ? 'Rebuild résumé' : 'Generate résumé for this job'}
    </button>
  );
}

function CvStatus({ busy, error }: { busy: CvBusy; error: string | null }) {
  if (error) {
    return <span role="alert" style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--danger)' }}>{error}</span>;
  }
  if (!busy) return null;
  return (
    <span role="status" style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--muted)' }}>
      {busy === 'refine'
        ? 'Claude is choosing what to change, then the CV recompiles and Drive updates…'
        : 'Tailoring the CV, compiling the LaTeX and uploading to Drive. A first compile can take a minute.'}
    </span>
  );
}

function CvLinks({ cv, setToast }: { cv: Cv; setToast: (s: string) => void }) {
  const copy = async () => {
    if (!cv.driveUrl) return;
    setToast((await copyText(cv.driveUrl)) ? 'Drive link copied.' : 'Could not reach the clipboard here; copy the link by hand.');
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', fontSize: 14 }}>
        {cv.driveUrl ? (
          <>
            <a href={cv.driveUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>CV on Drive</a>
            <input
              readOnly
              aria-label="Drive link"
              className="field mono"
              style={{ height: 32, fontSize: 12, flex: '1 1 180px', minWidth: 0 }}
              value={cv.driveUrl}
              onFocus={(e) => e.target.select()}
            />
            <button onClick={copy} style={{ border: 0, background: 'transparent', fontSize: 13, textDecoration: 'underline', padding: 0 }}>Copy</button>
          </>
        ) : (
          <span style={{ color: 'var(--muted)' }}>No Drive link</span>
        )}
        <a href={cv.pdfUrl} target="_blank" rel="noopener noreferrer">Local PDF</a>
      </div>
      {!cv.driveUrl && cv.driveReason && (
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--warn-ink)' }}>{cv.driveReason}. The local PDF is ready to attach by hand.</span>
      )}
    </div>
  );
}

/** Says what the build actually did, because an untailored CV looks exactly
 *  like a tailored one until someone reads it. */
function CvSummary({ cv }: { cv: Cv }) {
  // Opened from a saved job, before anything was rebuilt: only the lead is known.
  if (cv.tailored === undefined) {
    return cv.lead ? <span style={{ fontSize: 14, color: 'var(--muted)' }}>Leads with {cv.lead}.</span> : null;
  }
  return (
    <div className="stack" style={{ gap: 4, fontSize: 14, lineHeight: 1.45 }}>
      {cv.tailored ? (
        <>
          {cv.lead && <span>Leads with <strong>{cv.lead}</strong>.</span>}
          {!!cv.projects?.length && <span style={{ color: 'var(--muted)' }}>Projects: {cv.projects.join(' · ')}</span>}
          {!!cv.skills?.length && <span style={{ color: 'var(--muted)' }}>Skills up front: {cv.skills.join(', ')}</span>}
        </>
      ) : (
        <span style={{ color: 'var(--warn-ink)' }}>Base CV, not tailored{cv.reason ? `: ${cv.reason}` : ''}.</span>
      )}
    </div>
  );
}

function RefineCv({ cv, busy, onRefine, onReset }: { cv: Cv; busy: CvBusy; onRefine: (m: string) => Promise<boolean>; onReset: () => Promise<boolean> }) {
  const [open, setOpen] = useState(cv.chat.length > 0);
  const [draft, setDraft] = useState('');

  const send = async () => {
    const m = draft.trim();
    if (!m || busy) return;
    if (await onRefine(m)) setDraft('');
  };

  const turns = cv.chat.filter((t) => t.role === 'you').length;

  return (
    <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--line-2)', paddingTop: 10 }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, fontSize: 14, fontWeight: 600 }}
      >
        {open ? '▾' : '▸'} Refine with Claude{turns ? ` · ${turns} change${turns === 1 ? '' : 's'}` : ''}
      </button>
      {open && (
        <>
          <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
            Claude only reorders and chooses between entries already in your CV and claims.yml — it never writes new lines.
            Each change recompiles the PDF and updates the same Drive file.
          </span>
          {cv.chat.map((t, i) => (
            <p key={i} className={t.role === 'you' ? 'quote' : 'sent-body'} style={{ maxWidth: '85%', alignSelf: t.role === 'you' ? 'flex-end' : 'flex-start' }}>
              {t.text}
            </p>
          ))}
          <label className="sr-only" htmlFor="wp-refine">What to change</label>
          <textarea
            id="wp-refine"
            className="note-area"
            style={{ minHeight: 72 }}
            value={draft}
            placeholder="e.g. Emphasise the ROS 2 work and drop the hackathon"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          />
          <div className="row" style={{ gap: 12 }}>
            <button className="btn btn-dark" style={{ height: 36, fontSize: 14 }} onClick={send} disabled={!!busy || !draft.trim()}>
              {busy === 'refine' ? 'Refining…' : 'Send'}
            </button>
            {turns > 0 && (
              <button onClick={onReset} disabled={!!busy} style={{ border: 0, background: 'transparent', fontSize: 13, textDecoration: 'underline', padding: 0 }}>
                {busy === 'reset' ? 'Resetting…' : 'Start over from the posting'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

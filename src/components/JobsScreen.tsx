'use client';

import { useEffect, useRef, useState } from 'react';
import { Sheet } from './ui';
import { runTask } from './tasks';
import { api, copyAndOpen, copyText, del, draftCopyOpen, patch, post } from './api';
import { BLOCKER_LABEL, STATUS_LABEL, legitimacyLine } from '@/lib/jobcheck-text';
import type { JobCard, Me } from './data';
import JobList from './jobs/JobList';
import { useJobList } from './jobs/useJobList';

type Props = {
  me: Me;
  /** Undefined while the jobs load. */
  jobs: JobCard[] | undefined;
  error?: Error;
  onRetry: () => void;
  refresh: () => Promise<any>;
  setToast: (s: string) => void;
  openJob: (id: string) => void;
  closeJob: () => void;
  selected: string | null;
  goToSettings: () => void;
};

/** True on a tablet (640 to 1023 px), where the job opens in a side sheet. */
function useTablet() {
  const [tablet, setTablet] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(min-width: 640px) and (max-width: 1023px)');
    const sync = () => setTablet(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);
  return tablet;
}

/** The list column beside the job. On a tablet the job is a side sheet over the list; on a phone it is a full screen. */
export default function JobsScreen({ me, jobs, error, onRetry, refresh, setToast, openJob, closeJob, selected, goToSettings }: Props) {
  const list = useJobList({ me, jobs, selected, openJob, closeJob });
  const tablet = useTablet();
  const { activeId } = list;
  const detail = (id: string) => <JobDetail id={id} state={{ ...me, jobs: jobs ?? [] }} refresh={refresh} setToast={setToast} phone={false} />;

  return (
    <div className="jobs-split">
      <JobList me={me} list={list} loading={!jobs && !error} error={jobs ? undefined : error} onRetry={onRetry} refresh={refresh} setToast={setToast} openJob={openJob} onSettings={goToSettings} />

      {/* On a tablet the Sheet traps focus, closes on Esc and gives focus back to the row. */}
      {tablet && selected && (
        <Sheet open onClose={closeJob} title="Job" className="jd-sheet">
          {detail(selected)}
        </Sheet>
      )}
      {!tablet && activeId && (
        <section className="jobs-detail" aria-label="Job">
          {detail(activeId)}
        </section>
      )}
    </div>
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

type Wording = {
  suggestions: { dropped: number; items: { bulletId: string; text: string; old: string; labels: string[]; status: 'pending' | 'accepted' | 'rejected' }[] };
  keywords: { inResume: string[]; missingWithEvidence: string[] };
};

const wrapText = { minWidth: 0, overflowWrap: 'anywhere' } as const;

/** The job check: summary, blockers, flags, the top requirements and the parts of the score. */
function JobCheck({ job }: { job: any }) {
  const [all, setAll] = useState(false);
  const [parts, setParts] = useState(false);
  const reqs: any[] = job.requirements || [];
  const musts = reqs.filter((r) => r.importance === 'must');
  const top = (musts.length ? musts : reqs).slice(0, 3);
  const shown = all ? reqs : top;
  const flags = legitimacyLine(job.legitimacy || []);
  return (
    <div className="stack" style={{ gap: 12 }}>
      {job.summary && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, ...wrapText }}>{job.summary}</p>}
      {job.blockers?.length > 0 && (
        <div role="alert" className="stack" style={{ gap: 6, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 14, lineHeight: 1.45 }}>
          <strong>This posting has {job.blockers.length === 1 ? 'a blocker' : 'blockers'}.</strong>
          {job.blockers.map((b: any, i: number) => (
            <span key={i} style={wrapText}>
              {BLOCKER_LABEL[b.type] ?? b.type}: “{b.quote}”
            </span>
          ))}
        </div>
      )}
      {job.warning && <p role="status" style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: 'var(--warn-ink)', ...wrapText }}>{job.warning}</p>}
      {flags && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: 'var(--warn-ink)', ...wrapText }}>{flags}</p>}
      <div className="two-col-tight">
        {shown.map((r: any, i: number) => (
          <div key={i} className="req" data-ok={r.status === 'met'} style={{ flexWrap: 'wrap' }}>
            <span className="grow" style={wrapText}>{r.text}</span>
            <span className="mono mark">{STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? r.status}</span>
            {r.evidence?.length > 0 && <span style={{ flexBasis: '100%', fontSize: 13, color: 'var(--muted)', ...wrapText }}>Evidence: {r.evidence.join(', ')}</span>}
          </div>
        ))}
      </div>
      {reqs.length > top.length && (
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all (${reqs.length})`}
        </button>
      )}
      <div className="stack" style={{ gap: 6 }}>
        <button className="btn" style={{ alignSelf: 'flex-start' }} aria-expanded={parts} onClick={() => setParts(!parts)}>
          How this score was made
        </button>
        {parts && (
          <div className="stack" style={{ gap: 4, fontSize: 14 }}>
            {job.by !== 'claude' && <span style={{ color: 'var(--muted)' }}>Estimated without Claude</span>}
            {(job.parts || []).map((p: any, i: number) => (
              <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <span className="grow" style={wrapText}>{p.label}</span>
                <span className="mono">{p.points > 0 ? '+' : ''}{p.points}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobDetail({ id, state, refresh, setToast, onBack, phone }: { id: string; state: any; refresh: () => Promise<any>; setToast: (s: string) => void; onBack?: () => void; phone: boolean }) {
  const [job, setJob] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Shown only when the browser blocked the new tab, so opening it costs one
  // more click instead of silently not happening.
  const [blocked, setBlocked] = useState(false);
  const [cv, setCv] = useState<Cv | null>(null);
  const [cvBusy, setCvBusy] = useState<'generate' | 'refine' | 'reset' | 'suggest' | null>(null);
  const [wording, setWording] = useState<Wording | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  // A compile outlives a click to another job; its answer must not land on that job.
  const shown = useRef(id);

  useEffect(() => {
    let live = true;
    shown.current = id;
    setJob(null);
    setBlocked(false);
    setCv(null);
    setWording(null);
    setCvBusy(null);
    setCvError(null);
    api(`/api/jobs/${id}`)
      .then(async (j: any) => {
        if (!live) return;
        setJob(j);
        setCv(j.cv);
        setWording(j.wording ?? null);
        // The worker reads the job. The screen shows the estimate until the task ends, then loads the job again.
        if (!j.analysing) return;
        try {
          await runTask(async () => ({ taskId: j.analysing }));
          const done = await api<any>(`/api/jobs/${id}`);
          if (live) setJob({ ...done, analysing: null });
        } catch {
          // The estimate stays. A later visit queues the analysis again.
          if (live) setJob((cur: any) => cur && { ...cur, analysing: null });
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

  const findContact = async () => {
    setBusy('send');
    try {
      type Referral = { copy: string; open: string | null; name: string; resume: { tailored: boolean; lead: string | null; publicUrl: string | null; reason: string | null; shareReason: string | null } | null };
      const { res, copied, opened } = await draftCopyOpen(runTask<Referral>(() => post('/api/outreach', { jobId: id, action: 'referral' })));
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
      const { res, copied, opened } = await draftCopyOpen(runTask<{ copy: string; open: string; name: string }>(() => post('/api/outreach', { jobId: id, action: 'alumni' })));
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

  const cvCall = async (kind: 'generate' | 'refine' | 'reset' | 'suggest', start: () => Promise<{ taskId: string }>) => {
    const forId = id;
    setCvBusy(kind);
    setCvError(null);
    try {
      const fresh = await runTask<Cv & Partial<Wording>>(start);
      if (shown.current === forId) {
        // A suggest task builds no PDF. Its result holds only the suggestions and the keyword report.
        if (kind !== 'suggest') setCv(fresh);
        if (fresh.suggestions && fresh.keywords) setWording({ suggestions: fresh.suggestions, keywords: fresh.keywords });
      }
      return true;
    } catch (e) {
      if (shown.current === forId) setCvError((e as Error).message);
      return false;
    } finally {
      if (shown.current === forId) setCvBusy(null);
    }
  };
  const generateCv = () => cvCall('generate', () => post<{ taskId: string }>(`/api/jobs/${id}/resume`));
  const refineCv = (message: string) => cvCall('refine', () => post<{ taskId: string }>(`/api/jobs/${id}/resume/refine`, { message }));
  const resetCv = () => cvCall('reset', () => del<{ taskId: string }>(`/api/jobs/${id}/resume/refine`));
  const suggestWording = () => cvCall('suggest', () => post<{ taskId: string }>(`/api/jobs/${id}/resume/suggestions`, { action: 'suggest' }));
  // Accept builds the CV again in the worker. Reject changes only the mark of the suggestion.
  const decide = async (bulletId: string, action: 'accept' | 'reject') => {
    if (action === 'accept') return cvCall('generate', () => post<{ taskId: string }>(`/api/jobs/${id}/resume/suggestions`, { bulletId, action }));
    try {
      await post(`/api/jobs/${id}/resume/suggestions`, { bulletId, action });
      setWording((w) => w && { ...w, suggestions: { ...w.suggestions, items: w.suggestions.items.map((i) => (i.bulletId === bulletId ? { ...i, status: 'rejected' } : i)) } });
      return true;
    } catch (e) {
      setCvError((e as Error).message);
      return false;
    }
  };

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
          {job.analysing && <span role="status" style={{ fontSize: 14, color: 'var(--muted)' }}>Claude is reading the description. The score is an estimate until it ends.</span>}
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
        <JobCheck job={job} />
        <CvStatus busy={cvBusy} error={cvError} />
        {(cv || wording) && (
          <div className="stack" style={{ gap: 12, padding: 14, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)' }}>
            {cv && <CvLinks cv={cv} setToast={setToast} />}
            {cv && <CvSummary cv={cv} />}
            {cv && <RefineCv cv={cv} busy={cvBusy} onRefine={refineCv} onReset={resetCv} />}
            {wording && <SuggestWording wording={wording} busy={cvBusy} onSuggest={suggestWording} onDecide={decide} />}
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

type CvBusy = 'generate' | 'refine' | 'reset' | 'suggest' | null;

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
        : busy === 'suggest'
        ? 'Claude is writing suggestions. Waypoint checks each one against your profile…'
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

/** The keyword report, then the wording suggestions. The user decides on each suggestion. */
function SuggestWording({ wording, busy, onSuggest, onDecide }: { wording: Wording; busy: CvBusy; onSuggest: () => void; onDecide: (bulletId: string, action: 'accept' | 'reject') => Promise<boolean> }) {
  const { items, dropped } = wording.suggestions;
  const { inResume, missingWithEvidence } = wording.keywords;
  return (
    <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--line-2)', paddingTop: 10 }}>
      {(inResume.length > 0 || missingWithEvidence.length > 0) && (
        <div className="stack" style={{ gap: 4, fontSize: 14, lineHeight: 1.45, ...wrapText }}>
          {inResume.length > 0 && <span>Words of the posting that your CV has: <strong>{inResume.join(', ')}</strong>.</span>}
          {missingWithEvidence.length > 0 && (
            <span style={{ color: 'var(--warn-ink)' }}>
              Words of the posting that your profile proves, but your CV does not show: <strong>{missingWithEvidence.join(', ')}</strong>.
            </span>
          )}
        </div>
      )}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn" style={{ height: 36, fontSize: 14 }} onClick={onSuggest} disabled={!!busy}>
          {busy === 'suggest' ? 'Looking for wording…' : 'Suggest wording'}
        </button>
        <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45, flex: '1 1 200px', minWidth: 0 }}>
          Claude proposes new words for your bullets. Waypoint checks each one against your profile. Nothing changes until you accept it.
        </span>
      </div>
      {dropped > 0 && (
        <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
          Waypoint dropped {dropped} {dropped === 1 ? 'suggestion' : 'suggestions'}, because the text had a number, a name or a tool that your profile does not show.
        </span>
      )}
      {items.map((s) => (
        <div key={s.bulletId} className="stack" style={{ gap: 6, padding: 10, borderRadius: 8, border: '1px solid var(--line-2)', ...wrapText }}>
          <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45, textDecoration: s.status === 'accepted' ? 'line-through' : undefined }}>Old: {s.old}</span>
          <span style={{ fontSize: 14, lineHeight: 1.45 }}>New: {s.text}</span>
          {s.labels.length > 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>Backed by: {s.labels.join(', ')}</span>}
          {s.status === 'pending' ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-dark" style={{ height: 36, fontSize: 14 }} disabled={!!busy} onClick={() => onDecide(s.bulletId, 'accept')}>Accept</button>
              <button className="btn" style={{ height: 36, fontSize: 14 }} disabled={!!busy} onClick={() => onDecide(s.bulletId, 'reject')}>Reject</button>
            </div>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 600 }}>{s.status === 'accepted' ? 'Accepted. The CV uses the new text.' : 'Rejected.'}</span>
          )}
        </div>
      ))}
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

'use client';

import { useRef, useState } from 'react';
import { copyText } from '../api';
import { Button, ErrorNote, Field, Fold } from '../ui';
import { PartBack } from './PartBack';
import { PdfPreview } from './PdfPreview';
import { showSection } from './scroll';
import { builtAgo } from './time';
import type { Cv, CvBusy, JobDetailState, Part, Wording } from './types';

const EMPTY_WORDING: Wording = { suggestions: { dropped: 0, items: [] }, keywords: { inResume: [], missingWithEvidence: [] } };
const COMPILE_FAILED = 'the CV did not compile';

/** What to tell the user when "Suggest wording" cannot run. Null when Claude is on. */
export function cliOffNote(cliOff: boolean): string {
  return cliOff
    ? 'Claude CLI is off: it failed its self-test. The admin can read the reason on the health page.'
    : 'Add an API key in Settings to use Claude.';
}

export function suggestBlockedNote(claude: { mode: string; cliOff?: boolean }): string | null {
  return claude.mode === 'none' ? cliOffNote(!!claude.cliOff) : null;
}

/** One line for the fold, so the user sees the state without opening it. */
export function cvStatus(job: JobDetailState['job'], cv: Cv | null): string {
  if (!cv) return job.projects[0] ? `Not built yet. It will lead with ${job.projects[0].n}.` : 'Not built yet.';
  if (cv.reason?.startsWith(COMPILE_FAILED)) return 'The last build failed. The CV shown is the base CV.';
  return cv.builtAt ? `Built ${builtAgo(cv.builtAt)}` : 'Built';
}

/** A server error has a first line and, for a LaTeX failure, the log lines after it. */
function errorParts(message: string): { what: string; fix: string; detail?: string } {
  const [first, ...rest] = message.split('\n');
  const latex = /compile|latex|pdftex/i.test(message);
  return { what: latex ? 'The CV did not build.' : 'Waypoint could not finish this.', fix: first, detail: rest.join('\n').trim() || undefined };
}

function CvError({ message }: { message: string }) {
  const { what, fix, detail } = errorParts(message);
  return <ErrorNote live what={what} fix={fix} detail={detail} />;
}

function CvProgress({ busy }: { busy: CvBusy }) {
  if (!busy) return null;
  return (
    <p className="jd-hint" role="status">
      {busy === 'refine'
        ? 'Claude is choosing what to change, then the CV builds again…'
        : busy === 'suggest'
          ? 'Claude is writing suggestions. Waypoint checks each one against your profile…'
          : 'Waypoint is tailoring the CV and building the PDF. A first build can take a minute.'}
    </p>
  );
}

function DriveLink({ cv, setToast }: { cv: Cv; setToast: (s: string) => void }) {
  if (!cv.driveUrl) return cv.driveReason ? <p className="jd-hint">{cv.driveReason}. The PDF is ready to attach by hand.</p> : null;
  return (
    <div className="jd-drive">
      <a href={cv.driveUrl} target="_blank" rel="noopener noreferrer">CV on Drive</a>
      <Button
        variant="link"
        confirm="Copied"
        onClick={async () => {
          if (!(await copyText(cv.driveUrl!))) setToast('The browser blocked the clipboard. Copy the link by hand.');
        }}
      >
        Copy link
      </Button>
      <p className="jd-hint">The referral message links this same file, so a rebuild updates what they see.</p>
    </div>
  );
}

/** Says what the build did, because an untailored CV looks the same as a tailored one until someone reads it. */
function CvSummary({ cv }: { cv: Cv }) {
  if (cv.tailored === undefined) return cv.lead ? <p className="jd-line">Leads with {cv.lead}.</p> : null;
  if (!cv.tailored) {
    const reason = cv.reason && !cv.reason.startsWith(COMPILE_FAILED) ? `: ${cv.reason}` : '';
    return <p className="jd-line jd-warn">This is the base CV, not tailored{reason}.</p>;
  }
  return (
    <div className="jd-stack jd-tight">
      {cv.lead && <p className="jd-line">Leads with <strong>{cv.lead}</strong>.</p>}
      {!!cv.projects?.length && <p className="jd-line jd-soft">Projects: {cv.projects.join(', ')}</p>}
      {!!cv.skills?.length && <p className="jd-line jd-soft">Skills up front: {cv.skills.join(', ')}</p>}
    </div>
  );
}

function RefineCv({ d, cv }: { d: JobDetailState; cv: Cv }) {
  const [draft, setDraft] = useState('');
  const turns = cv.chat.filter((t) => t.role === 'you').length;
  const send = async () => {
    const m = draft.trim();
    if (!m || d.cvBusy) return;
    if (await d.refine(m)) setDraft('');
  };
  return (
    <div className="jd-block">
      <h3>Refine with Claude{turns ? `, ${turns} ${turns === 1 ? 'change' : 'changes'}` : ''}</h3>
      <p className="jd-hint">Claude only reorders and chooses between entries that are already in your CV and claims. It never writes new lines. Each change builds the PDF again.</p>
      {cv.chat.map((t, i) => (
        <p key={i} className={`jd-turn jd-turn-${t.role}`}>{t.text}</p>
      ))}
      <Field label="What to change">
        {(c) => (
          <textarea
            {...c}
            value={draft}
            placeholder="For example: lead with the ROS 2 work and drop the hackathon"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          />
        )}
      </Field>
      <div className="jd-actions">
        <Button busy={d.cvBusy === 'refine'} disabled={!!d.cvBusy || !draft.trim()} onClick={send}>
          {d.cvBusy === 'refine' ? 'Refining…' : 'Send'}
        </Button>
        {turns > 0 && (
          <Button variant="link" busy={d.cvBusy === 'reset'} disabled={!!d.cvBusy} onClick={d.reset}>
            Start over from the posting
          </Button>
        )}
      </div>
    </div>
  );
}

/** The keyword report, then the wording suggestions. The user decides on each suggestion. */
function SuggestWording({ d }: { d: JobDetailState }) {
  const { items, dropped } = (d.wording ?? EMPTY_WORDING).suggestions;
  const { inResume, missingWithEvidence } = (d.wording ?? EMPTY_WORDING).keywords;
  return (
    <div className="jd-block">
      <h3>Wording</h3>
      {(inResume.length > 0 || missingWithEvidence.length > 0) && (
        <div className="jd-stack jd-tight">
          {inResume.length > 0 && <p className="jd-line">Words of the posting that your CV has: <strong>{inResume.join(', ')}</strong>.</p>}
          {missingWithEvidence.length > 0 && (
            <p className="jd-line jd-warn">Words of the posting that your profile proves, but your CV does not show: <strong>{missingWithEvidence.join(', ')}</strong>.</p>
          )}
        </div>
      )}
      <div className="jd-actions">
        <Button busy={d.cvBusy === 'suggest'} disabled={!!d.cvBusy || !!d.claudeNote} aria-describedby={d.claudeNote ? 'jd-suggest-note' : undefined} onClick={d.suggest}>
          {d.cvBusy === 'suggest' ? 'Looking for wording…' : 'Suggest wording'}
        </Button>
        <p className="jd-hint jd-grow" id={d.claudeNote ? 'jd-suggest-note' : undefined}>
          {d.claudeNote ?? 'Claude proposes new words for your bullets. Waypoint checks each one against your profile. Nothing changes until you accept it.'}
        </p>
      </div>
      {dropped > 0 && (
        <p className="jd-hint">Waypoint dropped {dropped} {dropped === 1 ? 'suggestion' : 'suggestions'}, because the text had a number, a name or a tool that your profile does not show.</p>
      )}
      {items.map((s) => (
        <div key={s.bulletId} className="jd-suggestion">
          <p className="jd-hint" style={s.status === 'accepted' ? { textDecoration: 'line-through' } : undefined}>Old: {s.old}</p>
          <p className="jd-line">New: {s.text}</p>
          {s.labels.length > 0 && <p className="jd-hint">Backed by: {s.labels.join(', ')}</p>}
          {s.status === 'pending' ? (
            <div className="jd-actions">
              <Button variant="go" disabled={!!d.cvBusy} onClick={() => d.decide(s.bulletId, 'accept')}>Accept</Button>
              <Button disabled={!!d.cvBusy} onClick={() => d.decide(s.bulletId, 'reject')}>Reject</Button>
            </div>
          ) : (
            <p className="jd-line"><strong>{s.status === 'accepted' ? 'Accepted. The CV uses the new text.' : 'Rejected.'}</strong></p>
          )}
        </div>
      ))}
    </div>
  );
}

/** "Your CV for this role": build it, see it, refine it. */
export function CvSection({ d, onPart, onBack }: { d: JobDetailState; onPart: (p: Part) => void; onBack: () => void }) {
  const { job, cv } = d;
  const compileFailed = !!cv?.reason?.startsWith(COMPILE_FAILED);
  const root = useRef<HTMLElement>(null);
  return (
    <section className="jd-cv" ref={root}>
      <PartBack label="Your CV for this role" onBack={onBack} />
      <Fold title="Your CV for this role" status={cvStatus(job, cv)} onOpen={() => onPart('cv')} onToggle={(open) => open && showSection(root.current)}>
        <div className="jd-stack">
          <div className="jd-actions">
            <Button variant={cv ? 'plain' : 'go'} busy={d.cvBusy === 'generate'} disabled={!!d.cvBusy} onClick={d.generate}>
              {d.cvBusy === 'generate' ? 'Building…' : cv ? 'Rebuild CV' : 'Build CV'}
            </Button>
            {cv && (
              <>
                <a className="btn" href={cv.pdfUrl} target="_blank" rel="noopener noreferrer">Open</a>
                <a className="btn" href={cv.pdfUrl} download>Download</a>
              </>
            )}
          </div>
          <CvProgress busy={d.cvBusy} />
          {d.cvError ? <CvError message={d.cvError} /> : compileFailed ? <CvError message={cv!.reason!.slice(COMPILE_FAILED.length).replace(/^:\s*/, '')} /> : null}

          {cv && (
            <>
              <PdfPreview url={cv.pdfUrl} rev={d.cvRev} />
              <DriveLink cv={cv} setToast={d.setToast} />
              <CvSummary cv={cv} />
              <RefineCv d={d} cv={cv} />
            </>
          )}
          {(cv || d.wording) && <SuggestWording d={d} />}

          <div className="jd-block">
            <h3>Must be on it</h3>
            <ul className="jd-must">
              {job.must.map((m, i) => <li key={`${i}-${m}`}>{m}</li>)}
              {job.must.length === 0 && <li>Nothing yet. Claude has not read this posting.</li>}
            </ul>
          </div>
          <div className="jd-block">
            <h3>Projects to lead with</h3>
            <ol className="jd-projects">
              {job.projects.map((p) => (
                <li key={p.rank}><strong>{p.n}</strong><span>{p.why}</span></li>
              ))}
              {job.projects.length === 0 && <li><span>No project matches this posting yet.</span></li>}
            </ol>
          </div>
        </div>
      </Fold>
    </section>
  );
}

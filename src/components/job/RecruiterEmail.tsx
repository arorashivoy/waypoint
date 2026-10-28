'use client';

import { useState } from 'react';
import { copyText } from '../api';
import { Button, Field } from '../ui';
import { gmailCompose } from './gmail';
import type { ColdEmail, JobDetailState } from './types';

/** The email that waits for the approval of the user. Nothing leaves Waypoint: Approve opens Gmail, and the user presses Send there. */
function Email({ d, draft }: { d: JobDetailState; draft: ColdEmail }) {
  const [email, setEmail] = useState(draft.email);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copyFailed, setCopyFailed] = useState(false);
  const first = draft.name.split(' ')[0];
  return (
    <div className="jd-stack">
      <p className="jd-hint">
        {draft.approved
          ? `You approved this email to ${first}. Gmail has it. If you closed the tab, open it again.`
          : `Read the email to ${first}. Change anything you want. Waypoint sends nothing until you approve, and then you press Send in Gmail.`}
      </p>
      <Field label="To">{(c) => <input {...c} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Field label="Subject">{(c) => <input {...c} value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
      <Field label="Email">{(c) => <textarea {...c} rows={12} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
      <div className="jd-actions">
        <Button variant={draft.approved ? 'plain' : 'go'} confirm="Approved" onClick={() => d.approveEmail({ email, subject, body })}>
          {draft.approved ? 'Approve again and open Gmail' : 'Approve and open Gmail'}
        </Button>
        {draft.approved && (
          <a className="btn" href={gmailCompose({ email, subject, body })} target="_blank" rel="noopener noreferrer">Open in Gmail</a>
        )}
        <Button confirm="Copied" onClick={async () => {
          const ok = await copyText(body);
          setCopyFailed(!ok);
          if (!ok) throw new Error('clipboard');
        }}>Copy email</Button>
        <Button busy={d.busy === 'email'} onClick={() => d.draftEmail(email)}>
          {d.busy === 'email' ? 'Drafting the email…' : 'Draft it again'}
        </Button>
      </div>
      {copyFailed && <p className="jd-hint">The browser blocked the clipboard. Select the text and copy it.</p>}
    </div>
  );
}

/**
 * Find the email of a recruiter at the company, then draft a cold email to them.
 * It shows for every job, also after the job is marked as applied.
 */
export function RecruiterEmail({ d }: { d: JobDetailState }) {
  const { job, busy } = d;
  const { recruiter, coldEmail } = job;
  const [email, setEmail] = useState(recruiter?.email ?? '');
  return (
    <div className="jd-stack">
      <strong>Email a recruiter at {job.company}</strong>
      {!recruiter ? (
        <>
          <p className="jd-hint">Waypoint searches Hunter.io for a recruiter or HR person at {job.company}. A search costs one of your Hunter searches.</p>
          <div className="jd-actions">
            <Button busy={busy === 'recruiter'} onClick={d.findRecruiter}>
              {busy === 'recruiter' ? 'Searching Hunter.io…' : 'Find the recruiter’s email'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="jd-contact">
            <span className="jd-avatar" aria-hidden="true">{recruiter.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{recruiter.name}</strong>
              <span>{recruiter.email}</span>
              {recruiter.why && <span className="jd-why">{recruiter.why}</span>}
            </div>
          </div>
          {!coldEmail && (
            <>
              <Field label="Send the email to" hint="Hunter.io guessed some addresses. Check this one.">
                {(c) => <input {...c} type="email" value={email || recruiter.email} onChange={(e) => setEmail(e.target.value)} />}
              </Field>
              <div className="jd-actions">
                <Button variant="go" busy={busy === 'email'} onClick={() => d.draftEmail(email || recruiter.email)}>
                  {busy === 'email' ? 'Drafting the email and your CV…' : 'Draft a cold email'}
                </Button>
                <Button busy={busy === 'recruiter'} onClick={d.findRecruiter}>Search again</Button>
              </div>
            </>
          )}
        </>
      )}
      {coldEmail && <Email key={coldEmail.id} d={d} draft={coldEmail} />}
    </div>
  );
}

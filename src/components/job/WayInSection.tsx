'use client';

import { useRef, useState } from 'react';
import { copyText } from '../api';
import { Button, ErrorNote, Field, Fold, WayIn } from '../ui';
import { PartBack } from './PartBack';
import { showSection } from './scroll';
import type { JobDetailState, Part } from './types';

/** LinkedIn's cap on a connection note. The server drafts within it; the counter is for edits made here. */
export const NOTE_LIMIT = 300;

export function wayInStatus(job: JobDetailState['job']): string {
  const best = job.routes.find((r) => r.best) ?? job.routes[0];
  return best ? `${best.name} can refer you` : `No contact at ${job.company} yet`;
}

/**
 * Waypoint cannot search LinkedIn, so the search is a link and the choice of
 * person is the user's. The guide is what it would rank on if it could.
 */
function AlumniAsk({ d }: { d: JobDetailState }) {
  const { job, busy } = d;
  const alumni = job.alumni!;
  return (
    <div className="jd-stack">
      <div className="jd-guide">
        <strong>Whom to pick from the results</strong>
        <ol>
          <li>A recruiter, HR or talent-acquisition person: routing referrals is their job, and they are paid to answer.</li>
          <li>Otherwise the most senior engineer in this role’s team or field.</li>
          <li>Otherwise anyone from your own programme.</li>
          <li>Among equals, someone who lists {job.city || 'the job’s city'} or its country.</li>
        </ol>
      </div>
      <p className="jd-hint">
        They are not connections, so this drafts a {NOTE_LIMIT}-character connection note. There is no room for your CV link. The referral message with it comes once they accept.
      </p>
      <Button variant="go" busy={busy === 'alumni'} onClick={d.findAlumni}>
        {busy === 'alumni' ? 'Drafting the connection note…' : `Find ${alumni.school} alumni at ${job.company}`}
      </Button>
    </div>
  );
}

/** The drafted message, editable. A connection note to an alumnus has the LinkedIn limit; a referral message has none. */
function Draft({ d }: { d: JobDetailState }) {
  const { job, blocked } = d;
  const referral = job.referral!;
  const note = !!referral.alumni;
  const [text, setText] = useState(referral.copy);
  const [blockedCopy, setBlockedCopy] = useState(false);
  const over = note && text.length > NOTE_LIMIT;
  const first = referral.name.split(' ')[0];
  return (
    <div className="jd-stack">
      <p className="jd-hint">
        {note
          ? `Connection note for ${referral.name}. Pick one person, press Connect, then Add a note, and paste. This job is in Pending. When they accept, press "They accepted" there for the referral message with your CV.`
          : `Referral message for ${referral.name}. This job is in Pending. When they reply, paste it there.`}
      </p>
      <Field label={note ? 'Connection note' : 'Message'} hint={note && !over ? `${text.length} of ${NOTE_LIMIT} characters` : undefined} error={over ? `${text.length} of ${NOTE_LIMIT} characters. LinkedIn will reject this note.` : undefined}>
        {(c) => <textarea {...c} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <div className="jd-actions">
        <Button confirm="Copied" onClick={async () => {
          const ok = await copyText(text);
          setBlockedCopy(!ok);
          if (!ok) throw new Error('clipboard');
        }}>{note ? 'Copy note' : 'Copy message'}</Button>
        {referral.open && (
          <a className={`btn${blocked ? ' go' : ''}`} href={referral.open} target="_blank" rel="noopener noreferrer">
            {note ? 'Open alumni search' : `Open ${first}'s profile`}
          </a>
        )}
      </div>
      {blockedCopy && <p className="jd-hint">The browser blocked the clipboard. Select the text and copy it.</p>}
    </div>
  );
}

/** "Your way in": who can refer the user, and the message to send. */
export function WayInSection({ d, open = false, onPart, onBack }: { d: JobDetailState; open?: boolean; onPart: (p: Part) => void; onBack: () => void }) {
  const { job } = d;
  const best = job.routes.find((r) => r.best) ?? job.routes[0] ?? null;
  const others = job.routes.filter((r) => r !== best);
  const root = useRef<HTMLElement>(null);
  return (
    <section className="jd-wayin" ref={root}>
      <PartBack label="Your way in" onBack={onBack} />
      <Fold title="Your way in" status={wayInStatus(job)} forceOpen={open} onOpen={() => onPart('wayin')} onToggle={(open) => open && showSection(root.current)}>
        <div className="jd-stack">
          {best && <WayIn contact={best.name} company={job.company} />}
          {job.routes.length === 0 && (
            <p className="jd-empty">
              No 1st-degree connection at {job.company} in your imported export. Add a fresh LinkedIn export in Profile, under Imports
              {job.alumni ? `, or ask a ${job.alumni.school} alumnus there with a connection note.` : '.'}
            </p>
          )}
          {best && (
            <div className="jd-contact">
              <span className="jd-avatar" aria-hidden="true">{best.init}</span>
              <div>
                <strong>{best.name}</strong>
                <span>{best.role}</span>
                <span className="jd-why">{best.why}</span>
              </div>
            </div>
          )}
          {others.length > 0 && (
            <ul className="jd-others">
              {others.map((c) => (
                <li key={c.name}><strong>{c.name}</strong> <span>{c.role}. {c.why}</span></li>
              ))}
            </ul>
          )}

          {job.referral ? (
            <Draft key={`${job.id}-${job.referral.copy.length}-${job.referral.alumni ? 'a' : 'r'}`} d={d} />
          ) : !best && job.alumni ? (
            <AlumniAsk d={d} />
          ) : best ? (
            <div className="jd-stack">
              <Button variant="go" busy={d.busy === 'send'} onClick={d.findContact}>
                {d.busy === 'send' ? 'Drafting the referral and your CV…' : 'Draft the request'}
              </Button>
              <p className="jd-hint">This drafts a message to {best.name} and builds your CV. It copies the message and opens their profile. You send it there.</p>
            </div>
          ) : null}
          {d.wayError && <ErrorNote live what="The request did not work." fix={d.wayError} />}
        </div>
      </Fold>
    </section>
  );
}

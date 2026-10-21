import { useEffect, useRef } from 'react';
import { ScoreRing } from '../ui';
import { PHONE_QUERY } from '../jobs/focus';
import { ago } from '@/lib/time-ago';
import type { JobView } from './types';

/** The posting date as "Posted 3 days ago". The browser works it out, so the markup of the server never holds a relative time. */
export function postedLine(postedAt: string, now = Date.now()): string {
  const text = ago(postedAt, now);
  return `Posted ${text}`;
}

/** Role, company, place, the score ring and a link to the posting. On a phone the top row holds "‹ Jobs" and "Open posting". */
export function JobHeader({ job, onBack }: { job: JobView; onBack: () => void }) {
  const where = [job.company, job.city, job.mode.toLowerCase()].filter(Boolean).join(', ');
  // The visa note is a sentence of its own ("Sponsorship not stated"), not a part of the place.
  // A job is a full screen on a phone. Focus goes to its heading, so a keyboard or a screen reader starts at the job.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (window.matchMedia(PHONE_QUERY).matches) heading.current?.focus({ preventScroll: true });
  }, []);
  const visa = job.visa ? ` ${job.visa.replace(/\.$/, '')}.` : '';
  return (
    <header className="jd-header">
      <div className="jd-top">
        <button type="button" className="sh-back" onClick={onBack}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Jobs
        </button>
        <a className="btn link" href={job.url} target="_blank" rel="noopener noreferrer">Open posting</a>
      </div>
      <div className="jd-title">
        <h2 ref={heading} tabIndex={-1}>{job.role}</h2>
        <p className="jd-where">{where}.{visa} {postedLine(job.postedAt)}.</p>
      </div>
      <div className="jd-ring" key={job.id}>
        <ScoreRing score={job.match} />
      </div>
    </header>
  );
}

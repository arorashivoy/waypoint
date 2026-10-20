import { ScoreRing } from '../ui';
import { ago } from '@/lib/time-ago';
import type { JobView } from './types';

/** The posting date as "Posted 3 days ago". The browser works it out, so the markup of the server never holds a relative time. */
export function postedLine(postedAt: string, now = Date.now()): string {
  const text = ago(postedAt, now);
  return `Posted ${text}`;
}

/** Role, company, place, the score ring and a link to the posting. On a phone the top row holds "‹ Jobs" and "Open posting". */
export function JobHeader({ job, onBack }: { job: JobView; onBack: () => void }) {
  const where = [job.company, job.city, job.mode.toLowerCase(), job.visa].filter(Boolean).join(', ');
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
        <h2>{job.role}</h2>
        <p className="jd-where">{where}. {postedLine(job.postedAt)}.</p>
      </div>
      <div className="jd-ring" key={job.id}>
        <ScoreRing score={job.match} />
      </div>
    </header>
  );
}

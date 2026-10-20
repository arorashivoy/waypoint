'use client';

import { useState } from 'react';
import { BLOCKER_LABEL, legitimacyLine } from '@/lib/jobcheck-text';
import { Button, Fold, Route, type RouteItem } from '../ui';
import { topRequirements } from './requirements';
import type { JobView, Requirement } from './types';

const toItem = (r: Requirement): RouteItem => ({ status: r.status, label: r.text, evidence: r.evidence.length ? r.evidence.join(', ') : undefined });

/** The summary, the blockers, the posting warnings, the top requirements on the route, and how the score was made. */
export function FitSection({ job }: { job: JobView }) {
  const [all, setAll] = useState(false);
  const top = topRequirements(job.requirements);
  const shown = all ? job.requirements : top;
  const flags = legitimacyLine(job.legitimacy);
  const rest = job.requirements.length - top.length;
  return (
    <section className="jd-fit" aria-label="How well you fit">
      {job.analysing && <p className="jd-reading" role="status"><span className="ui-task-dot" aria-hidden="true" />Claude is reading the description…</p>}
      {job.summary && <p className="jd-summary">{job.summary}</p>}

      {job.blockers.length > 0 && (
        <div className="jd-blockers">
          <strong>{job.blockers.length === 1 ? 'This posting has a blocker.' : `This posting has ${job.blockers.length} blockers.`}</strong>
          <ul>
            {job.blockers.map((b, i) => (
              <li key={`${i}-${b.type}`}>
                <span>{BLOCKER_LABEL[b.type] ?? b.type}</span>
                <q>{b.quote}</q>
              </li>
            ))}
          </ul>
        </div>
      )}
      {job.warning && <p className="jd-note jd-note-warn">{job.warning}</p>}
      {flags && <p className="jd-note jd-note-warn">{flags}</p>}

      {shown.length > 0 && <Route items={shown.map(toItem)} />}
      {rest > 0 && (
        <Button variant="link" className="jd-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Show fewer requirements' : `Show all ${job.requirements.length} requirements`}
        </Button>
      )}

      <Fold title="How this score was made" status={job.by === 'claude' ? `${job.match} points from ${job.parts.length} parts` : 'Estimated without Claude'}>
        <ul className="jd-parts">
          {job.parts.map((p, i) => (
            <li key={`${i}-${p.label}`}>
              <span>{p.label}</span>
              <b>{p.points > 0 ? '+' : ''}{p.points}</b>
            </li>
          ))}
          {job.parts.length === 0 && <li><span>No parts to show yet.</span></li>}
        </ul>
      </Fold>
    </section>
  );
}

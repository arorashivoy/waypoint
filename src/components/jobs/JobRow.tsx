import { ScorePill } from '../ui';
import { rowLabel, rowLine, type ListJob } from './filters';

export type JobRowData = ListJob & { provisional: boolean };

interface Props {
  job: JobRowData;
  selected: boolean;
  onOpen: (id: string) => void;
  /** Position in the first load. Only the first rows rise in. */
  riseIndex?: number;
}

/** One calm row: role, company and city, the score, and a 4th line only for a referral or a blocker. */
export default function JobRow({ job, selected, onOpen, riseIndex }: Props) {
  const line = rowLine(job);
  const rise = riseIndex !== undefined && riseIndex < 8;
  return (
    <button
      type="button"
      className={`jr${rise ? ' jr-rise' : ''}`}
      data-job-id={job.id}
      data-on={selected}
      aria-current={selected ? 'true' : undefined}
      aria-label={rowLabel(job)}
      style={rise ? ({ '--d': `${riseIndex * 50}ms` } as React.CSSProperties) : undefined}
      onClick={() => onOpen(job.id)}
    >
      <span className="jr-role">{job.role}</span>
      <span className="jr-score" aria-hidden="true">
        <ScorePill score={job.match} />
        {job.provisional && <small>est.</small>}
      </span>
      <span className="jr-co">{[job.company, job.city].filter(Boolean).join(', ')}</span>
      {line && <span className={`jr-line jr-${line.kind}`}>{line.text}</span>}
    </button>
  );
}

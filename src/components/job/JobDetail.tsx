'use client';

import type { Me } from '../data';
import { Button, ErrorNote, Skeleton } from '../ui';
import { JobBody } from './JobBody';
import { useJobDetail } from './useJobDetail';
import { usePart } from './usePart';

interface Props {
  id: string;
  claude: Me['claude'];
  refresh: () => Promise<unknown>;
  setToast: (s: string) => void;
  onClose: () => void;
}

/** One open job: loads it, then shows the sections. */
export default function JobDetail({ id, claude, refresh, setToast, onClose }: Props) {
  const { state, error, retry } = useJobDetail(id, { claude, refresh, setToast });
  const [part, setPart] = usePart(id);

  if (!state) {
    return (
      <div className="jd">
        <div className="jd-scroll">
          <div className="jd-header">
            <div className="jd-top">
              <button type="button" className="sh-back" onClick={onClose}>Jobs</button>
            </div>
          </div>
          <div className="jd-main">
            {error ? (
              <ErrorNote live what="Waypoint could not open this job." fix={`${error} Check your connection, then try again.`} onRetry={retry} />
            ) : (
              <>
                <p className="jd-hint" role="status">Opening the job…</p>
                <Skeleton rows={3} />
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <JobBody d={state} part={part} onPart={setPart} onClose={onClose} />;
}

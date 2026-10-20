'use client';

import { useEffect, useState } from 'react';
import { Sheet } from './ui';
import type { JobCard, Me } from './data';
import JobDetail from './job/JobDetail';
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
  const detail = (id: string) => <JobDetail key={id} id={id} claude={me.claude} refresh={refresh} setToast={setToast} onClose={closeJob} />;

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

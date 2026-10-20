'use client';

import { ErrorNote, Skeleton } from '../ui';
import JobsScreen from '../JobsScreen';
import PendingScreen from '../pending/PendingScreen';
import { useJobs, usePending, type Me } from '../data';

type Common = { me: Me; refresh: () => Promise<any>; setToast: (s: string) => void };

/** What a screen shows while its data loads, and when the load fails. */
export function Wait({ error, onRetry }: { error?: Error; onRetry: () => void }) {
  return error ? (
    <div className="sh-banner">
      <ErrorNote live what="Waypoint could not load this screen." fix={`${error.message} Check your connection, then try again.`} onRetry={onRetry} />
    </div>
  ) : (
    <Skeleton rows={4} />
  );
}

/** Jobs, with its own data. The list shows its own loading and error state, so the title stays on screen. */
export function JobsView({ me, refresh, setToast, openJob, closeJob, selected, goToSettings }: Common & { openJob: (id: string) => void; closeJob: () => void; selected: string | null; goToSettings: () => void }) {
  const { data, error, mutate } = useJobs();
  return (
    <JobsScreen me={me} jobs={data?.jobs} error={error} onRetry={() => { mutate(); }} refresh={refresh} setToast={setToast} openJob={openJob} closeJob={closeJob} selected={selected} goToSettings={goToSettings} />
  );
}

export function PendingView({ refresh, setToast, onJobs }: Omit<Common, 'me'> & { onJobs: () => void }) {
  const { data, error, mutate } = usePending();
  return <PendingScreen data={data} error={error} onRetry={() => { mutate(); }} refresh={refresh} setToast={setToast} onJobs={onJobs} />;
}

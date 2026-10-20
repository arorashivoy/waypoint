'use client';

import { useMemo } from 'react';
import { ErrorNote, Skeleton } from '../ui';
import JobsScreen from '../JobsScreen';
import PendingScreen from '../PendingScreen';
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

/** Jobs, with its own data. The screen gets the same props that it got from the old state route. */
export function JobsView({ me, refresh, setToast, openJob, selected, toggleCountry }: Common & { openJob: (id: string) => void; selected: string | null; toggleCountry: (cc: string, on: boolean) => void }) {
  const { data, error, mutate } = useJobs();
  const state = useMemo(() => data && { ...me, ...data }, [me, data]);
  if (!state) return <Wait error={error} onRetry={() => { mutate(); }} />;
  return <JobsScreen state={state} refresh={refresh} setToast={setToast} openJob={openJob} selected={selected} toggleCountry={toggleCountry} />;
}

export function PendingView({ me, refresh, setToast }: Common) {
  const { data, error, mutate } = usePending();
  const state = data && { ...me, ...data };
  if (!state) return <Wait error={error} onRetry={() => { mutate(); }} />;
  return <PendingScreen state={state} refresh={refresh} setToast={setToast} />;
}

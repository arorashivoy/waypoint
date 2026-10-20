'use client';

import { useEffect, useRef, useState } from 'react';
import { post } from '../api';
import type { Me } from '../data';
import { runTask } from '../tasks';
import { Button, ErrorNote, Skeleton } from '../ui';
import AddJobSheet from './AddJobSheet';
import FilterSheet from './FilterSheet';
import JobRow from './JobRow';
import JobsEmpty from './JobsEmpty';
import { useJobList } from './useJobList';

interface Props {
  me: Me;
  list: ReturnType<typeof useJobList>;
  loading: boolean;
  error?: Error;
  onRetry: () => void;
  refresh: () => Promise<unknown>;
  setToast: (s: string) => void;
  openJob: (id: string) => void;
  onSettings: () => void;
}

const REPORT_MS = 10_000;

type RefreshResult = { added: number; total: number; report: { source: string; error?: unknown }[]; analysing?: { total: number } | null; note?: string };

/** The list column: title, search, one Filters button, one plain line, the rows and the empty states. */
export default function JobList({ me, list, loading, error, onRetry, refresh, setToast, openJob, onSettings }: Props) {
  const { q, setQ, searchRef, filters, change, clear, filterCount, shown, cause, line, activeId, scrollPending } = list;
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reportTimer.current) clearTimeout(reportTimer.current); }, []);

  const doRefresh = async (force = false) => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await runTask<RefreshResult>(() => post<{ taskId: string }>('/api/jobs/refresh', { force }));
      await refresh();
      const failed = (res.report || []).filter((r) => r.error);
      const queued = res.analysing?.total || 0;
      setReport(
        res.note ??
          `${res.added} new, ${res.total} live in your countries.` +
            (queued ? ` Claude is reading the top ${queued}.` : '') +
            (failed.length ? ` ${failed.length} source${failed.length > 1 ? 's' : ''} failed: ${failed.map((r) => r.source).join(', ')}.` : ''),
      );
      if (reportTimer.current) clearTimeout(reportTimer.current);
      reportTimer.current = setTimeout(() => setReport(null), REPORT_MS);
    } catch (e) {
      setRefreshError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  // Only the rows of the first load rise in. They keep the class for a while so a reload of the data does not restart them.
  const risen = useRef(false);
  useEffect(() => {
    if (shown.length === 0 || risen.current) return;
    const t = setTimeout(() => { risen.current = true; }, 1200);
    return () => clearTimeout(t);
  }, [shown.length]);

  // The selected row stays in view when j and k move the selection. Not on the first load.
  useEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    if (activeId) document.querySelector(`[data-job-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeId, scrollPending]);

  return (
    <section className="jl" aria-label="Jobs">
      <div className="jl-head">
        <h1>Jobs</h1>
        <div className="jl-actions">
          <Button ref={addBtn} variant="link" onClick={() => setAddOpen(true)}>Add a job link</Button>
          <Button variant="link" busy={refreshing} onClick={() => doRefresh()}>{refreshing ? 'Fetching…' : 'Refresh'}</Button>
        </div>
      </div>

      <div className="jl-tools">
        <label className="sr-only" htmlFor="wp-search">Search jobs</label>
        <input
          id="wp-search"
          ref={searchRef}
          type="search"
          className="field jl-search"
          placeholder="Search role, company, city"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button ref={filterBtn} onClick={() => setFilterOpen(true)}>{filterCount ? `Filters (${filterCount})` : 'Filters'}</Button>
      </div>

      {!loading && !error && !cause && <p className="jl-line">{line}</p>}

      {report && (
        <p className="jl-line jl-report" role="status">
          {report}{' '}
          <button type="button" className="jl-linkish" onClick={() => doRefresh(true)} disabled={refreshing}>Fetch all boards again</button>
        </p>
      )}
      {refreshError && <ErrorNote live what="Waypoint could not refresh the jobs." fix={refreshError} onRetry={() => doRefresh()} />}

      {loading && <Skeleton rows={6} />}
      {error && !loading && <ErrorNote live what="Waypoint could not load the jobs." fix={`${error.message} Check your connection, then try again.`} onRetry={onRetry} />}

      {!loading && !error && cause && (
        <JobsEmpty cause={cause} onSettings={onSettings} onRefresh={() => doRefresh()} onClearFilters={clear} onClearSearch={() => setQ('')} />
      )}

      {shown.length > 0 && (
        <ul className="jl-rows">
          {shown.map((j, i) => (
            <li key={j.id}>
              <JobRow job={j} selected={j.id === activeId} onOpen={openJob} riseIndex={risen.current ? undefined : i} />
            </li>
          ))}
        </ul>
      )}

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        opener={filterBtn}
        filters={filters}
        levels={me.levels}
        count={shown.length}
        onChange={change}
        onClear={clear}
      />
      <AddJobSheet open={addOpen} onClose={() => setAddOpen(false)} opener={addBtn} refresh={refresh} openJob={openJob} setToast={setToast} />
    </section>
  );
}

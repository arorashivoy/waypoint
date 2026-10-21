'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { navAction, readLocation, writeLocation, type Location, type Place } from './nav';

const OPENED = { wpJob: true };
const KEY = 'wp-sidebar-collapsed';

/** The sidebar choice, kept in localStorage. Storage can fail, so every call has try/catch. */
export function useCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY) === '1');
    } catch {
      /* private window or blocked storage: keep the default */
    }
  }, []);
  const set = useCallback((value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem(KEY, value ? '1' : '0');
    } catch {
      /* the choice then lasts until the page closes */
    }
  }, []);
  return [collapsed, set] as const;
}

/**
 * The place and the open job live in the URL (?view=pending, ?job=<id>).
 * A reload or a rotation keeps them, and the Back button of the browser closes a job.
 */
export function useLocation() {
  const [loc, setLoc] = useState<Location>({ view: 'jobs', job: null });
  const scrollY = useRef(0);

  useEffect(() => {
    setLoc(readLocation(window.location.search));
    const onPop = () => setLoc(readLocation(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Keep the place in the list when a job opens and closes on a phone.
  const prevJob = useRef<string | null>(null);
  useEffect(() => {
    if (loc.job && !prevJob.current) window.scrollTo(0, 0);
    if (!loc.job && prevJob.current) window.scrollTo(0, scrollY.current);
    prevJob.current = loc.job;
  }, [loc.job]);

  /** Close the open job. Go back when the app pushed the entry. The state of an entry lives through a reload. */
  const closeJob = useCallback(() => {
    if (window.history.state?.wpJob) {
      window.history.back();
      return;
    }
    const next: Location = { view: 'jobs', job: null };
    window.history.replaceState(null, '', `${window.location.pathname}${writeLocation(next)}`);
    setLoc(next);
  }, []);

  const go = useCallback((view: Place) => {
    const action = navAction(loc, view);
    if (action === 'none') return;
    if (action === 'close-job') {
      closeJob();
      return;
    }
    const next: Location = { view, job: null };
    window.history.pushState(null, '', `${window.location.pathname}${writeLocation(next)}`);
    setLoc(next);
  }, [loc, closeJob]);

  const openJob = useCallback((id: string) => {
    scrollY.current = window.scrollY;
    const next: Location = { view: 'jobs', job: id };
    window.history.pushState(OPENED, '', `${window.location.pathname}${writeLocation(next)}`);
    setLoc(next);
  }, []);

  return { loc, go, openJob, closeJob };
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Part } from './types';

const readPart = (): Part | null => {
  const p = new URLSearchParams(window.location.search).get('part');
  return p === 'wayin' || p === 'cv' || p === 'answers' ? p : null;
};

/**
 * The part of the job that is open as its own screen on a phone: ?job=<id>&part=wayin.
 * A new entry in the history makes the Back button of the phone close the part.
 */
export function usePart(jobId: string) {
  const [part, setState] = useState<Part | null>(null);

  useEffect(() => {
    setState(readPart());
    const onPop = () => setState(readPart());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [jobId]);

  const setPart = useCallback((next: Part | null) => {
    const base = `${window.location.pathname}?job=${encodeURIComponent(jobId)}`;
    if (next) {
      window.history.pushState({ wpJob: true, wpPart: true }, '', `${base}&part=${next}`);
      setState(next);
      window.scrollTo(0, 0);
      return;
    }
    if (window.history.state?.wpPart) {
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, '', base);
    setState(null);
  }, [jobId]);

  return [part, setPart] as const;
}

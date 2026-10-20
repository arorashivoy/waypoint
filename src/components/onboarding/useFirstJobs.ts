'use client';

import { useCallback, useState } from 'react';
import { post } from '../api';
import { refreshLine, type RefreshResult } from '../jobs/refresh';
import { runTask } from '../tasks';

export type FirstJobs = { phase: 'idle' } | { phase: 'running' } | { phase: 'done'; line: string } | { phase: 'error'; message: string };

/** The first refresh of the job boards, with its state for the screen. */
export function useFirstJobs(reload: () => Promise<unknown>) {
  const [state, setState] = useState<FirstJobs>({ phase: 'idle' });
  const run = useCallback(async () => {
    setState({ phase: 'running' });
    try {
      const res = await runTask<RefreshResult>(() => post<{ taskId: string }>('/api/jobs/refresh', { force: false }));
      await reload();
      setState({ phase: 'done', line: refreshLine(res) });
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message });
    }
  }, [reload]);
  return [state, run] as const;
}

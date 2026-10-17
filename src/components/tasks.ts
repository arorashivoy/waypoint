import { ApiError, api } from './api';
import type { TaskView } from '@/lib/tasks/view';

export type { TaskView };

const DEFAULT_INTERVAL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
/** A phone on the tunnel often loses one poll. The wait stops only after this many failed polls in a row. */
export const MAX_POLL_ERRORS = 5;

/** A lost request or a server error can pass. A 4xx answer (for example 401 or 404) cannot. */
const canPass = (e: unknown) => !(e instanceof ApiError) || e.status >= 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Starts a task and waits for it. `start` calls a route that returns the task ID.
 * The helper asks for the status each `intervalMs` and uses `api()`, so a 401 goes to the login page.
 * The task keeps running if the time limit ends the wait.
 */
export async function runTask<T>(
  start: () => Promise<{ taskId: string }>,
  opts: { intervalMs?: number; timeoutMs?: number; onProgress?: (v: TaskView) => void } = {},
): Promise<T> {
  const { intervalMs = DEFAULT_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, onProgress } = opts;
  const { taskId } = await start();
  const deadline = Date.now() + timeoutMs;
  let errors = 0;
  for (;;) {
    let v: TaskView;
    try {
      v = await api<TaskView>(`/api/tasks/${encodeURIComponent(taskId)}`);
      errors = 0;
    } catch (e) {
      // The task runs on in the worker. Ask again, up to MAX_POLL_ERRORS failed polls in a row.
      if (!canPass(e) || ++errors > MAX_POLL_ERRORS) throw e;
      if (Date.now() + intervalMs > deadline) throw new Error('The task did not finish in time. It still runs; check again later.');
      await sleep(intervalMs);
      continue;
    }
    onProgress?.(v);
    if (v.status === 'done') return v.result as T;
    if (v.status === 'failed') throw new Error(v.error ?? 'The task failed.');
    if (Date.now() + intervalMs > deadline) throw new Error('The task did not finish in time. It still runs; check again later.');
    await sleep(intervalMs);
  }
}

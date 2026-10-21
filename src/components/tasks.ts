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

type Opts = { intervalMs?: number; timeoutMs?: number; onProgress?: (v: TaskView) => void };
const TIMED_OUT = 'The task did not finish in time. It still runs; check again later.';

/**
 * Starts a task and waits for it. `start` calls a route that returns the task ID.
 * The helper asks for the status each `intervalMs` and uses `api()`, so a 401 goes to the login page.
 * The last poll is at the time limit, not one interval before it. The task keeps running if the time limit ends the wait.
 * A caller that reads the result gives `parse`, which checks it (see task-results.ts). With no `parse` the result is `unknown`.
 */
export async function runTask(start: () => Promise<{ taskId: string }>, opts?: Opts): Promise<unknown>;
export async function runTask<T>(start: () => Promise<{ taskId: string }>, opts: Opts & { parse: (raw: unknown) => T }): Promise<T>;
export async function runTask<T>(
  start: () => Promise<{ taskId: string }>,
  opts: Opts & { parse?: (raw: unknown) => T } = {},
): Promise<T | unknown> {
  const { intervalMs = DEFAULT_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, onProgress, parse } = opts;
  const { taskId } = await start();
  const deadline = Date.now() + timeoutMs;
  /** Waits for the next poll. At the time limit there is no next poll. */
  const next = async () => {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(TIMED_OUT);
    await sleep(Math.min(intervalMs, left));
  };
  let errors = 0;
  for (;;) {
    let v: TaskView;
    try {
      v = await api<TaskView>(`/api/tasks/${encodeURIComponent(taskId)}`);
      errors = 0;
    } catch (e) {
      // The task runs on in the worker. Ask again, up to MAX_POLL_ERRORS failed polls in a row.
      if (!canPass(e) || ++errors > MAX_POLL_ERRORS) throw e;
      await next();
      continue;
    }
    onProgress?.(v);
    if (v.status === 'done') return parse ? parse(v.result) : v.result;
    if (v.status === 'failed') throw new Error(v.error ?? 'The task failed.');
    await next();
  }
}

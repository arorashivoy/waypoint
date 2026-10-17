import { api } from './api';
import type { TaskView } from '@/lib/tasks/view';

export type { TaskView };

const DEFAULT_INTERVAL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

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
  for (;;) {
    const v = await api<TaskView>(`/api/tasks/${encodeURIComponent(taskId)}`);
    onProgress?.(v);
    if (v.status === 'done') return v.result as T;
    if (v.status === 'failed') throw new Error(v.error ?? 'The task failed.');
    if (Date.now() + intervalMs > deadline) throw new Error('The task did not finish in time. It still runs; check again later.');
    await sleep(intervalMs);
  }
}

import { z } from 'zod';
import { db } from '@/lib/db';
import { analyseJob } from '@/lib/analysis';
import { claudeStatus, credentialFor } from '@/lib/claude';
import { TaskDeferred } from '@/lib/tasks/worker';
import type { TaskKind, TaskRow } from '@/lib/tasks/queue';

type Entry = {
  schema: z.ZodType<unknown>;
  run: (payload: unknown, task: TaskRow) => Promise<unknown>;
};

/** The handler of each kind of task. Later tasks add their handlers here. */
export const handlers = new Map<TaskKind, Entry>();

/** The worker checks the payload with `schema` before it calls `h`. The return value of `h` becomes `Task.result`. */
export function registerHandler<P>(
  kind: TaskKind,
  schema: z.ZodType<P>,
  h: (payload: P, task: TaskRow) => Promise<unknown>,
): void {
  handlers.set(kind, { schema, run: (payload, task) => h(payload as P, task) });
}

// Cache pruning is not built yet. Until it exists, maintenance does nothing.
registerHandler('maintenance', z.unknown(), async () => ({}));

registerHandler('analysis', z.object({ jobId: z.string(), batch: z.string() }), async ({ jobId }, task) => {
  const userId = task.userId;
  if (!userId) return { skipped: 'no-user' };
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return { skipped: 'gone' };
  if (!(await credentialFor(userId))) {
    const status = await claudeStatus(userId);
    if (status.capReached) {
      throw new TaskDeferred(new Date(status.resetsAt), 'The shared key reached the monthly cap.');
    }
    return { skipped: 'no-credential' };
  }
  await analyseJob(job, userId);
  return {};
});

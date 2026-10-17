import { z } from 'zod';
import { db } from '@/lib/db';
import { analyseJob } from '@/lib/analysis';
import { claudeStatus, credentialFor } from '@/lib/claude';
import { fetchAll } from '@/lib/sources';
import { queueAnalysis } from '@/lib/queue';
import { claimsFor } from '@/lib/user';
import { searchQueries } from '@/lib/resume';
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

registerHandler('refresh', z.object({ force: z.boolean() }), async ({ force }, task) => {
  const userId = task.userId;
  if (!userId) return { skipped: 'no-user' };
  // A user with no country on gets the paused note. No fetch and no analysis run.
  if (!(await db.countryPref.count({ where: { userId, on: true } }))) {
    return { added: 0, total: 0, report: [], analysing: null, note: 'Every country is paused.' };
  }
  // The feed cache is global and a board returns every country. So the refresh keeps the
  // countries of all active users, not only the countries of the user who started it.
  const prefs = await db.countryPref.findMany({ where: { on: true, user: { disabledAt: null } }, select: { cc: true } });
  const ccs = [...new Set(prefs.map((p) => p.cc))];
  if (!ccs.length) return { added: 0, total: 0, report: [], analysing: null, note: 'Every country is paused.' };

  const { jobs, report, commit } = await fetchAll(ccs, searchQueries(await claimsFor(userId)), { force });

  const known = new Set(
    (await db.job.findMany({ where: { externalId: { in: jobs.map((j) => j.externalId) } }, select: { externalId: true } }))
      .map((j) => j.externalId),
  );
  for (const j of jobs) {
    await db.job.upsert({
      where: { externalId: j.externalId },
      // An undated listing keeps the date it was first seen rather than being
      // re-stamped today on every refresh.
      update: { fetchedAt: new Date(), ...(j.postedAt && { postedAt: j.postedAt }), description: j.description, url: j.url, priority: j.priority },
      create: { ...j, postedAt: j.postedAt ?? new Date() },
    });
  }
  const added = jobs.filter((j) => !known.has(j.externalId)).length;
  // The jobs are stored. Only now the boards get the new etag and date.
  await commit();

  // The analysis tasks run in the worker after this task. The client polls /api/state for progress.
  const analysing = await queueAnalysis(userId);

  return { added, total: jobs.length, report, analysing };
});

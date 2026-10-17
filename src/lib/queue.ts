import { randomUUID } from 'node:crypto';
import { db } from './db';
import { makeJobViewer, MAX_ANALYSIS_TRIES } from './analysis';
import { credentialFor } from './claude';
import { enqueue } from './tasks/queue';

/**
 * A refresh brings in several hundred listings. Reading every one with Claude
 * would take hours, and reading none leaves the list ranked by keyword guesses.
 * So the highest-scoring unread listings are queued, one `analysis` task for
 * each. The worker runs the tasks one at a time while the user browses. Each
 * task that finishes replaces its estimate with a real score on the next state poll.
 *
 * Each call of `queueAnalysis` makes a new batch. The progress counts the
 * tasks of the latest batch of the user.
 */
export type Progress = { running: boolean; done: number; total: number; failed: number };

const EMPTY: Progress = { running: false, done: 0, total: 0, failed: 0 };

export async function analysisProgress(userId: string): Promise<Progress> {
  // Only the tasks of a refresh have a batch. A task that the job screen queues has none.
  const newest = await db.task.findFirst({
    where: { userId, kind: 'analysis', payload: { contains: '"batch":' } },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });
  if (!newest) return { ...EMPTY };
  let batch: unknown;
  try {
    batch = (JSON.parse(newest.payload) as { batch?: unknown }).batch;
  } catch {
    return { ...EMPTY };
  }
  if (typeof batch !== 'string') return { ...EMPTY };
  const rows = await db.task.findMany({
    where: { userId, kind: 'analysis', payload: { contains: batch } },
    select: { status: true, payload: true },
  });
  const tasks = rows.filter((r) => {
    try {
      return (JSON.parse(r.payload) as { batch?: unknown }).batch === batch;
    } catch {
      return false;
    }
  });
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const done = tasks.filter((t) => t.status === 'done').length + failed;
  const running = tasks.some((t) => t.status === 'queued' || t.status === 'running');
  return { running, done, total: tasks.length, failed };
}

export async function queueAnalysis(userId: string, limit = 25) {
  if (!(await credentialFor(userId))) return analysisProgress(userId);

  const onCcs = (await db.countryPref.findMany({ where: { userId, on: true } })).map((p) => p.cc);
  // `analysedAt`, not the existence of a `JobAnalysis` row: a job whose call
  // failed still has a heuristic stored in its row, and filtering on that would retire it permanently
  // after one bad minute. The try counter is what stops the retry being endless.
  const candidates = await db.job.findMany({
    where: {
      cc: { in: onCcs },
      analyses: { none: { userId, OR: [{ analysedAt: { not: null } }, { tries: { gte: MAX_ANALYSIS_TRIES } }] } },
    },
    orderBy: { postedAt: 'desc' },
    take: 400,
  });

  const view = await makeJobViewer(userId);
  const queue = candidates
    .map((job) => ({ job, ...view(job) }))
    // Postings that are not software roles at all never earn a Claude call.
    .filter((x) => x.analysis.field !== 'Other')
    // Priority companies are read first, so their scores are real before the
    // rest of the queue is touched.
    .sort((a, b) => Number(b.job.priority) - Number(a.job.priority) || b.match - a.match)
    .slice(0, limit)
    .map((x) => x.job);

  // A job with an open task is not added again, and it does not count in the new batch.
  const batch = randomUUID();
  for (const job of queue) {
    await enqueue({
      kind: 'analysis',
      userId,
      payload: { jobId: job.id, batch },
      dedupeKey: `analysis:${userId}:${job.id}`,
    });
  }
  return analysisProgress(userId);
}

/**
 * Queues one `analysis` task for one job, for the job screen. It has no batch, so the
 * progress of a refresh does not count it. The dedupe key is the same as in `queueAnalysis`,
 * so a job that a refresh queued already gets no second task.
 */
export async function queueJobAnalysis(userId: string, jobId: string, force = false): Promise<string> {
  const { id } = await enqueue({
    kind: 'analysis',
    userId,
    payload: force ? { jobId, force } : { jobId },
    dedupeKey: `analysis:${userId}:${jobId}`,
  });
  return id;
}

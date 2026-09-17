import { db } from './db';
import { analyseJob, makeJobViewer } from './analysis';
import { detectMode } from './claude';

/**
 * A refresh brings in several hundred listings. Reading every one with Claude
 * would take hours, and reading none leaves the list ranked by keyword guesses.
 * So the highest-scoring unread listings are queued and worked through in the
 * background while the user browses; each one that finishes replaces its
 * estimate with a real score on the next state poll.
 *
 * In-process on purpose: this is a single-user app on one machine. A hosted
 * version would move this to the scheduled worker the brief describes.
 */
type Progress = { running: boolean; done: number; total: number; failed: number };

const progress = new Map<string, Progress>();
const CONCURRENCY = 2;

export function analysisProgress(userId: string): Progress {
  return progress.get(userId) || { running: false, done: 0, total: 0, failed: 0 };
}

export async function queueAnalysis(userId: string, limit = 25) {
  if (progress.get(userId)?.running) return analysisProgress(userId);
  if ((await detectMode()).mode === 'none') return analysisProgress(userId);

  const onCcs = (await db.countryPref.findMany({ where: { userId, on: true } })).map((p) => p.cc);
  const candidates = await db.job.findMany({
    where: { cc: { in: onCcs }, analysis: null },
    orderBy: { postedAt: 'desc' },
    take: 400,
  });

  const view = await makeJobViewer(userId);
  const queue = candidates
    .map((job) => ({ job, ...view(job) }))
    // Postings that are not software roles at all never earn a Claude call.
    .filter((x) => x.analysis.field !== 'Other')
    .sort((a, b) => b.match - a.match)
    .slice(0, limit)
    .map((x) => x.job);

  const state: Progress = { running: queue.length > 0, done: 0, total: queue.length, failed: 0 };
  progress.set(userId, state);
  if (!queue.length) return state;

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      try {
        await analyseJob(job, userId);
      } catch {
        state.failed++;
      }
      state.done++;
    }
  });

  // Deliberately not awaited: the caller returns immediately and the UI polls.
  Promise.all(workers).finally(() => { state.running = false; });

  return state;
}

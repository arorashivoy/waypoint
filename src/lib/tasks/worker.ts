import { db } from '@/lib/db';
import { handlers } from '@/lib/tasks/handlers';
import {
  beat,
  claimNext,
  completeTask,
  deferTask,
  enqueue,
  failTask,
  requeueStale,
} from '@/lib/tasks/queue';
import { log } from '@/lib/log';

/** A handler throws this to run the task again later. The count of attempts stays. */
export class TaskDeferred extends Error {
  constructor(
    public until: Date,
    message: string,
  ) {
    super(message);
    this.name = 'TaskDeferred';
  }
}

/** A handler throws this for an error the user must read. The task fails at once and has no retry. */
export class TaskFatal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskFatal';
  }
}

/**
 * The time limit of one attempt. A hung handler must not hold the one queue. Each limit is below STALE_MS,
 * so requeueStale never takes a task that still runs. A CV build has a shorter limit: the user waits for it.
 */
export const TASK_LIMIT_MS = 300_000;
const LIMIT_MS: Partial<Record<string, number>> = { cv: 180_000 };
export const limitFor = (kind: string): number => LIMIT_MS[kind] ?? TASK_LIMIT_MS;

const MAX_ERROR_LENGTH = 500;
const REQUEUE_MS = 60_000;
const MAINTENANCE_MS = 3_600_000;

async function failAtOnce(id: string, error: string): Promise<void> {
  await db.task.update({ where: { id }, data: { status: 'failed', lastError: error.slice(0, MAX_ERROR_LENGTH) } });
}

/**
 * Runs `run` with a time limit. At the limit, the signal aborts and the promise rejects.
 * The handler can go on in the background, but the worker does not wait for it.
 */
async function withLimit(run: (signal: AbortSignal) => Promise<unknown>, limitMs: number): Promise<unknown> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`The task took longer than ${limitMs / 1000} seconds.`);
      ac.abort(err);
      reject(err);
    }, limitMs);
  });
  try {
    return await Promise.race([run(ac.signal), limit]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the next due task, if there is one.
 * `scope` and `limitMs` are for tests only. The worker never sets them.
 */
export async function runOnce(now: Date = new Date(), scope?: { userId?: string }, opts: { limitMs?: number } = {}): Promise<'ran' | 'idle'> {
  const task = await claimNext(now, scope);
  if (!task) return 'idle';
  const entry = handlers.get(task.kind as never);
  if (!entry) {
    await failAtOnce(task.id, `No handler for the kind "${task.kind}"`);
    return 'ran';
  }
  const parsed = entry.schema.safeParse(task.payload);
  if (!parsed.success) {
    await failAtOnce(task.id, `The payload is not valid: ${parsed.error.message}`);
    return 'ran';
  }
  let result: unknown;
  try {
    result = await withLimit((signal) => entry.run(parsed.data, task, signal), opts.limitMs ?? limitFor(task.kind));
  } catch (err) {
    if (err instanceof TaskDeferred) {
      await deferTask(task.id, err.until);
    } else if (err instanceof TaskFatal) {
      await failAtOnce(task.id, err.message);
    } else {
      await failTask(task.id, err instanceof Error ? err.message : String(err));
    }
    return 'ran';
  }
  await storeResult(task.id, result);
  return 'ran';
}

/**
 * The handler ended well, so its work must not run again because of a database error here.
 * The worker tries `completeTask` twice and never calls `failTask`. If both tries fail, the task stays
 * `running`, and `requeueStale` gives it back after STALE_MS. The handlers then find their own writes.
 */
async function storeResult(id: string, result: unknown): Promise<void> {
  try {
    await completeTask(id, result);
  } catch (first) {
    log.warn({ err: first, taskId: id }, 'could not store the task result; trying again');
    try {
      await completeTask(id, result);
    } catch (err) {
      log.error({ err, taskId: id }, 'could not store the task result');
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

/**
 * Runs tasks one at a time until the signal aborts. A task that runs when the signal aborts finishes first.
 * `scope` and `beatId` are for tests only. If `scope` is set, the worker does not enqueue maintenance.
 */
export async function startWorker(opts: {
  signal: AbortSignal;
  idleMs?: number;
  beatMs?: number;
  scope?: { userId?: string };
  beatId?: string;
}): Promise<void> {
  const { signal, idleMs = 2000, beatMs = 30_000, scope, beatId } = opts;
  const beatNow = () => beat(process.pid, new Date(), beatId).catch((e) => log.error({ err: e }, 'heartbeat failed'));
  await beatNow();
  const beatTimer = setInterval(() => void beatNow(), beatMs);
  let lastRequeue = 0;
  let lastMaintenance = 0;
  try {
    while (!signal.aborted) {
      try {
        const t = Date.now();
        if (t - lastRequeue >= REQUEUE_MS) {
          lastRequeue = t;
          await requeueStale(new Date(), scope);
        }
        if (!scope && t - lastMaintenance >= MAINTENANCE_MS) {
          lastMaintenance = t;
          await enqueue({ kind: 'maintenance', userId: null, payload: {}, dedupeKey: 'maintenance' });
        }
        if ((await runOnce(new Date(), scope)) === 'idle') await sleep(idleMs, signal);
      } catch (err) {
        log.error({ err }, 'worker loop error');
        await sleep(idleMs, signal);
      }
    }
  } finally {
    clearInterval(beatTimer);
  }
}

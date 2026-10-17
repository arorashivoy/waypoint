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

const MAX_ERROR_LENGTH = 500;
const REQUEUE_MS = 60_000;
const MAINTENANCE_MS = 3_600_000;

async function failAtOnce(id: string, error: string): Promise<void> {
  await db.task.update({ where: { id }, data: { status: 'failed', lastError: error.slice(0, MAX_ERROR_LENGTH) } });
}

/**
 * Runs the next due task, if there is one.
 * `scope` is for tests only. The worker never sets it.
 */
export async function runOnce(now: Date = new Date(), scope?: { userId?: string }): Promise<'ran' | 'idle'> {
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
  try {
    const result = await entry.run(parsed.data, task);
    await completeTask(task.id, result);
  } catch (err) {
    if (err instanceof TaskDeferred) {
      await deferTask(task.id, err.until);
    } else if (err instanceof TaskFatal) {
      await failAtOnce(task.id, err.message);
    } else {
      await failTask(task.id, err instanceof Error ? err.message : String(err));
    }
  }
  return 'ran';
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

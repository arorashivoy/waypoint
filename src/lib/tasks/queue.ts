import type { Task } from '@prisma/client';
import { db } from '@/lib/db';

export type TaskKind = 'refresh' | 'analysis' | 'cv' | 'resume-import' | 'github-import' | 'maintenance' | 'outreach' | 'paste';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed';

/** A Task row with the payload parsed. A later task checks the payload of each kind with zod. */
export type TaskRow = Omit<Task, 'payload'> & { payload: unknown };

/** Delay before retry 1, 2 and 3. The 4th failure sets the status to failed. */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const;
/** A running task older than this is old: the worker probably died. */
export const STALE_MS = 600_000;

/** The kinds that a user starts with a button and waits for. claimNext takes them before the other kinds. */
export const INTERACTIVE_KINDS: readonly TaskKind[] = ['cv', 'resume-import', 'github-import', 'refresh', 'outreach', 'paste'];

/**
 * `lastError` starts with this marker when the text is for the user (a TaskFatal message).
 * Any other `lastError` is raw text for the admin and the log, and the client gets a fixed text.
 */
export const USER_ERROR = '[user] ';

const MAX_CLAIM_TRIES = 5;
const MAX_ERROR_LENGTH = 500;

export async function enqueue(input: {
  kind: TaskKind;
  userId: string | null;
  payload: unknown;
  dedupeKey?: string;
  runAt?: Date;
}): Promise<{ id: string; created: boolean }> {
  const { kind, userId, payload, dedupeKey, runAt } = input;
  const data = {
    kind,
    userId,
    payload: JSON.stringify(payload ?? null),
    dedupeKey,
    runAt,
  };
  if (!dedupeKey) {
    const row = await db.task.create({ data });
    return { id: row.id, created: true };
  }
  // One transaction: the check and the insert cannot run between other writes.
  return db.$transaction(async (tx) => {
    const open = await tx.task.findFirst({
      where: { dedupeKey, status: { in: ['queued', 'running'] } },
      select: { id: true },
    });
    if (open) return { id: open.id, created: false };
    const row = await tx.task.create({ data });
    return { id: row.id, created: true };
  });
}

function parse(row: Task): TaskRow {
  return { ...row, payload: JSON.parse(row.payload) as unknown };
}

/**
 * Takes the next due task and marks it running. Two callers never get the same task.
 * The interactive kinds go before analysis and maintenance.
 * The worker never sets `scope`. Tests use it to claim only the tasks of one user.
 */
export async function claimNext(now: Date = new Date(), scope?: { userId?: string }): Promise<TaskRow | null> {
  const due = { status: 'queued', runAt: { lte: now }, ...(scope?.userId ? { userId: scope.userId } : {}) };
  const order = [{ runAt: 'asc' as const }, { createdAt: 'asc' as const }];
  for (let i = 0; i < MAX_CLAIM_TRIES; i++) {
    // A task that a user waits for goes first. Then analysis and maintenance, oldest first.
    const next =
      (await db.task.findFirst({ where: { ...due, kind: { in: [...INTERACTIVE_KINDS] } }, orderBy: order, select: { id: true } })) ??
      (await db.task.findFirst({ where: due, orderBy: order, select: { id: true } }));
    if (!next) return null;
    const won = await db.task.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'running', attempts: { increment: 1 }, startedAt: now },
    });
    if (won.count === 1) {
      const row = await db.task.findUniqueOrThrow({ where: { id: next.id } });
      return parse(row);
    }
  }
  return null;
}

export async function completeTask(id: string, result: unknown): Promise<void> {
  await db.task.update({
    where: { id },
    data: {
      status: 'done',
      result: JSON.stringify(result ?? null),
      lastError: null,
    },
  });
}

/** Retries after 1, 5 and 30 minutes. The 4th failure is final. */
export async function failTask(id: string, error: string, now: Date = new Date()): Promise<'queued' | 'failed'> {
  const row = await db.task.findUniqueOrThrow({
    where: { id },
    select: { attempts: true },
  });
  const lastError = error.slice(0, MAX_ERROR_LENGTH);
  const delay = RETRY_DELAYS_MS[row.attempts - 1];
  if (delay === undefined) {
    await db.task.update({
      where: { id },
      data: { status: 'failed', lastError },
    });
    return 'failed';
  }
  await db.task.update({
    where: { id },
    data: {
      status: 'queued',
      lastError,
      runAt: new Date(now.getTime() + delay),
    },
  });
  return 'queued';
}

/** Puts a task back in the queue until a time. It gives back the attempt that claimNext counted, so a deferral uses no retry. */
export async function deferTask(id: string, until: Date): Promise<void> {
  await db.task.update({
    where: { id },
    data: { status: 'queued', runAt: until, attempts: { decrement: 1 } },
  });
}

/** The most attempts of one task: the first run and 3 retries. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const STOPPED_TOO_OFTEN = 'The task stopped too often.';

/**
 * Puts running tasks that started more than STALE_MS ago back in the queue, and returns their count.
 * A stale task that used all its attempts fails instead, so a task that stops the worker each time
 * cannot come back forever. The worker never sets `scope`.
 */
export async function requeueStale(now: Date = new Date(), scope?: { userId?: string }): Promise<number> {
  const stale = {
    status: 'running',
    startedAt: { lt: new Date(now.getTime() - STALE_MS) },
    ...(scope?.userId ? { userId: scope.userId } : {}),
  };
  await db.task.updateMany({
    where: { ...stale, attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'failed', lastError: STOPPED_TOO_OFTEN },
  });
  const r = await db.task.updateMany({ where: stale, data: { status: 'queued' } });
  return r.count;
}

/** `id` names the heartbeat row. The worker uses the default. Tests use their own id. */
export async function beat(pid: number, now: Date = new Date(), id = 'worker'): Promise<void> {
  await db.workerHeartbeat.upsert({
    where: { id },
    create: { id, pid, beatAt: now, startedAt: now },
    update: { pid, beatAt: now },
  });
}

export async function lastBeat(id = 'worker'): Promise<Date | null> {
  const row = await db.workerHeartbeat.findUnique({ where: { id } });
  return row?.beatAt ?? null;
}

/** A finished task (done or failed) stays this many days. Then the maintenance task deletes it. */
export const TASK_KEEP_DAYS = 14;
const PRUNE_BATCH = 500;

/** Deletes done and failed tasks that ended more than TASK_KEEP_DAYS ago, 500 at a time. Never a queued or running task. Returns the count. */
export async function pruneTasks(now: Date = new Date(), scope?: { userId?: string }): Promise<number> {
  const before = new Date(now.getTime() - TASK_KEEP_DAYS * 86_400_000);
  let total = 0;
  for (;;) {
    const rows = await db.task.findMany({
      where: { status: { in: ['done', 'failed'] }, updatedAt: { lt: before }, ...(scope?.userId ? { userId: scope.userId } : {}) },
      select: { id: true },
      take: PRUNE_BATCH,
    });
    if (!rows.length) return total;
    const r = await db.task.deleteMany({ where: { id: { in: rows.map((x) => x.id) }, status: { in: ['done', 'failed'] } } });
    total += r.count;
    if (rows.length < PRUNE_BATCH) return total;
  }
}

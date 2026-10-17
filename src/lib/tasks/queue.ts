import type { Task } from '@prisma/client';
import { db } from '@/lib/db';

export type TaskKind = 'refresh' | 'analysis' | 'cv' | 'resume-import' | 'github-import' | 'maintenance';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed';

/** A Task row with the payload parsed. A later task checks the payload of each kind with zod. */
export type TaskRow = Omit<Task, 'payload'> & { payload: unknown };

/** Delay before retry 1, 2 and 3. The 4th failure sets the status to failed. */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const;
/** A running task older than this is old: the worker probably died. */
export const STALE_MS = 600_000;

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
 * The worker never sets `scope`. Tests use it to claim only the tasks of one user.
 */
export async function claimNext(now: Date = new Date(), scope?: { userId?: string }): Promise<TaskRow | null> {
  for (let i = 0; i < MAX_CLAIM_TRIES; i++) {
    const next = await db.task.findFirst({
      where: { status: 'queued', runAt: { lte: now }, ...(scope?.userId ? { userId: scope.userId } : {}) },
      orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
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

/** Puts a task back in the queue until a time. The count of attempts stays. */
export async function deferTask(id: string, until: Date): Promise<void> {
  await db.task.update({
    where: { id },
    data: { status: 'queued', runAt: until },
  });
}

/** Puts running tasks that started more than STALE_MS ago back in the queue. The worker never sets `scope`. */
export async function requeueStale(now: Date = new Date(), scope?: { userId?: string }): Promise<number> {
  const r = await db.task.updateMany({
    where: {
      status: 'running',
      startedAt: { lt: new Date(now.getTime() - STALE_MS) },
      ...(scope?.userId ? { userId: scope.userId } : {}),
    },
    data: { status: 'queued' },
  });
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

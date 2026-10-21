import type { Task } from '@prisma/client';
import { USER_ERROR } from '@/lib/tasks/queue';

/** What the client sees of a task. */
export type TaskView = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  runAt: string;
  error: string | null;
  result: unknown | null;
};

const UNREADABLE = 'The result of this task could not be read.';
/** What the client reads for an error that is not for the user. The raw text stays in the row and in the worker log. */
export const TASK_FAILED = 'The task failed. Try again later.';

/** The text of a TaskFatal (it has the marker), else the fixed text. */
function errorForUser(lastError: string | null): string {
  return lastError?.startsWith(USER_ERROR) ? lastError.slice(USER_ERROR.length) : TASK_FAILED;
}

/** Parses the stored result. `ok: false` means the text is not JSON. A null column is a valid empty result. */
function parseResult(text: string | null): { ok: true; value: unknown } | { ok: false } {
  if (text === null) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) ?? null };
  } catch {
    return { ok: false };
  }
}

/**
 * The error shows only for a failed task. A queued task that will retry has no error for the client.
 * A done task with a result that is not JSON shows as failed, so the client never gets empty data as a result.
 */
export function taskView(row: Task): TaskView {
  const base = { id: row.id, kind: row.kind, attempts: row.attempts, runAt: row.runAt.toISOString() };
  const parsed = row.status === 'done' ? parseResult(row.result) : { ok: true as const, value: null };
  if (!parsed.ok) return { ...base, status: 'failed', error: UNREADABLE, result: null };
  return {
    ...base,
    status: row.status,
    error: row.status === 'failed' ? errorForUser(row.lastError) : null,
    result: parsed.value,
  };
}

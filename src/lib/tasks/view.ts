import type { Task } from '@prisma/client';

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

function parseResult(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) ?? null;
  } catch {
    return null;
  }
}

/** The error shows only for a failed task. A queued task that will retry has no error for the client. */
export function taskView(row: Task): TaskView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    runAt: row.runAt.toISOString(),
    error: row.status === 'failed' ? row.lastError : null,
    result: parseResult(row.result),
  };
}

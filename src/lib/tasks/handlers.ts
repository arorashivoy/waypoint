import { z } from 'zod';
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

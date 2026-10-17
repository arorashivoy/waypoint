import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, HttpError } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { enqueue } from '@/lib/tasks/queue';

export const dynamic = 'force-dynamic';

const Body = z.object({ force: z.boolean().optional() });

/**
 * Starts a refresh of the job boards in the worker. The route returns the task ID.
 * A second request while the refresh is open returns the same ID.
 * An empty body is the same as `{ "force": false }`.
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const raw: unknown = await req.json().catch(() => ({}));
  const body = Body.safeParse(raw ?? {});
  if (!body.success) throw new HttpError(400, 'Send force as true or false.');
  const { id } = await enqueue({
    kind: 'refresh',
    userId: user.id,
    payload: { force: body.data.force ?? false },
    dedupeKey: `refresh:${user.id}`,
  });
  return NextResponse.json({ taskId: id });
});

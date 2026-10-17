import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle, HttpError } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { enqueue } from '@/lib/tasks/queue';

export const dynamic = 'force-dynamic';

/**
 * Starts the build of the CV of this job in the worker. The route returns the task ID.
 * A second request while the build is open returns the same ID.
 */
export const POST = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  if (!(await db.job.findUnique({ where: { id: params.id }, select: { id: true } }))) throw new HttpError(404, 'Not found.');
  const { id } = await enqueue({
    kind: 'cv',
    userId: user.id,
    payload: { jobId: params.id, action: 'generate' },
    dedupeKey: `cv:${user.id}:${params.id}`,
  });
  return NextResponse.json({ taskId: id });
});

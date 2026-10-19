import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { visibleTo } from '@/lib/job-scope';
import { handle, HttpError } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { enqueueCv } from '@/lib/tasks/cv';

export const dynamic = 'force-dynamic';

/**
 * Starts the build of the CV of this job in the worker. The route returns the task ID.
 * A second request while the build is open returns the same ID. Another action gives 409.
 */
export const POST = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  if (!(await db.job.findFirst({ where: { id: params.id, ...visibleTo(user.id) }, select: { id: true } }))) throw new HttpError(404, 'Not found.');
  return NextResponse.json({ taskId: await enqueueCv(user.id, params.id, { action: 'generate' }) });
});

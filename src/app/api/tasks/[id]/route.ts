import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle, HttpError } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { taskView } from '@/lib/tasks/view';

export const dynamic = 'force-dynamic';

/** The status of one task of the signed-in user. A task of another user, or of nobody, gives 404. */
export const GET = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const row = await db.task.findFirst({ where: { id: params.id, userId: user.id } });
  if (!row) throw new HttpError(404, 'Not found.');
  return NextResponse.json(taskView(row));
});

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle, HttpError } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { CV_MESSAGE_MAX } from '@/lib/cv';
import { enqueueCv } from '@/lib/tasks/cv';

export const dynamic = 'force-dynamic';

async function start(userId: string, jobId: string, payload: { action: 'refine' | 'reset'; message?: string }) {
  if (!(await db.job.findUnique({ where: { id: jobId }, select: { id: true } }))) throw new HttpError(404, 'Not found.');
  return NextResponse.json({ taskId: await enqueueCv(userId, jobId, payload) });
}

/** One "Refine with Claude" turn, in the worker. The route returns the task ID. */
export const POST = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const message = String(body?.message ?? '');
  if (!message.trim()) throw new HttpError(400, 'Type what to change first.');
  if (message.length > CV_MESSAGE_MAX) throw new HttpError(400, `Write at most ${CV_MESSAGE_MAX} characters.`);
  return start(user.id, params.id, { action: 'refine', message });
});

/** Forgets the conversation and its choices, in the worker. The CV goes back to the selection of the posting. */
export const DELETE = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  return start(user.id, params.id, { action: 'reset' });
});

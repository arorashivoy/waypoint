import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { decideSuggestion } from '@/lib/resume/suggest';
import { enqueueCv } from '@/lib/tasks/cv';

export const dynamic = 'force-dynamic';

/**
 * `{ action: 'suggest' }` starts a task that asks the model for new wording. The route returns the task ID.
 * `{ bulletId, action: 'accept' | 'reject' }` is the decision of the user on one suggestion.
 * Accept puts the text into the steer of this job and queues a build; reject only marks the suggestion.
 * The suggestions of the other users are not visible here: the lookup uses the ID of the session.
 */
export const POST = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const action = body.action;
  if (action === 'suggest') {
    if (!(await db.job.findUnique({ where: { id: params.id }, select: { id: true } }))) throw new HttpError(404, 'Not found.');
    return NextResponse.json({ taskId: await enqueueCv(user.id, params.id, { action: 'suggest' }) });
  }
  if (action !== 'accept' && action !== 'reject') throw new HttpError(400, 'Send action "suggest", "accept" or "reject".');
  if (typeof body.bulletId !== 'string' || !body.bulletId) throw new HttpError(400, 'Send the bulletId of the suggestion.');
  return NextResponse.json(await decideSuggestion(user.id, params.id, body.bulletId, action));
});

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { visibleTo } from '@/lib/job-scope';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { ANSWER_TEXT_MAX, enqueueAnswers, readAnswers, refuseMessage, refuseQuestions, saveAnswers } from '@/lib/answers';

export const dynamic = 'force-dynamic';

async function applicationOf(userId: string, jobId: string) {
  if (!(await db.job.findFirst({ where: { id: jobId, ...visibleTo(userId) }, select: { id: true } }))) throw new HttpError(404, 'Not found.');
  // Works for every job, also one that is marked as applied.
  return db.application.upsert({ where: { userId_jobId: { userId, jobId } }, update: {}, create: { userId, jobId } });
}

/**
 * `{ action: 'answer', text: <the questions> }` writes the first answer.
 * `{ action: 'refine', text: <a request> }` changes the answer that exists.
 * The route calls no Claude. It checks the text, queues a task, and returns the task ID.
 */
export const POST = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const action = body.action;
  if (action !== 'answer' && action !== 'refine') throw new HttpError(400, 'Send an action: "answer" or "refine".');
  const text = typeof body.text === 'string' ? body.text : '';
  // Refuse the text before any task or model call.
  const refused = action === 'answer' ? refuseQuestions(text) : refuseMessage(text);
  if (refused) throw new HttpError(400, refused);
  const app = await applicationOf(user.id, params.id);
  if (action === 'refine' && !(await readAnswers(app.id))?.text.trim()) throw new HttpError(400, 'Write the first answer before you ask for a change.');
  return NextResponse.json({ taskId: await enqueueAnswers(user.id, { applicationId: app.id, action, text: text.trim() }) });
});

/** `{ text }` saves a change that the user made by hand. */
export const PATCH = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  if (typeof body.text !== 'string') throw new HttpError(400, 'Send the text of the answers.');
  if (body.text.length > ANSWER_TEXT_MAX) throw new HttpError(400, `Write ${ANSWER_TEXT_MAX} characters or fewer.`);
  const app = await applicationOf(user.id, params.id);
  if (!(await readAnswers(app.id))) throw new HttpError(400, 'Write the first answer before you save a change.');
  return NextResponse.json({ ok: true, ...(await saveAnswers(app.id, { text: body.text })) });
});

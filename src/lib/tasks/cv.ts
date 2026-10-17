import { db } from '@/lib/db';
import { HttpError } from '@/lib/auth/http';
import { enqueue } from '@/lib/tasks/queue';

/**
 * Queues a `cv` task for one job. A second request with the same action and message returns the open task.
 * A request with another action or message while a task is open gets 409, so the user never loses a message.
 * `enqueue` makes the check and the insert in one transaction, so two requests at the same moment cannot both pass.
 */
export async function enqueueCv(userId: string, jobId: string, extra: { action: 'generate' | 'refine' | 'reset'; message?: string }): Promise<string> {
  const payload = { jobId, ...extra };
  const { id, created } = await enqueue({ kind: 'cv', userId, payload, dedupeKey: `cv:${userId}:${jobId}` });
  if (created) return id;
  const open = await db.task.findUnique({ where: { id }, select: { payload: true } });
  let same = false;
  try {
    const p = JSON.parse(open?.payload ?? 'null') as { action?: string; message?: string } | null;
    same = p?.action === payload.action && p?.message === payload.message;
  } catch {
    same = false;
  }
  if (!same) throw new HttpError(409, 'A CV task for this job is still running. Try again when it ends.');
  return id;
}

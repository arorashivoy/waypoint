import { db } from '@/lib/db';
import { HttpError } from '@/lib/auth/http';
import { enqueue } from '@/lib/tasks/queue';

/**
 * Queues a `cv` task for one job. A second request with the same action and message returns the open task.
 * A request with another action or message while a task is open gets 409, so the user never loses a message.
 */
export async function enqueueCv(userId: string, jobId: string, extra: { action: 'generate' | 'refine' | 'reset'; message?: string }): Promise<string> {
  const dedupeKey = `cv:${userId}:${jobId}`;
  const payload = { jobId, ...extra };
  const open = await db.task.findFirst({ where: { dedupeKey, status: { in: ['queued', 'running'] } }, select: { id: true, payload: true } });
  if (open) {
    let same = false;
    try {
      const p = JSON.parse(open.payload) as { action?: string; message?: string };
      same = p.action === payload.action && p.message === payload.message;
    } catch {
      same = false;
    }
    if (!same) throw new HttpError(409, 'A CV task for this job is still running. Try again when it ends.');
    return open.id;
  }
  return (await enqueue({ kind: 'cv', userId, payload, dedupeKey })).id;
}

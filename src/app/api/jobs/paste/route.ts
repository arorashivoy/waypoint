import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { hitLimit } from '@/lib/auth/rate-limit';
import { parsePastedUrl } from '@/lib/sources/paste';
import { enqueue } from '@/lib/tasks/queue';

export const dynamic = 'force-dynamic';

const Body = z.object({ url: z.string().max(2000) });

/**
 * Starts a task that reads one job from a link on a known board. The route reads the board and the job ID
 * from the link, and sends no request. A link that Waypoint cannot read gives 400 and no task.
 * A second paste of the same job while the first task is open returns the same task ID.
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, 'Send the link as text of at most 2000 characters.');
  const parsed = parsePastedUrl(body.data.url);
  if ('error' in parsed) throw new HttpError(400, parsed.error);
  const limit = await hitLimit(`paste:${user.id}`, 20, 3_600_000);
  if (!limit.ok) throw new HttpError(429, 'Too many job links in one hour. Try again later.', { retryAfterSec: limit.retryAfterSec });
  const { id } = await enqueue({
    kind: 'paste',
    userId: user.id,
    payload: { board: parsed.board, company: parsed.company, jobId: parsed.jobId, region: parsed.region, workday: parsed.workday },
    dedupeKey: `paste:${user.id}:${parsed.board}:${parsed.jobId}`,
  });
  return NextResponse.json({ taskId: id });
});

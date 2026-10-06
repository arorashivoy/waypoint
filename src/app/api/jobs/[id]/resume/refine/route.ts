import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/user';
import { CvError, refineCv, resetCv } from '@/lib/cv';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function application(userId: string, jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const app = await db.application.upsert({
    where: { userId_jobId: { userId, jobId } },
    update: {},
    create: { userId, jobId },
  });
  return { job, app };
}

const failed = (e: unknown) =>
  NextResponse.json({ error: (e as Error).message }, { status: e instanceof CvError ? 400 : 500 });

/** One "Refine with Claude" turn: Claude picks, the CV rebuilds, Drive updates in place. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const body = await req.json().catch(() => ({}));
  try {
    const { job, app } = await application(user.id, params.id);
    return NextResponse.json(await refineCv(app, job, String(body?.message ?? '')));
  } catch (e) {
    return failed(e);
  }
}

/** Forgets the conversation and its choices; the CV goes back to the posting's own selection. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  try {
    const { job, app } = await application(user.id, params.id);
    return NextResponse.json(await resetCv(app, job));
  } catch (e) {
    return failed(e);
  }
}

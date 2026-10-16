import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { NO_RESUME, cvView, publishCv } from '@/lib/cv';
import { isAdmin } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** A compile can take a minute; a double tap must not start a second one. */
const inFlight = new Map<string, Promise<ReturnType<typeof cvView>>>();

/**
 * Builds this job's CV — the posting's own selection plus any refinement — and
 * puts it on Drive. A missing LaTeX engine or Drive config is not an error
 * here: the view says why, and the local PDF is still offered.
 */
export const POST = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const key = `${user.id}:${params.id}`;
  let work = inFlight.get(key);
  if (!work) {
    work = (async () => {
      const job = await db.job.findUniqueOrThrow({ where: { id: params.id } });
      const app = await db.application.upsert({
        where: { userId_jobId: { userId: user.id, jobId: job.id } },
        update: {},
        create: { userId: user.id, jobId: job.id },
      });
      return cvView(app, await publishCv(app, job));
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, work);
  }

  try {
    const view = await work;
    if (!view.pdfUrl) return NextResponse.json({ error: (await isAdmin(user.id)) ? 'No CV configured. Set RESUME_PDF, and RESUME_TEX to tailor it.' : NO_RESUME }, { status: 404 });
    return NextResponse.json(view);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
});

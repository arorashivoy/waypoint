import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/user';
import { draftNote, jobView } from '@/lib/analysis';

export const maxDuration = 300;

const inFlight = new Map<string, Promise<string>>();

/** Draft (or re-draft) the connection note with Claude, discarding current text. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const key = `${user.id}:${params.id}`;
  let work = inFlight.get(key);
  if (!work) {
    work = (async () => {
      const job = await db.job.findUniqueOrThrow({ where: { id: params.id } });
      const { routes } = await jobView(job, user.id);
      const note = await draftNote(job, user.id, routes[0] || null);
      await db.application.upsert({
        where: { userId_jobId: { userId: user.id, jobId: job.id } },
        update: { note },
        create: { userId: user.id, jobId: job.id, note },
      });
      return note;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, work);
  }

  try {
    return NextResponse.json({ note: await work });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

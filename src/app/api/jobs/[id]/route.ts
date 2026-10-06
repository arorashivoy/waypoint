import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/user';
import { analyseJob, jobView } from '@/lib/analysis';
import { readChat } from '@/lib/cv';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * A Claude call costs tens of seconds, and React's dev double-effect plus an
 * impatient tap can fire the same GET three times. Concurrent calls for one job
 * share a single promise, so the model runs once.
 */
const inFlight = new Map<string, Promise<any>>();

async function detail(jobId: string, userId: string, force: boolean) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  // `analysedAt`, not `analysis`: a job carrying only a keyword heuristic from a
  // failed call should get a real read when you open it, not the stale estimate.
  if (force || !job.analysedAt) await analyseJob(job, userId, force);

  const fresh = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const view = await jobView(fresh, userId);

  const app = await db.application.upsert({
    where: { userId_jobId: { userId, jobId } },
    update: { match: view.match },
    create: { userId, jobId, match: view.match },
  });

  return {
    id: fresh.id,
    role: fresh.role,
    company: fresh.company,
    city: fresh.city,
    cc: fresh.cc,
    place: `${fresh.cc} · ${fresh.city}`,
    url: fresh.url,
    sourceList: fresh.source,
    ...view.analysis,
    reqs: view.analysis.requirements,
    projects: view.analysis.projects.map((p, i) => ({ ...p, rank: String(i + 1) })),
    routes: view.routes,
    match: view.match,
    note: app.note,
    // The note is drafted by a second call the client makes once this renders,
    // so the description and referral route appear without waiting for it.
    noteReady: app.note.length > 0,
    isSent: app.status !== 'draft',
    isApplied: app.status === 'applied',
    // What was last generated, without rebuilding it: opening a job must not
    // cost a LaTeX compile. Pressing "Generate" fills in the rest.
    cv: app.cvPath
      ? { pdfUrl: `/api/resume/${app.id}`, driveUrl: app.cvUrl, lead: app.cvLead, chat: readChat(app) }
      : null,
  };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const force = req.nextUrl.searchParams.get('reanalyse') === '1';
  const key = `${user.id}:${params.id}:${force}`;

  let work = inFlight.get(key);
  if (!work) {
    work = detail(params.id, user.id, force).finally(() => inFlight.delete(key));
    inFlight.set(key, work);
  }

  try {
    return NextResponse.json(await work);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const body = await req.json();
  const app = await db.application.upsert({
    where: { userId_jobId: { userId: user.id, jobId: params.id } },
    update: {},
    create: { userId: user.id, jobId: params.id },
  });

  const data: { note?: string; status?: string } = {};
  if (typeof body.note === 'string') data.note = body.note.slice(0, 2000);
  if (body.applied !== undefined) data.status = body.applied ? 'applied' : app.status === 'applied' ? 'draft' : app.status;
  if (Object.keys(data).length) await db.application.update({ where: { id: app.id }, data });

  return NextResponse.json({ ok: true });
}

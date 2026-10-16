import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { profileSummary } from '@/lib/user';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { analyseJob, jobView } from '@/lib/analysis';
import { alumniSearch, isAlumniRequest } from '@/lib/match';
import { readChat, rethrowForUser } from '@/lib/cv';

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
  // `analysedAt` on the `JobAnalysis` row, not the row itself: a job carrying only a keyword heuristic from a
  // failed call should get a real read when you open it, not the stale estimate.
  const row = await db.jobAnalysis.findUnique({ where: { userId_jobId: { userId, jobId } } });
  if (force || !row?.analysedAt) await analyseJob(job, userId, force);

  const fresh = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const view = await jobView(fresh, userId);

  const app = await db.application.upsert({
    where: { userId_jobId: { userId, jobId } },
    update: { match: view.match },
    create: { userId, jobId, match: view.match },
  });

  const referral = await db.outreachEvent.findFirst({ where: { applicationId: app.id, kind: 'request' }, orderBy: { createdAt: 'desc' } });
  const { school } = await profileSummary(userId);

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
    // So the message can be copied again after a reload, or when the browser
    // blocked the clipboard the first time.
    referral: referral && { copy: referral.body, open: referral.contactUrl, name: referral.contactName, alumni: isAlumniRequest(referral) },
    // The fallback when `routes` is empty. Null without a school on the
    // profile, since there is nobody to call a fellow alumnus.
    alumni: school && { school: school.short, url: alumniSearch(school, fresh.company) },
    isSent: app.status !== 'draft',
    isApplied: app.status === 'applied',
    // What was last generated, without rebuilding it: opening a job must not
    // cost a LaTeX compile. Pressing "Generate" fills in the rest.
    cv: app.cvPath
      ? { pdfUrl: `/api/resume/${app.id}`, driveUrl: app.cvUrl, lead: app.cvLead, chat: readChat(app) }
      : null,
  };
}

function shared(jobId: string, userId: string, force: boolean) {
  const key = `${userId}:${jobId}:${force}`;
  let work = inFlight.get(key);
  if (!work) {
    work = detail(jobId, userId, force).finally(() => inFlight.delete(key));
    inFlight.set(key, work);
  }
  return work.catch(rethrowForUser);
}

/** Opens a job. It analyses the job only if it has no analysis yet. */
export const GET = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  return NextResponse.json(await shared(params.id, user.id, false));
});

/**
 * `{ reanalyse: true }` runs a new Claude analysis. This is a POST and not a
 * GET query, because a new analysis spends Claude credit, and the origin
 * check covers only writes: a link on another site can start a GET.
 */
export const POST = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  if (body.reanalyse !== true) throw new HttpError(400, 'Send { "reanalyse": true } to analyse the job again.');
  return NextResponse.json(await shared(params.id, user.id, true));
});

export const PATCH = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const app = await db.application.upsert({
    where: { userId_jobId: { userId: user.id, jobId: params.id } },
    update: {},
    create: { userId: user.id, jobId: params.id },
  });

  const data: { status?: string } = {};
  if (body.applied !== undefined) data.status = body.applied ? 'applied' : app.status === 'applied' ? 'draft' : app.status;
  if (Object.keys(data).length) await db.application.update({ where: { id: app.id }, data });

  return NextResponse.json({ ok: true });
});

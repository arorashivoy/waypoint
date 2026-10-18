import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { profileSummary } from '@/lib/user';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { MAX_ANALYSIS_TRIES, jobView } from '@/lib/analysis';
import { credentialFor } from '@/lib/claude';
import { queueJobAnalysis } from '@/lib/queue';
import { alumniSearch, isAlumniRequest } from '@/lib/match';
import { readChat } from '@/lib/cv';
import { claimsFor } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * The route never calls Claude. A job with no analysis gets an `analysis` task, and the worker
 * runs it. Until then the screen shows the keyword estimate, and `analysing` holds the task ID.
 */
async function needsAnalysis(jobId: string, userId: string): Promise<boolean> {
  // `analysedAt` on the `JobAnalysis` row, not the row itself: a job carrying only a keyword heuristic from a
  // failed call should get a real read when you open it, not the stale estimate.
  const row = await db.jobAnalysis.findUnique({ where: { userId_jobId: { userId, jobId } } });
  if (row?.analysedAt) return false;
  // The try counter stops a posting that breaks the model each time. A POST can still ask again.
  if ((row?.tries ?? 0) >= MAX_ANALYSIS_TRIES) return false;
  return !!(await credentialFor(userId));
}

async function detail(jobId: string, userId: string, analysing: string | null) {
  const fresh = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const view = await jobView(fresh, userId);

  const app = await db.application.upsert({
    where: { userId_jobId: { userId, jobId } },
    update: { match: view.match },
    create: { userId, jobId, match: view.match },
  });

  const referral = await db.outreachEvent.findFirst({ where: { applicationId: app.id, kind: 'request' }, orderBy: { createdAt: 'desc' } });
  const { school } = await profileSummary(userId);
  // The claim labels, so the screen shows "Java" and not the slug "java".
  const labels = new Map(((await claimsFor(userId))?.claims ?? []).map((c) => [c.slug, c.label]));

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
    // The evidence is a list of claim labels. The slugs stay on the server.
    requirements: view.analysis.requirements.map((r) => ({ ...r, evidence: r.evidence.map((s) => labels.get(s) ?? s) })),
    must: view.hints.must,
    projects: view.hints.projects.map((p, i) => ({ ...p, rank: String(i + 1) })),
    routes: view.routes,
    match: view.match,
    // The task that reads this job now, or null. The screen waits for it and then loads the job again.
    analysing,
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

/** Opens a job. If the job has no analysis yet, it queues an analysis task. */
export const GET = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  await db.job.findUniqueOrThrow({ where: { id: params.id } });
  const analysing = (await needsAnalysis(params.id, user.id)) ? await queueJobAnalysis(user.id, params.id) : null;
  return NextResponse.json(await detail(params.id, user.id, analysing));
});

/**
 * `{ reanalyse: true }` queues a new Claude analysis and returns `{ taskId }`. This is a POST
 * and not a GET query, because a new analysis spends Claude credit, and the origin
 * check covers only writes: a link on another site can start a GET.
 */
export const POST = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  if (body.reanalyse !== true) throw new HttpError(400, 'Send { "reanalyse": true } to analyse the job again.');
  await db.job.findUniqueOrThrow({ where: { id: params.id } });
  return NextResponse.json({ taskId: await queueJobAnalysis(user.id, params.id, true) });
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

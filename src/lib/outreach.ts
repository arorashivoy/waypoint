import type { Application, Job } from '@prisma/client';
import { db } from '@/lib/db';
import { HttpError } from '@/lib/auth/http';
import { enqueue } from '@/lib/tasks/queue';
import { TaskFatal } from '@/lib/tasks/worker';
import { profileSummary } from '@/lib/user';
import type { ResolvedProfile } from '@/lib/claims';
import { jobView } from '@/lib/analysis';
import { alumniSearch, ALUMNI_REASON } from '@/lib/match';
import { askJson, credentialFor } from '@/lib/claude';
import { askJsonCached } from '@/lib/cache';
import { DraftReply, HookReply, INCOMING_MAX, SlotsReply } from '@/lib/schemas';
import { alumniHookBudget, MIN_HOOK, renderAlumniNote, renderColdEmail, renderReferral, resolveHighlight, type Slots } from '@/lib/templates';
import { ALUMNI_SYSTEM, alumniPrompt, COLD_SYSTEM, coldPrompt, PROMPT_VERSIONS, REFERRAL_SYSTEM, referralPrompt, REPLY_SYSTEM, replyPrompt } from '@/lib/prompts';
import { checkForInjection } from '@/lib/injection';
import { resumeOffer } from '@/lib/resume';
import { publishCv, type Published } from '@/lib/cv';
import { getSettings } from '@/lib/settings';

export type OutreachPayload = {
  action: 'referral' | 'note' | 'reply' | 'cold';
  applicationId: string;
  /** The person who accepted the alumni note (action `referral` only). */
  name?: string;
  profileUrl?: string | null;
  /** The recruiter to email (action `cold` only). The user can edit the address before this. */
  email?: string;
  /** The message of the contact (action `reply` only). */
  incoming?: string;
};

/**
 * Queues an `outreach` task. A second request with the same payload returns the open task.
 * A request with another payload while a task is open gets 409, so the user never loses an input.
 */
export async function enqueueOutreach(userId: string, payload: OutreachPayload): Promise<string> {
  const { id, created } = await enqueue({
    kind: 'outreach',
    userId,
    payload,
    dedupeKey: `outreach:${userId}:${payload.action}:${payload.applicationId}`,
  });
  if (created) return id;
  const open = await db.task.findUnique({ where: { id }, select: { payload: true } });
  let same = false;
  try {
    same = JSON.stringify(JSON.parse(open?.payload ?? 'null')) === JSON.stringify(payload);
  } catch {
    same = false;
  }
  if (!same) throw new HttpError(409, 'An outreach task for this job is still running. Try again when it ends.');
  return id;
}

/** Outreach often continues after the application itself went in; moving an
 *  applied job back to "sent" would drop it out of the Applied column. */
const progress = (app: { status: string }, to: string) => (app.status === 'applied' ? 'applied' : to);

/** Without a profile URL in the export, a people search for the name at the
 *  company is the closest LinkedIn gets to the person. */
export const profileLink = (c: { name: string; profileUrl: string | null }, company: string) =>
  c.profileUrl || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${c.name} ${company}`)}`;

/** Both are the user's own choices. */
const userSettings = async (userId: string) => {
  const s = await getSettings(userId);
  const ccs = (await db.countryPref.findMany({ where: { userId, on: true }, select: { cc: true }, orderBy: { cc: 'asc' } })).map((p) => p.cc);
  return { fields: s.fields, visaStatus: s.visaStatus, ccs };
};

/**
 * The referral message to a 1st-degree connection, with the job's tailored CV.
 *
 * The message body comes from REFERRAL_TEMPLATE, not from the model. Claude
 * supplies three spans — which project or role to lead with, why it matches
 * this posting, and the one thing the posting asks for — and everything else
 * is filled from rows we already hold. Fixed ask, fixed tone, and roughly a
 * quarter of the output tokens of writing the message from scratch.
 */
async function draftReferral(app: Application, job: Job, profile: ResolvedProfile, contactName: string, fields: string[]) {
  // The CV comes first. When the build fails (for example, no LaTeX engine), the task fails before the paid Claude call.
  // Which projects lead is decided from the claim graph against this
  // posting's own words, plus whatever was chosen in "Refine with Claude".
  // Uploaded before the message is written, because the message quotes the
  // link. Only the worker starts LaTeX: if the tailored PDF is not built yet,
  // the message links the base PDF.
  const { resume, driveReason } = await publishCv(app, job, { compile: false });

  const cred = await credentialFor(app.userId);
  const candidates = [...profile.projects.map((p) => p.title), ...profile.positions.map((p) => p.title)].filter(Boolean);
  const slots: Slots =
    !cred
      ? { highlight: candidates[0] || '', hook: 'it lines up closely with what I build today', proof: `I ${profile.headline.toLowerCase()}` }
      : await askJsonCached('referral', PROMPT_VERSIONS.referral, { system: REFERRAL_SYSTEM, prompt: referralPrompt(profile, job, contactName, fields), schema: SlotsReply, effort: 'low' }, { userId: app.userId, kind: 'referral' });

  const message = renderReferral({
    firstName: contactName.split(' ')[0],
    role: job.role,
    company: job.company,
    jobRef: job.url || '[JOB ID]',
    candidateName: profile.name,
    highlight: resolveHighlight(slots.highlight, candidates),
    hook: slots.hook,
    proof: slots.proof,
    cv: resumeOffer(resume),
  });

  // `publishCv` kept the link, path and lead on the application, not only in the message body.
  await db.application.update({
    where: { id: app.id },
    data: { status: progress(app, 'sent'), cvSentAt: resume ? new Date() : null },
  });
  return { message, resume, driveReason };
}

/** `reason` is returned as well as `path`: an untailored CV looks exactly like
 *  a tailored one from the outside, so the one case worth saying out loud is
 *  the one where it silently did not happen. */
const resumeView = (resume: Published['resume'], driveReason: string | null) =>
  resume && {
    tailored: resume.tailored,
    lead: resume.lead,
    path: resume.path,
    publicUrl: resume.publicUrl,
    reason: resume.reason,
    shareReason: driveReason,
  };

const eventOrg = (job: Job) => `${job.company}, ${job.city}`;

/** The work of an `outreach` task. It runs in the worker. The result is the JSON that the client reads. */
export async function runOutreach(userId: string, p: OutreachPayload): Promise<Record<string, unknown>> {
  const app = await db.application.findFirst({ where: { id: p.applicationId, userId } });
  if (!app) throw new TaskFatal('The job is gone.');
  const job = await db.job.findUnique({ where: { id: app.jobId } });
  if (!job) throw new TaskFatal('The job is gone.');
  const settings = await userSettings(userId);

  if (p.action === 'referral') {
    const profile = await profileSummary(userId);
    let name: string;
    let contactUrl: string;
    let init: string;
    let reason: string;
    if (p.name) {
      // The alumnus accepted the note and is a connection now.
      name = p.name;
      contactUrl = profileLink({ name, profileUrl: p.profileUrl ?? null }, job.company);
      init = name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
      reason = `1st-degree, ${profile.school ? `${profile.school.short} alum` : 'alumnus'}, accepted your request`;
    } else {
      const route = (await jobView(job, userId)).routes[0];
      if (!route) throw new TaskFatal(`No 1st-degree connection at ${job.company} in your imported export.`);
      name = route.name;
      contactUrl = profileLink(route, job.company);
      init = route.init;
      reason = route.why;
    }
    const { message, resume, driveReason } = await draftReferral(app, job, profile, name, settings.fields);
    await db.outreachEvent.create({
      data: { applicationId: app.id, kind: 'request', contactName: name, contactInit: init, contactUrl, org: eventOrg(job), body: message, reason, handled: true },
    });
    return { ok: true, copy: message, open: contactUrl, name, resume: resumeView(resume, driveReason) };
  }

  if (p.action === 'cold') {
    const profile = await profileSummary(userId);
    const recruiter = await db.outreachEvent.findFirst({ where: { applicationId: app.id, kind: 'recruiter' }, orderBy: { createdAt: 'desc' } });
    const name = recruiter?.contactName || 'there';
    const email = p.email ?? recruiter?.contactEmail;
    if (!email) throw new TaskFatal('Find the recruiter email first.');
    const { resume } = await publishCv(app, job, { compile: false });
    const cred = await credentialFor(userId);
    const candidates = [...profile.projects.map((x) => x.title), ...profile.positions.map((x) => x.title)].filter(Boolean);
    const slots: Slots =
      !cred
        ? { highlight: candidates[0] || '', hook: 'it lines up closely with what I build today', proof: `I ${profile.headline.toLowerCase()}` }
        : await askJsonCached('cold', PROMPT_VERSIONS.cold, { system: COLD_SYSTEM, prompt: coldPrompt(profile, job, name, settings.fields), schema: SlotsReply, effort: 'low' }, { userId, kind: 'cold' });
    const { subject, body } = renderColdEmail({
      firstName: name.split(' ')[0],
      role: job.role,
      company: job.company,
      jobRef: job.url || '[JOB ID]',
      candidateName: profile.name,
      highlight: resolveHighlight(slots.highlight, candidates),
      hook: slots.hook,
      proof: slots.proof,
      cv: resumeOffer(resume),
    });
    // A new draft replaces the open one. Nothing is sent: the user approves it first, and then sends it from Gmail.
    await db.outreachEvent.deleteMany({ where: { applicationId: app.id, kind: 'email', handled: false } });
    const event = await db.outreachEvent.create({
      data: { applicationId: app.id, kind: 'email', contactName: name, contactInit: name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase(), contactEmail: email, subject, org: eventOrg(job), body, reason: 'Cold email to a recruiter' },
    });
    return { ok: true, id: event.id, name, email, subject, body };
  }

  if (p.action === 'note') {
    const profile = await profileSummary(userId);
    const school = profile.school;
    if (!school) throw new TaskFatal('No school on your profile. Add an education in your profile.');
    const cred = await credentialFor(userId);
    const frame = { school: school.short, role: job.role, company: job.company };
    const budget = alumniHookBudget(frame);
    // Too little room left for a sentence worth reading: the note goes out
    // with the frame alone, and the call is not worth making.
    const hook =
      !cred || budget < MIN_HOOK
        ? ''
        : (await askJsonCached('note', PROMPT_VERSIONS.note, { system: ALUMNI_SYSTEM, prompt: alumniPrompt(profile, job, school.short, budget, settings.fields), schema: HookReply, effort: 'low' }, { userId, kind: 'note' })).hook;
    const note = renderAlumniNote({ ...frame, hook });
    const open = alumniSearch(school, job.company);
    const name = `${school.short} alumni at ${job.company}`;
    await db.application.update({ where: { id: app.id }, data: { status: progress(app, 'sent') } });
    await db.outreachEvent.create({
      data: { applicationId: app.id, kind: 'request', contactName: name, contactInit: 'AL', contactUrl: open, org: eventOrg(job), body: note, reason: ALUMNI_REASON, handled: true },
    });
    return { ok: true, copy: note, open, name, alumni: true };
  }

  // action: reply
  const profile = await profileSummary(userId);
  // Newest first: an accepted alumni request leaves two, and the reply is to
  // the person, not to "<school> alumni at <company>".
  const request = await db.outreachEvent.findFirst({ where: { applicationId: app.id, kind: 'request' }, orderBy: { createdAt: 'desc' } });
  const name = request?.contactName || 'there';
  const incoming = (p.incoming ?? '').slice(0, INCOMING_MAX);
  const cred = await credentialFor(userId);

  // Without Claude we cannot judge certainty, so nothing auto-sends: it all
  // goes to Needs you, which is the safe direction to fail in.
  const drafted = !cred
    ? { draft: `Thank you, ${name.split(' ')[0]}!`, certain: false, reason: 'Claude is not connected, so this reply was not checked. Read it before sending.' }
    : (await askJson({ system: REPLY_SYSTEM, prompt: replyPrompt(profile, job, name, incoming, settings), schema: DraftReply, effort: 'medium' }, { userId, kind: 'reply' })).data;

  // The model is instructed to refuse manipulation and does. This does not
  // depend on that: a message shaped like an instruction to a model is
  // downgraded here, after the model call, so no crafted message can reach the
  // one-tap send path.
  const probe = checkForInjection(incoming);
  if (probe.suspicious && drafted.certain) {
    drafted.certain = false;
    drafted.reason = `Held for you: this message was not sent on its own because ${probe.why}. Read the original before replying.`;
  } else if (probe.suspicious && !drafted.reason) {
    drafted.reason = `Worth a careful read: ${probe.why}.`;
  }

  await db.application.update({ where: { id: app.id }, data: { status: progress(app, 'replied') } });
  await db.outreachEvent.create({
    data: {
      applicationId: app.id,
      kind: 'replied',
      contactName: name,
      contactInit: request?.contactInit || '??',
      contactUrl: request?.contactUrl || null,
      org: eventOrg(job),
      body: drafted.draft,
      incoming,
      certain: !!drafted.certain,
      reason: drafted.reason || '',
    },
  });
  return { ok: true, certain: !!drafted.certain };
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { Application, Job } from '@prisma/client';
import { profileSummary } from '@/lib/user';
import { handle, readJson } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import type { ResolvedProfile } from '@/lib/claims';
import { jobView } from '@/lib/analysis';
import { alumniSearch, ALUMNI_REASON, isAlumniRequest } from '@/lib/match';
import { askJson, credentialFor } from '@/lib/claude';
import { askJsonCached } from '@/lib/cache';
import { DraftReply, HookReply, SlotsReply } from '@/lib/schemas';
import { alumniHookBudget, MIN_HOOK, renderAlumniNote, renderReferral, resolveHighlight, type Slots } from '@/lib/templates';
import { ALUMNI_SYSTEM, alumniPrompt, PROMPT_VERSIONS, REFERRAL_SYSTEM, referralPrompt, REPLY_SYSTEM, replyPrompt } from '@/lib/prompts';
import { checkForInjection } from '@/lib/injection';
import { resumeOffer } from '@/lib/resume';
import { publishCv, type Published } from '@/lib/cv';

export const maxDuration = 300;

const ON_FILE = ['the CV', 'the job link', 'the job ID', 'the LinkedIn profile'];

/** Outreach often continues after the application itself went in; moving an
 *  applied job back to "sent" would drop it out of the Applied column. */
const progress = (app: { status: string }, to: string) => (app.status === 'applied' ? 'applied' : to);

/** Without a profile URL in the export, a people search for the name at the
 *  company is the closest LinkedIn gets to the person. */
const profileLink = (c: { name: string; profileUrl: string | null }, company: string) =>
  c.profileUrl || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${c.name} ${company}`)}`;

/**
 * The referral message to a 1st-degree connection, with the job's tailored CV.
 *
 * The message body comes from REFERRAL_TEMPLATE, not from the model. Claude
 * supplies three spans — which project or role to lead with, why it matches
 * this posting, and the one thing the posting asks for — and everything else
 * is filled from rows we already hold. Fixed ask, fixed tone, and roughly a
 * quarter of the output tokens of writing the message from scratch.
 */
async function draftReferral(app: Application, job: Job, profile: ResolvedProfile, contactName: string) {
  const cred = await credentialFor(app.userId);
  const candidates = [...profile.projects.map((p) => p.title), ...profile.positions.map((p) => p.title)].filter(Boolean);
  // Part 5 moves this Claude call to the worker. Until then it stays in the request.
  const slots: Slots =
    !cred
      ? { highlight: candidates[0] || '', hook: 'it lines up closely with what I build today', proof: `I ${profile.headline.toLowerCase()}` }
      : await askJsonCached('referral', PROMPT_VERSIONS.referral, { system: REFERRAL_SYSTEM, prompt: referralPrompt(profile, job, contactName), schema: SlotsReply, effort: 'low' }, { userId: app.userId, kind: 'referral' });

  // Which projects lead is decided from the claim graph against this
  // posting's own words, plus whatever was chosen in "Refine with Claude" —
  // the same build the job screen generated, so the link here is the link
  // already seen there.
  //
  // Uploaded before the message is written, because the message quotes the
  // link. One Drive file per posting: a referrer who opens it weeks later
  // still sees the CV that was tailored for their company.
  //
  // The request never compiles: only the worker starts LaTeX. If the tailored
  // PDF is not built yet, the message links the base PDF.
  const { resume, driveReason } = await publishCv(app, job, { compile: false });

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

  // `publishCv` kept the link, path and lead on the application, not only in
  // the message body: before an interview the question is "which CV did this
  // company read", and the message is the wrong place to go looking for it.
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

/**
 * LinkedIn's API cannot send a connection request, send a message, or read the
 * inbox, and automating the site breaks the User Agreement. So every outbound
 * step here is: draft the text, hand it to the clipboard, open the profile, and
 * record what the user says happened. Nothing is sent by Waypoint.
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const job = await db.job.findUniqueOrThrow({ where: { id: String(body.jobId ?? '') } });
  const app = await db.application.upsert({
    where: { userId_jobId: { userId: user.id, jobId: job.id } },
    update: {},
    create: { userId: user.id, jobId: job.id },
  });

  if (body.action === 'referral') {
    // Every route comes from Connections.csv, so the contact is already a
    // 1st-degree connection: there is no request to wait on, and the referral
    // ask goes straight into a message.
    const profile = await profileSummary(user.id);
    const { routes } = await jobView(job, user.id);
    const route = routes[0];
    if (!route) return NextResponse.json({ error: `No 1st-degree connection at ${job.company} in your imported export.` }, { status: 404 });

    const { message, resume, driveReason } = await draftReferral(app, job, profile, route.name);
    await db.outreachEvent.create({
      data: {
        applicationId: app.id,
        kind: 'request',
        contactName: route.name,
        contactInit: route.init,
        contactUrl: profileLink(route, job.company),
        org: `${job.company} · ${job.city}`,
        body: message,
        reason: route.why,
        handled: true,
      },
    });
    return NextResponse.json({ ok: true, copy: message, open: profileLink(route, job.company), name: route.name, resume: resumeView(resume, driveReason) });
  }

  if (body.action === 'alumni') {
    // No connection at the company, so the ask goes to a stranger from the
    // same school. Waypoint cannot search LinkedIn for them (no API, and
    // scraping breaks the User Agreement), so it drafts the note, opens the
    // school's alumni list filtered to this company, and the user picks.
    const profile = await profileSummary(user.id);
    const school = profile.school;
    if (!school) {
      return NextResponse.json({ error: 'No school on your profile. Add an education in your profile.' }, { status: 400 });
    }
    const cred = await credentialFor(user.id);

    const frame = { school: school.short, role: job.role, company: job.company };
    const budget = alumniHookBudget(frame);
    // Too little room left for a sentence worth reading: the note goes out
    // with the frame alone, and the call is not worth making.
    const hook =
      !cred || budget < MIN_HOOK
        ? ''
        : (await askJsonCached('note', PROMPT_VERSIONS.note, { system: ALUMNI_SYSTEM, prompt: alumniPrompt(profile, job, school.short, budget), schema: HookReply, effort: 'low' }, { userId: user.id, kind: 'note' })).hook;
    const note = renderAlumniNote({ ...frame, hook });
    const open = alumniSearch(school, job.company);
    const name = `${school.short} alumni at ${job.company}`;

    await db.application.update({ where: { id: app.id }, data: { status: progress(app, 'sent') } });
    await db.outreachEvent.create({
      data: {
        applicationId: app.id,
        kind: 'request',
        contactName: name,
        contactInit: 'AL',
        contactUrl: open,
        org: `${job.company} · ${job.city}`,
        body: note,
        reason: ALUMNI_REASON,
        handled: true,
      },
    });
    return NextResponse.json({ ok: true, copy: note, open, name, alumni: true });
  }

  if (body.action === 'accepted') {
    // The alumnus is a connection now, so this is the ordinary referral
    // message with the CV link the 300-character note had no room for. Who
    // accepted is known only from the user, since the note went to whoever
    // they picked from the search.
    const request = await db.outreachEvent.findFirst({ where: { applicationId: app.id, kind: 'request' }, orderBy: { createdAt: 'desc' } });
    if (!isAlumniRequest(request)) return NextResponse.json({ error: 'There is no alumni request out for this job.' }, { status: 400 });
    const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: 'Type the name of the person who accepted.' }, { status: 400 });
    const raw = String(body.profileUrl || '').trim();
    const profileUrl = /^https:\/\/([a-z]+\.)?linkedin\.com\/in\/\S+$/i.test(raw) ? raw : null;

    const profile = await profileSummary(user.id);
    const { message, resume, driveReason } = await draftReferral(app, job, profile, name);
    const contactUrl = profileLink({ name, profileUrl }, job.company);
    await db.outreachEvent.create({
      data: {
        applicationId: app.id,
        kind: 'request',
        contactName: name,
        contactInit: name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
        contactUrl,
        org: `${job.company} · ${job.city}`,
        body: message,
        reason: `1st-degree · ${profile.school ? `${profile.school.short} alum` : 'alumnus'}, accepted your request`,
        handled: true,
      },
    });
    return NextResponse.json({ ok: true, copy: message, open: contactUrl, name, resume: resumeView(resume, driveReason) });
  }

  if (body.action === 'replied') {
    const profile = await profileSummary(user.id);
    // Newest first: an accepted alumni request leaves two, and the reply is to
    // the person, not to "<school> alumni at <company>".
    const request = await db.outreachEvent.findFirst({ where: { applicationId: app.id, kind: 'request' }, orderBy: { createdAt: 'desc' } });
    const name = request?.contactName || 'there';
    const incoming = String(body.incoming || '').slice(0, 8000);
    const cred = await credentialFor(user.id);

    // Without Claude we cannot judge certainty, so nothing auto-sends: it all
    // goes to Needs you, which is the safe direction to fail in.
    const drafted =
      !cred
        ? { draft: `Thank you, ${name.split(' ')[0]}!`, certain: false, reason: 'Claude is not connected, so this reply was not checked. Read it before sending.' }
        : (await askJson({ system: REPLY_SYSTEM, prompt: replyPrompt(profile, job, name, incoming, ON_FILE), schema: DraftReply, effort: 'medium' }, { userId: user.id, kind: 'reply' })).data;

    // The model is instructed to refuse manipulation and does. This does not
    // depend on that: a message shaped like an instruction to a model is
    // downgraded here, after the fact, so no crafted message can reach the
    // one-tap send path. Costs a read when wrong; the inverse costs a message
    // sent in the user's name.
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
        org: `${job.company} · ${job.city}`,
        body: drafted.draft,
        incoming,
        certain: !!drafted.certain,
        reason: drafted.reason || '',
      },
    });
    return NextResponse.json({ ok: true, certain: !!drafted.certain });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
});

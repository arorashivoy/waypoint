import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, profileSummary } from '@/lib/user';
import { jobView } from '@/lib/analysis';
import { askJson, detectMode } from '@/lib/claude';
import { askJsonCached } from '@/lib/cache';
import { renderReferral, resolveHighlight, type Slots } from '@/lib/templates';
import { REFERRAL_SYSTEM, referralPrompt, REPLY_SYSTEM, replyPrompt } from '@/lib/prompts';
import { checkForInjection } from '@/lib/injection';
import { resumeOffer } from '@/lib/resume';
import { publishCv } from '@/lib/cv';

export const maxDuration = 300;

const ON_FILE = ['the CV', 'the job link', 'the job ID', 'the LinkedIn profile'];

/** Without a profile URL in the export, a people search for the name at the
 *  company is the closest LinkedIn gets to the person. */
const profileLink = (c: { name: string; profileUrl: string | null }, company: string) =>
  c.profileUrl || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${c.name} ${company}`)}`;

/**
 * LinkedIn's API cannot send a connection request, send a message, or read the
 * inbox, and automating the site breaks the User Agreement. So every outbound
 * step here is: draft the text, hand it to the clipboard, open the profile, and
 * record what the user says happened. Nothing is sent by Waypoint.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json();
  const job = await db.job.findUniqueOrThrow({ where: { id: body.jobId } });
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
    const { mode } = await detectMode();

    // The message body comes from REFERRAL_TEMPLATE, not from the model. Claude
    // supplies three spans — which project or role to lead with, why it matches
    // this posting, and the one thing the posting asks for — and everything else
    // is filled from rows we already hold. Fixed ask, fixed tone, and roughly a
    // quarter of the output tokens of writing the message from scratch.
    const candidates = [...profile.projects.map((p) => p.title), ...profile.positions.map((p) => p.title)].filter(Boolean);
    const slots: Slots =
      mode === 'none'
        ? { highlight: candidates[0] || '', hook: 'it lines up closely with what I build today', proof: `I ${profile.headline.toLowerCase()}` }
        : await askJsonCached<Slots>('referral', REFERRAL_SYSTEM, referralPrompt(profile, job, route.name));

    // Which projects lead is decided from the claim graph against this
    // posting's own words, plus whatever was chosen in "Refine with Claude" —
    // the same build the job screen generated, so the link here is the link
    // already seen there.
    //
    // Uploaded before the message is written, because the message quotes the
    // link. One Drive file per posting: a referrer who opens it weeks later
    // still sees the CV that was tailored for their company.
    const { resume, driveReason } = await publishCv(app, job);

    const message = renderReferral({
      firstName: route.name.split(' ')[0],
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
      data: { status: 'sent', cvSentAt: resume ? new Date() : null },
    });
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
    // `reason` is returned as well as `path`: an untailored CV looks exactly
    // like a tailored one from the outside, so the one case worth saying out
    // loud is the one where it silently did not happen.
    return NextResponse.json({
      ok: true,
      copy: message,
      open: profileLink(route, job.company),
      name: route.name,
      resume: resume && {
        tailored: resume.tailored,
        lead: resume.lead,
        path: resume.path,
        publicUrl: resume.publicUrl,
        reason: resume.reason,
        shareReason: driveReason,
      },
    });
  }

  if (body.action === 'replied') {
    const profile = await profileSummary(user.id);
    const request = await db.outreachEvent.findFirst({ where: { applicationId: app.id, kind: 'request' } });
    const name = request?.contactName || 'there';
    const incoming = String(body.incoming || '').slice(0, 8000);
    const { mode } = await detectMode();

    // Without Claude we cannot judge certainty, so nothing auto-sends: it all
    // goes to Needs you, which is the safe direction to fail in.
    const drafted =
      mode === 'none'
        ? { draft: `Thank you, ${name.split(' ')[0]}!`, certain: false, reason: 'Claude is not connected, so this reply was not checked. Read it before sending.' }
        : await askJson<{ draft: string; certain: boolean; reason: string }>(
            REPLY_SYSTEM,
            replyPrompt(profile, job, name, incoming, ON_FILE),
          );

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

    await db.application.update({ where: { id: app.id }, data: { status: 'replied' } });
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
}

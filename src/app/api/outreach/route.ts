import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, profileSummary } from '@/lib/user';
import { jobView } from '@/lib/analysis';
import { askJson, detectMode } from '@/lib/claude';
import { REFERRAL_SYSTEM, referralPrompt, REPLY_SYSTEM, replyPrompt } from '@/lib/prompts';
import { checkForInjection } from '@/lib/injection';

export const maxDuration = 300;

const ON_FILE = ['the CV', 'the job link', 'the job ID', 'the LinkedIn profile'];

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

  if (body.action === 'send-request') {
    const { routes } = await jobView(job, user.id);
    const route = routes[0];
    await db.application.update({ where: { id: app.id }, data: { status: 'sent' } });
    await db.outreachEvent.create({
      data: {
        applicationId: app.id,
        kind: 'request',
        contactName: route?.name || 'Contact',
        contactInit: route?.init || '??',
        contactUrl: route?.profileUrl || null,
        org: `${job.company} · ${job.city}`,
        body: app.note,
        reason: route?.why || '',
        handled: true,
      },
    });
    return NextResponse.json({ ok: true, copy: app.note, open: route?.profileUrl || 'https://www.linkedin.com/search/results/people/' });
  }

  if (body.action === 'accepted') {
    const profile = await profileSummary(user.id);
    const request = await db.outreachEvent.findFirst({ where: { applicationId: app.id, kind: 'request' } });
    const name = request?.contactName || 'there';
    const { mode } = await detectMode();
    const message =
      mode === 'none'
        ? `Thanks for connecting, ${name.split(' ')[0]}! I am applying for ${job.role} at ${job.company}. I have spent [X] years on ${profile.headline}. Would you be comfortable referring me? I can send my CV and the job ID [JOB ID].`
        : (await askJson<{ message: string }>(REFERRAL_SYSTEM, referralPrompt(profile, job, name))).message;

    await db.application.update({ where: { id: app.id }, data: { status: 'accepted' } });
    await db.outreachEvent.create({
      data: {
        applicationId: app.id,
        kind: 'accepted',
        contactName: name,
        contactInit: request?.contactInit || '??',
        contactUrl: request?.contactUrl || null,
        org: `${job.company} · ${job.city}`,
        body: message,
      },
    });
    return NextResponse.json({ ok: true });
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

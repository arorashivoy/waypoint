import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { visibleTo } from '@/lib/job-scope';
import { profileSummary } from '@/lib/user';
import { handle, readJson } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { jobView } from '@/lib/analysis';
import { isAlumniRequest } from '@/lib/match';
import { INCOMING_MAX } from '@/lib/schemas';
import { enqueueOutreach, type OutreachPayload } from '@/lib/outreach';

/**
 * LinkedIn's API cannot send a connection request, send a message, or read the
 * inbox, and automating the site breaks the User Agreement. So every outbound
 * step here is: draft the text, hand it to the clipboard, open the profile, and
 * record what the user says happened. Nothing is sent by Waypoint.
 * The Claude calls run in the worker (kind `outreach`). The route returns `{ taskId }`.
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const job = await db.job.findFirstOrThrow({ where: { id: String(body.jobId ?? ''), ...visibleTo(user.id) } });
  const app = await db.application.upsert({
    where: { userId_jobId: { userId: user.id, jobId: job.id } },
    update: {},
    create: { userId: user.id, jobId: job.id },
  });
  // Each action that calls Claude runs in an `outreach` task. The route checks the input and queues the task.
  const queue = async (payload: Omit<OutreachPayload, 'applicationId'>) =>
    NextResponse.json({ taskId: await enqueueOutreach(user.id, { ...payload, applicationId: app.id }) });

  if (body.action === 'referral') {
    // Every route comes from Connections.csv, so the contact is already a
    // 1st-degree connection: there is no request to wait on, and the referral
    // ask goes straight into a message.
    const { routes } = await jobView(job, user.id);
    if (!routes[0]) return NextResponse.json({ error: `No 1st-degree connection at ${job.company} in your imported export.` }, { status: 404 });
    return queue({ action: 'referral' });
  }

  if (body.action === 'alumni') {
    // No connection at the company, so the ask goes to a stranger from the
    // same school. Waypoint cannot search LinkedIn for them (no API, and
    // scraping breaks the User Agreement), so it drafts the note, opens the
    // school's alumni list filtered to this company, and the user picks.
    const profile = await profileSummary(user.id);
    if (!profile.school) {
      return NextResponse.json({ error: 'No school on your profile. Add an education in your profile.' }, { status: 400 });
    }
    return queue({ action: 'note' });
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
    return queue({ action: 'referral', name, profileUrl });
  }

  if (body.action === 'replied') {
    return queue({ action: 'reply', incoming: String(body.incoming || '').slice(0, INCOMING_MAX) });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
});

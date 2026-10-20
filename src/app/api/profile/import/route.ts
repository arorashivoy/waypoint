import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle, HttpError } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { scrub } from '@/lib/log';
import { createDrafts, MAX_PENDING } from '@/lib/profile/drafts';
import { checkExportUpload, checkUploadLength, linkedinDrafts, parseExport } from '@/lib/linkedin-import';

export const maxDuration = 300;

/**
 * An archive makes drafts of the positions, education, projects, skills and
 * headline, and it refreshes the contacts. A bare Connections.csv refreshes
 * the contacts only. The import never changes the profile and never deletes
 * job analyses, because routes are ranked from live contacts on every view.
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  // formData() reads the whole body, so the size check must come first.
  checkUploadLength(req.headers);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

  const buf = await checkExportUpload(file);
  let parsed;
  try {
    parsed = parseExport(buf);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return NextResponse.json({ error: `Could not read that archive: ${scrub((e as Error).message)}` }, { status: 400 });
  }

  const userId = user.id;

  const drafts = parsed.archive ? linkedinDrafts(parsed, user.name) : [];
  if (!parsed.contacts.length && !drafts.length) {
    // Zero rows means the wrong file. An empty file must not erase the contacts.
    return NextResponse.json({ error: 'No connections or profile data found in that file. Upload Connections.csv or the full LinkedIn archive.' }, { status: 400 });
  }

  // Check the cap before any write, so a refused import changes nothing.
  const pending = await db.profileDraft.count({ where: { userId, status: 'pending' } });
  if (pending + drafts.length > MAX_PENDING) {
    throw new HttpError(409, 'You have too many drafts to review. Accept or reject some drafts, then import again.');
  }

  // Contacts are not profile claims, so they go in directly (spec 3.3). An
  // archive without Connections.csv keeps the contacts that exist, and keeps
  // the last count of them.
  const prev = await db.profileImport.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
  const profileCounts = Object.fromEntries(Object.entries(parsed.counts).filter(([k]) => k !== 'contacts'));
  const counts: Record<string, number> = { ...(prev ? JSON.parse(prev.counts) : {}), ...(parsed.archive ? profileCounts : {}) };
  if (parsed.contacts.length) counts.contacts = parsed.contacts.length;
  const record = await db.$transaction(async (tx) => {
    if (parsed.contacts.length) {
      await tx.contact.deleteMany({ where: { userId } });
      await tx.contact.createMany({ data: parsed.contacts.map((c) => ({ ...c, userId })) });
    }
    return tx.profileImport.create({ data: { userId, filename: file.name.slice(0, 200), counts: JSON.stringify(counts) } });
  });
  const made = drafts.length ? await createDrafts(userId, { batchId: record.id, source: 'linkedin', items: drafts }) : 0;
  return NextResponse.json({ ok: true, scope: parsed.archive ? 'full' : 'contacts', counts, drafts: made });
});

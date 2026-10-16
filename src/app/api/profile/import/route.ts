import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle, HttpError } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { checkExportUpload, checkUploadLength, parseExport } from '@/lib/linkedin-import';

export const maxDuration = 300;

/**
 * An upload refreshes the contacts of the user. A re-upload shows a contact
 * who left a company, or a new 1st-degree connection. Until the drafts of
 * Task 9, the positions, educations and skills of an archive are not stored.
 * Contacts never need a new analysis, because routes are ranked from live
 * contacts on every view.
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
    return NextResponse.json({ error: `Could not read that archive: ${(e as Error).message}` }, { status: 400 });
  }

  const userId = user.id;

  // Until the drafts of Task 9, an archive refreshes the contacts only.
  if (!parsed.contacts.length) {
    // Zero rows means the wrong file or an export requested without
    // connections; replacing with that would silently erase every route.
    return NextResponse.json({ error: 'No connections found in that file. Upload Connections.csv or the full LinkedIn archive.' }, { status: 400 });
  }
  const counts = { contacts: parsed.contacts.length };
  await db.$transaction([
    db.contact.deleteMany({ where: { userId } }),
    db.contact.createMany({ data: parsed.contacts.map((c) => ({ ...c, userId })) }),
    db.profileImport.create({ data: { userId, filename: file.name, counts: JSON.stringify(counts) } }),
  ]);
  return NextResponse.json({ ok: true, scope: 'contacts', counts });
});

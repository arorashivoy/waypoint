import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { parseExport } from '@/lib/linkedin-import';
import { loadClaims } from '@/lib/claims';

export const maxDuration = 300;

/**
 * A fresh export replaces the imported profile wholesale. That is what makes
 * "re-upload to refresh connections" work: a contact who left a company, or a
 * new 1st-degree connection, shows up on the next import.
 *
 * Only contacts are replaced when claims.yml is in force or the upload is a
 * bare Connections.csv. With claims.yml loaded the imported positions,
 * projects and skills are never read, so replacing them changes nothing, and
 * clearing every analysis for it would re-bill each job for a profile that did
 * not move. Contacts never need that: routes are ranked from live contacts on
 * every view, not stored in the analysis.
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

  let parsed;
  try {
    parsed = parseExport(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: `Could not read that archive: ${(e as Error).message}` }, { status: 400 });
  }

  const userId = user.id;

  if (!parsed.archive || loadClaims()) {
    // Zero rows means the wrong file or an export requested without
    // connections; replacing with that would silently erase every route.
    if (!parsed.contacts.length) {
      return NextResponse.json({ error: 'No connections found in that file. Upload Connections.csv or the full LinkedIn archive.' }, { status: 400 });
    }
    // Carried forward so the Profile screen does not report the untouched
    // positions and projects as zero.
    const prev = await db.profileImport.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const counts = { ...(prev ? JSON.parse(prev.counts) : {}), contacts: parsed.contacts.length };
    await db.$transaction([
      db.contact.deleteMany({ where: { userId } }),
      db.contact.createMany({ data: parsed.contacts.map((c) => ({ ...c, userId })) }),
      db.profileImport.create({ data: { userId, filename: file.name, counts: JSON.stringify(counts) } }),
    ]);
    return NextResponse.json({ ok: true, scope: 'contacts', counts });
  }

  await db.$transaction([
    db.position.deleteMany({ where: { userId } }),
    db.education.deleteMany({ where: { userId } }),
    db.projectItem.deleteMany({ where: { userId } }),
    db.skill.deleteMany({ where: { userId } }),
    db.contact.deleteMany({ where: { userId } }),
    db.position.createMany({ data: parsed.positions.map((p) => ({ ...p, userId })) }),
    db.education.createMany({ data: parsed.educations.map((e) => ({ ...e, userId })) }),
    db.projectItem.createMany({ data: parsed.projects.map((p) => ({ ...p, userId, tags: '' })) }),
    db.skill.createMany({ data: parsed.skills.map((name) => ({ name, userId })) }),
    db.contact.createMany({ data: parsed.contacts.map((c) => ({ ...c, userId })) }),
    db.profileImport.create({ data: { userId, filename: file.name, counts: JSON.stringify(parsed.counts) } }),
    // Analyses were graded against the old profile, so they are stale now.
    db.jobAnalysis.deleteMany({ where: { userId } }),
  ]);

  return NextResponse.json({ ok: true, scope: 'full', counts: parsed.counts });
});

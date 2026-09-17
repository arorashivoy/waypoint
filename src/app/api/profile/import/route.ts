import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/user';
import { parseExport } from '@/lib/linkedin-import';

export const maxDuration = 300;

/**
 * A fresh export replaces the imported profile wholesale. That is what makes
 * "re-upload to refresh connections" work: a contact who left a company, or a
 * new 1st-degree connection, shows up on the next import.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
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
    db.job.updateMany({ data: { analysis: null } }),
  ]);

  return NextResponse.json({ ok: true, counts: parsed.counts });
}

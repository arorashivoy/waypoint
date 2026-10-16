import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError } from '@/lib/auth/http';
import { checkYaml, diffDocs } from '@/lib/profile/doc';
import { createDrafts } from '@/lib/profile/drafts';
import { loadProfileDoc } from '@/lib/profile/store';
import { MAX_YAML_BYTES, readFormFile, sniffYaml } from '@/lib/uploads';

/**
 * Imports a claims.yml as one draft (spec 3.3). The reply shows the diff
 * against the current profile. If the user accepts the draft, it replaces the
 * whole profile, and saveProfile writes a revision of the state before.
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const { buf, type } = await readFormFile(req, MAX_YAML_BYTES, 'The file is larger than 1 MB.');
  const check = checkYaml(sniffYaml(buf, type));
  if (!check.doc) throw new HttpError(422, 'The file has errors. Nothing was imported.', { errors: check.errors.slice(0, 50) });

  // One YAML import waits at a time, so the user does not compare two full profiles.
  await db.profileDraft.updateMany({ where: { userId: user.id, type: 'profile', status: 'pending' }, data: { status: 'rejected' } });
  const drafts = await createDrafts(user.id, { batchId: randomUUID(), source: 'yaml', items: [{ type: 'profile', data: check.doc }] });
  return NextResponse.json({ ok: true, drafts, diff: diffDocs(await loadProfileDoc(user.id), check.doc), warnings: check.warnings });
});

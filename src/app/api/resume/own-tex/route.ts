import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { HttpError, handle } from '@/lib/auth/http';
import { checkOwnTex, hasOwnTex, MAX_TEX_BYTES, removeOwnTex, saveOwnTex } from '@/lib/resume/own-tex';
import { getSettings } from '@/lib/settings';
import { readFormFile, sniffTex } from '@/lib/uploads';

async function answer(userId: string) {
  const s = await getSettings(userId);
  return NextResponse.json({ mode: s.resumeMode, hasOwnTex: hasOwnTex(userId) });
}

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return answer(user.id);
});

/**
 * Uploads the own résumé source (.tex, 1 MB or less). The route saves the file only after every check passes.
 * A refused file leaves the old file as it was.
 */
export const PUT = handle(async (req) => {
  const user = await requireUser(req);
  const upload = await readFormFile(req, MAX_TEX_BYTES, 'The file is larger than 1 MB.');
  const text = sniffTex(upload.name, upload.type, upload.buf);
  const check = checkOwnTex(text);
  if (!check.ok) throw new HttpError(400, `The file was refused. ${check.reasons.join(' ')}`, { reasons: check.reasons });
  await saveOwnTex(user.id, text);
  return answer(user.id);
});

export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  await removeOwnTex(user.id);
  return answer(user.id);
});

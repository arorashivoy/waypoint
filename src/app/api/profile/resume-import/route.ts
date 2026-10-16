import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError } from '@/lib/auth/http';
import { hitLimit } from '@/lib/auth/rate-limit';
import { NoCredentialError } from '@/lib/claude';
import { importResume } from '@/lib/profile/resume-import';
import { MAX_RESUME_BYTES, readFormFile } from '@/lib/uploads';

export const maxDuration = 300;

const DAY = 24 * 60 * 60_000;

/** Uploads a résumé (PDF or .tex, 10 MB or less). Claude drafts the profile items; the user accepts them in the Imports tab. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const limit = await hitLimit(`resume-import:${user.id}`, 10, DAY);
  if (!limit.ok) throw new HttpError(429, 'You imported 10 résumés in the last 24 hours. Try again later.');
  const upload = await readFormFile(req, MAX_RESUME_BYTES, 'The file is larger than 10 MB.');
  try {
    return NextResponse.json({ ok: true, ...(await importResume(user.id, upload)) });
  } catch (e) {
    if (e instanceof NoCredentialError) throw new HttpError(409, e.message);
    throw e;
  }
});

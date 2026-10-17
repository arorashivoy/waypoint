import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError } from '@/lib/auth/http';
import { hitLimit } from '@/lib/auth/rate-limit';
import { NoCredentialError, credentialFor } from '@/lib/claude';
import { checkResumeUpload } from '@/lib/profile/resume-import';
import { enqueue } from '@/lib/tasks/queue';
import { MAX_RESUME_BYTES, readFormFile } from '@/lib/uploads';
import { userDir } from '@/lib/user-files';

const DAY = 24 * 60 * 60_000;

/**
 * Uploads a résumé (PDF or .tex, 10 MB or less). The route checks the file, saves it and queues a task.
 * The worker asks Claude for the drafts; the user accepts them in the Imports tab.
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const limit = await hitLimit(`resume-import:${user.id}`, 10, DAY);
  if (!limit.ok) throw new HttpError(429, 'You imported 10 résumés in the last 24 hours. Try again later.');
  const upload = await readFormFile(req, MAX_RESUME_BYTES, 'The file is larger than 10 MB.');
  const type = await checkResumeUpload(user.id, upload);
  // No credential: refuse now, before a file is saved or a task is made. The handler checks again when it runs.
  if (!(await credentialFor(user.id))) throw new HttpError(409, new NoCredentialError().message);
  // The file waits in the user's folder under a name that the server makes. The task holds only that name.
  const file = `${randomBytes(12).toString('hex')}.${type}`;
  const path = join(userDir(user.id, 'imports'), file);
  writeFileSync(path, upload.buf, { mode: 0o600 });
  try {
    const { id } = await enqueue({ kind: 'resume-import', userId: user.id, payload: { file, type } });
    return NextResponse.json({ taskId: id });
  } catch (e) {
    rmSync(path, { force: true });
    throw e;
  }
});

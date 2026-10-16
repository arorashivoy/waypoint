import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { hitLimit } from '@/lib/auth/rate-limit';
import { NoCredentialError } from '@/lib/claude';
import { importRepos } from '@/lib/profile/github-import';

export const maxDuration = 300;

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const repos = body.repos;
  if (!Array.isArray(repos) || repos.length < 1 || repos.length > 10 || repos.some((r) => typeof r !== 'string' || r.length > 100)) {
    throw new HttpError(400, 'Select 1 to 10 repositories.');
  }
  const limit = await hitLimit(`github-import:${user.id}`, 20, 24 * 60 * 60_000);
  if (!limit.ok) throw new HttpError(429, 'You ran 20 GitHub imports in the last 24 hours. Try again later.');
  try {
    return NextResponse.json({ ok: true, ...(await importRepos(user.id, username, [...new Set(repos as string[])])) });
  } catch (e) {
    if (e instanceof NoCredentialError) throw new HttpError(409, e.message);
    throw e;
  }
});

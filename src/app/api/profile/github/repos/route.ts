import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { hitLimit } from '@/lib/auth/rate-limit';
import { listRepos } from '@/lib/github';

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const limit = await hitLimit(`github-list:${user.id}`, 30, 60 * 60_000);
  if (!limit.ok) throw new HttpError(429, 'Too many GitHub lists in one hour. Try again later.');
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  return NextResponse.json({ repos: await listRepos(user.id, username) });
});

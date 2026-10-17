import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { hitLimit } from '@/lib/auth/rate-limit';
import { checkRepos } from '@/lib/profile/github-import';
import { enqueue } from '@/lib/tasks/queue';

export const maxDuration = 300;

/** Checks the repo names, then queues one task for each repo. The client waits for all the tasks. */
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
  const names = await checkRepos(user.id, username, [...new Set(repos as string[])]);
  const ids = new Set<string>();
  for (const repo of names) {
    const { id } = await enqueue({ kind: 'github-import', userId: user.id, payload: { username, repo }, dedupeKey: `github:${user.id}:${repo.toLowerCase()}` });
    ids.add(id);
  }
  return NextResponse.json({ taskIds: [...ids] });
});

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { secretDelete, secretHint, secretWrite } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

const TOKEN = /^(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$/;

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json({ hint: await secretHint(user.id, 'github') });
});

/** Saves the user's GitHub token, encrypted. A new token clears the cache, which can hold private repo data. */
export const PUT = handle(async (req) => {
  const user = await requireUser(req);
  const token = String((await readJson(req)).token ?? '').trim();
  if (!TOKEN.test(token)) throw new HttpError(400, 'This is not a GitHub token. A token starts with "ghp_" or "github_pat_".');
  // One transaction: a failed cache clear must not leave the new token with the cache of the old one.
  await db.$transaction([secretWrite(user.id, 'github', token), db.githubCache.deleteMany({ where: { userId: user.id } })]);
  return NextResponse.json({ hint: await secretHint(user.id, 'github') });
});

export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  await db.$transaction([secretDelete(user.id, 'github'), db.githubCache.deleteMany({ where: { userId: user.id } })]);
  return NextResponse.json({ hint: null });
});

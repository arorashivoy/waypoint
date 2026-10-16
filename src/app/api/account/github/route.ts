import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { deleteSecret, saveSecret, secretHint } from '@/lib/secrets';

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
  await saveSecret(user.id, 'github', token);
  await db.githubCache.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ hint: await secretHint(user.id, 'github') });
});

export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  await deleteSecret(user.id, 'github');
  await db.githubCache.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ hint: null });
});

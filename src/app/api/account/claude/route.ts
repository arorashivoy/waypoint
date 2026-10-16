import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { claudeStatus, clearFailures, forgetClient } from '@/lib/claude';
import { deleteSecret, readSecret, saveSecret } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

const KEY = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;

/** Drops the cached API client of the old key, so the old key does not stay in memory. */
async function forgetOldClient(userId: string) {
  const old = await readSecret(userId, 'anthropic');
  if (old) forgetClient(old);
}

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json(await claudeStatus(user.id));
});

/** Saves the user's own Anthropic API key, encrypted. The reply holds only the last 4 characters. */
export const PUT = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!KEY.test(key)) throw new HttpError(400, 'This is not an Anthropic API key. A key starts with "sk-ant-".');
  await forgetOldClient(user.id);
  await saveSecret(user.id, 'anthropic', key);
  clearFailures(`own:${user.id}`);
  return NextResponse.json(await claudeStatus(user.id));
});

export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  await forgetOldClient(user.id);
  await deleteSecret(user.id, 'anthropic');
  clearFailures(`own:${user.id}`);
  return NextResponse.json(await claudeStatus(user.id));
});

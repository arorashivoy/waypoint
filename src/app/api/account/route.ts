import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { verifyPassword } from '@/lib/auth/password';
import { FIFTEEN_MINUTES, hitLimit } from '@/lib/auth/rate-limit';
import { clearSessionCookie } from '@/lib/auth/session';
import { removeUserDir } from '@/lib/user-files';
import { log } from '@/lib/log';

/**
 * Deletes the signed-in user and all their data (spec 7.6, Data). The rows go
 * through the cascades of the schema, and the files in data/users/<userId>/
 * go too. The admin cannot delete the admin account here.
 */
export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  if (user.role === 'admin') throw new HttpError(409, 'The admin account cannot be deleted here.');
  const limit = await hitLimit(`delete-account:${user.id}`, 5, FIFTEEN_MINUTES);
  if (!limit.ok) throw new HttpError(429, 'Too many tries. Try again in 15 minutes.');
  const body = await readJson(req);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) throw new HttpError(400, 'The password is not correct.');
  // deleteMany: a second request in a double submit finds no row and does not fail.
  // Each rate-limit key of a user ends with ":<user id>" (for example "resume-import:<id>").
  // The match on that ending cannot hit the key of another user: an ID is a cuid.
  await db.$transaction([
    db.rateLimit.deleteMany({ where: { key: { endsWith: `:${user.id}` } } }),
    db.user.deleteMany({ where: { id: user.id } }),
  ]);
  try {
    removeUserDir(user.id);
  } catch (e) {
    // The account is gone already. A file error must not give a 500 or keep the cookie.
    log.error({ err: e }, 'could not remove the user folder of a deleted account');
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, req);
  return res;
});

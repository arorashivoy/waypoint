import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { verifyPassword } from '@/lib/auth/password';
import { FIFTEEN_MINUTES, hitLimit } from '@/lib/auth/rate-limit';
import { setPassword } from '@/lib/auth/users';

/** A change of password ends all other sessions of the user (spec 2.1). */
export const POST = handle(async (req) => {
  const { user, session } = await requireSession(req);
  const body = await readJson(req);
  const limit = await hitLimit(`password:user:${user.id}`, 10, FIFTEEN_MINUTES);
  if (!limit.ok) throw new HttpError(429, 'Too many tries. Try again later.');
  const current = typeof body.current === 'string' ? body.current : '';
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) throw new HttpError(400, 'The current password is not correct.');
  await setPassword(user.id, typeof body.next === 'string' ? body.next : '', session.id);
  return NextResponse.json({ ok: true });
});

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { burnPasswordCheck, verifyPassword } from '@/lib/auth/password';
import { clearLimit, clientIp, FIFTEEN_MINUTES, hitLimit } from '@/lib/auth/rate-limit';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { normEmail } from '@/lib/auth/users';

const WRONG = 'The email or password is not correct.';

export const POST = handle(async (req) => {
  const body = await readJson(req);
  const email = normEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  const byIp = await hitLimit(`login:ip:${clientIp(req.headers)}`, 10, FIFTEEN_MINUTES);
  const byEmail = await hitLimit(`login:email:${email}`, 10, FIFTEEN_MINUTES);
  if (!byIp.ok || !byEmail.ok) {
    const mins = Math.max(1, Math.ceil(Math.max(byIp.retryAfterSec, byEmail.retryAfterSec) / 60));
    throw new HttpError(429, `Too many tries. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }

  const user = email ? await db.user.findUnique({ where: { email } }) : null;
  let ok = false;
  if (user?.passwordHash) ok = await verifyPassword(user.passwordHash, password);
  else await burnPasswordCheck(password);
  // A disabled user gets the same answer, so the response does not show the account state.
  if (!user || !ok || user.disabledAt) throw new HttpError(401, WRONG);

  await clearLimit(`login:email:${email}`);
  const token = await createSession(user.id, req.headers.get('user-agent'));
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, token, req);
  return res;
});

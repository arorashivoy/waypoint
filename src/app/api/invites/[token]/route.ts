import { NextResponse } from 'next/server';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { inspectToken, redeemInvite, redeemReset } from '@/lib/auth/invites';
import { clientIp, FIFTEEN_MINUTES, hitLimit } from '@/lib/auth/rate-limit';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { requireTurnstile } from '@/lib/auth/turnstile';

type Ctx = { params: { token: string } };

/** 20 tries in 15 minutes for each IP address, for the GET and the POST together. */
async function limit(req: Request) {
  const r = await hitLimit(`token:ip:${clientIp(req.headers)}`, 20, FIFTEEN_MINUTES);
  if (!r.ok) throw new HttpError(429, `Too many tries. Try again in ${Math.max(1, Math.ceil(r.retryAfterSec / 60))} minutes.`);
}

const GONE = 'This link is not valid. It expired or was used. Ask the admin for a new link.';

export const GET = handle<Ctx>(async (req, { params }) => {
  await limit(req);
  const info = await inspectToken(params.token);
  if (!info) throw new HttpError(404, GONE);
  return NextResponse.json(info);
});

export const POST = handle<Ctx>(async (req, { params }) => {
  await limit(req);
  const body = await readJson(req);
  await requireTurnstile(body.turnstile, clientIp(req.headers));
  const info = await inspectToken(params.token);
  if (!info) throw new HttpError(404, GONE);
  const user = info.kind === 'invite' ? await redeemInvite(params.token, body as { email?: unknown; name: unknown; password: unknown }) : await redeemReset(params.token, body.password);
  const token = await createSession(user.id, req.headers.get('user-agent'));
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, token, req);
  return res;
});

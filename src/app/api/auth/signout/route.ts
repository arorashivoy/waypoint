import { NextResponse } from 'next/server';
import { handle } from '@/lib/auth/http';
import { clearSessionCookie, endSession, readSession } from '@/lib/auth/session';

export const POST = handle(async (req) => {
  const s = await readSession(req);
  if (s) await endSession(s.session.id);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, req);
  return res;
});

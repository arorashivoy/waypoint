import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { handle, HttpError } from '@/lib/auth/http';
import { clearSessionCookie } from '@/lib/auth/session';

export const DELETE = handle<{ params: { id: string } }>(async (req, { params }) => {
  const { user, session } = await requireSession(req);
  const r = await db.session.deleteMany({ where: { id: params.id, userId: user.id } });
  if (r.count === 0) throw new HttpError(404, 'Not found.');
  const res = NextResponse.json({ ok: true });
  if (params.id === session.id) clearSessionCookie(res, req);
  return res;
});

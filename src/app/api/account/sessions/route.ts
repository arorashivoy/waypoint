import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { handle } from '@/lib/auth/http';
import { clearSessionCookie, endUserSessions } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const { user, session } = await requireSession(req);
  const rows = await db.session.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: 'desc' } });
  const sessions = rows.map((s) => ({
    id: s.id,
    current: s.id === session.id,
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
  }));
  return NextResponse.json({ sessions });
});

/** Signs out everywhere, this browser too. */
export const DELETE = handle(async (req) => {
  const { user } = await requireSession(req);
  await endUserSessions(user.id);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, req);
  return res;
});

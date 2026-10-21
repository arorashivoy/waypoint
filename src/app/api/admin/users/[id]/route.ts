import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { endUserSessions } from '@/lib/auth/session';

export const PATCH = handle<{ params: { id: string } }>(async (req, { params }) => {
  await requireAdmin(req);
  const body = await readJson(req);
  if (typeof body.disabled !== 'boolean') throw new HttpError(400, 'Send { "disabled": true } or { "disabled": false }.');
  const target = await db.user.findUnique({ where: { id: params.id } });
  if (!target) throw new HttpError(404, 'Not found.');
  if (target.role === 'admin') throw new HttpError(400, 'You cannot disable an admin account.');
  await db.user.update({ where: { id: target.id }, data: { disabledAt: body.disabled ? new Date() : null } });
  if (body.disabled) await endUserSessions(target.id);
  return NextResponse.json({ ok: true });
});

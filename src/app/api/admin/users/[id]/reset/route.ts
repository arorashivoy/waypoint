import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { handle, HttpError } from '@/lib/auth/http';
import { createReset, INVITE_MS } from '@/lib/auth/invites';
import { publicBase } from '@/lib/auth/origin';

export const POST = handle<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireAdmin(req);
  if (!(await db.user.findUnique({ where: { id: params.id } }))) throw new HttpError(404, 'Not found.');
  const token = await createReset(admin.id, params.id);
  return NextResponse.json({ url: `${publicBase(req)}/reset/${token}`, expiresAt: new Date(Date.now() + INVITE_MS).toISOString() });
});

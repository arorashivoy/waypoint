import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { handle, readJson } from '@/lib/auth/http';
import { createInvite, INVITE_MS } from '@/lib/auth/invites';
import { publicBase } from '@/lib/auth/origin';

export const POST = handle(async (req) => {
  const admin = await requireAdmin(req);
  const body = await readJson(req);
  const email = typeof body.email === 'string' && body.email.trim() ? body.email : null;
  const token = await createInvite(admin.id, email);
  return NextResponse.json({ url: `${publicBase(req)}/invite/${token}`, expiresAt: new Date(Date.now() + INVITE_MS).toISOString() });
});

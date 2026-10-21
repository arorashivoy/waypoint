import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, type RouteContext } from '@/lib/auth/http';
import { approveWarnings } from '@/lib/profile/drafts';

export const POST = handle(async (req, { params }: RouteContext) => {
  const user = await requireUser(req);
  await approveWarnings(user.id, params.id);
  return NextResponse.json({ ok: true });
});

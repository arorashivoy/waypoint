import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle } from '@/lib/auth/http';
import { listDrafts } from '@/lib/profile/drafts';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json({ drafts: await listDrafts(user.id) });
});

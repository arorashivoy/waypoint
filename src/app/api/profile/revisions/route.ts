import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle } from '@/lib/auth/http';
import { listRevisions } from '@/lib/profile/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json({ revisions: await listRevisions(user.id) });
});

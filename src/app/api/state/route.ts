import { NextResponse } from 'next/server';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { buildState } from '@/lib/state';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json({ signedIn: true, ...(await buildState(user.id)) });
});

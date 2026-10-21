import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, readJson } from '@/lib/auth/http';
import { readIds, rejectDrafts } from '@/lib/profile/drafts';

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const rejected = await rejectDrafts(user.id, readIds(await readJson(req)));
  return NextResponse.json({ ok: true, rejected });
});

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, readJson, type RouteContext } from '@/lib/auth/http';
import { editDraft } from '@/lib/profile/drafts';

export const PUT = handle(async (req, { params }: RouteContext) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  return NextResponse.json({ draft: await editDraft(user.id, params.id, body.data) });
});

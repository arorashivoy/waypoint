import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, readJson } from '@/lib/auth/http';
import { acceptDrafts, readIds } from '@/lib/profile/drafts';

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const ids = readIds(await readJson(req));
  const r = await acceptDrafts(user.id, ids);
  return NextResponse.json({ ok: true, warnings: r.warnings });
});

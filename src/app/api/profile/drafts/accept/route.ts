import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, readJson } from '@/lib/auth/http';
import { acceptDrafts, readIds } from '@/lib/profile/drafts';
import { readVersion } from '@/lib/profile/editor';

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const version = readVersion(req, body);
  const r = await acceptDrafts(user.id, readIds(body), version);
  return NextResponse.json({ ok: true, warnings: r.warnings });
});

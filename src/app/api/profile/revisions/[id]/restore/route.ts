import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, type RouteContext } from '@/lib/auth/http';
import { loadProfileDoc, restoreRevision } from '@/lib/profile/store';

export const POST = handle(async (req, { params }: RouteContext) => {
  const user = await requireUser(req);
  const r = await restoreRevision(user.id, params.id);
  return NextResponse.json({ ok: true, warnings: r.warnings, version: r.version, doc: await loadProfileDoc(user.id) });
});

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, readJson, type RouteContext } from '@/lib/auth/http';
import { readVersion } from '@/lib/profile/editor';
import { loadProfileDoc, restoreRevision } from '@/lib/profile/store';

export const POST = handle(async (req, { params }: RouteContext) => {
  const user = await requireUser(req);
  const version = readVersion(req, await readJson(req));
  const r = await restoreRevision(user.id, params.id, version);
  return NextResponse.json({ ok: true, warnings: r.warnings, version: r.version, doc: await loadProfileDoc(user.id) });
});

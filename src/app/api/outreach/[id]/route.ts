import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle, readJson } from '@/lib/auth/http';
import { refuseUserRequest } from '@/lib/injection';
import { requireUser } from '@/lib/auth/guard';

export const PATCH = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const data: { handled?: boolean; body?: string } = {};
  if (body.handled !== undefined) data.handled = !!body.handled;
  if (typeof body.body === 'string') {
    // The user's own edit. Refuse an unsafe text before it is saved.
    const reason = refuseUserRequest(body.body);
    if (reason) return NextResponse.json({ error: `Waypoint did not send this request, because ${reason}.` }, { status: 400 });
    data.body = body.body.slice(0, 4000);
  }

  const existing = await db.outreachEvent.findFirst({
    where: { id: params.id, application: { userId: user.id } },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const event = await db.outreachEvent.update({ where: { id: existing.id }, data });
  return NextResponse.json({ ok: true, copy: event.body, open: event.contactUrl });
});

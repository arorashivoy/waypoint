import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/user';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const body = await req.json();
  const data: { handled?: boolean; body?: string } = {};
  if (body.handled !== undefined) data.handled = !!body.handled;
  if (typeof body.body === 'string') data.body = body.body.slice(0, 4000);

  const existing = await db.outreachEvent.findFirst({
    where: { id: params.id, application: { userId: user.id } },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const event = await db.outreachEvent.update({ where: { id: existing.id }, data });
  return NextResponse.json({ ok: true, copy: event.body, open: event.contactUrl });
}

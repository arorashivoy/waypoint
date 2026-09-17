import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/user';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const body = await req.json();
  const data: { handled?: boolean; body?: string } = {};
  if (body.handled !== undefined) data.handled = !!body.handled;
  if (typeof body.body === 'string') data.body = body.body.slice(0, 4000);
  const event = await db.outreachEvent.update({ where: { id: params.id }, data });
  return NextResponse.json({ ok: true, copy: event.body, open: event.contactUrl });
}

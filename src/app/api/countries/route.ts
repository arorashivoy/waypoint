import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/user';

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const { cc, on } = await req.json();
  await db.countryPref.update({ where: { userId_cc: { userId: user.id, cc } }, data: { on: !!on } });
  return NextResponse.json({ ok: true });
}

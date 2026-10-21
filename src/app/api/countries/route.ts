import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const { cc, on } = await readJson(req);
  if (typeof cc !== 'string') throw new HttpError(400, 'Send the country code as a string.');
  const { count } = await db.countryPref.updateMany({ where: { userId: user.id, cc }, data: { on: !!on } });
  if (!count) throw new HttpError(404, 'Not found.');
  return NextResponse.json({ ok: true });
});

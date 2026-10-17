import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/** The job boards whose last fetch failed. All users share the boards. */
export const GET = handle(async (req) => {
  await requireUser(req);
  const rows = await db.feedFetch.findMany({ where: { status: 'failed' }, orderBy: { board: 'asc' } });
  return NextResponse.json(rows.map((r) => ({ board: r.board, status: r.status, fetchedAt: r.fetchedAt, error: r.error })));
});

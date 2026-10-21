import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/** An Adzuna key ends with a search query from the profile of one user. Other users must not see it. */
const shownBoard = (board: string) => (board.startsWith('adzuna:') ? board.split(':').slice(0, 2).join(':') : board);

/** The job boards whose last fetch failed. All users share the boards. */
export const GET = handle(async (req) => {
  await requireUser(req);
  const rows = await db.feedFetch.findMany({ where: { status: 'failed' }, orderBy: { fetchedAt: 'desc' } });
  // Rows with the same shown key become one row. The newest row comes first, so it wins.
  const out = new Map<string, { board: string; status: string; fetchedAt: Date; error: string | null }>();
  for (const r of rows) {
    const board = shownBoard(r.board);
    if (!out.has(board)) out.set(board, { board, status: r.status, fetchedAt: r.fetchedAt, error: r.error });
  }
  return NextResponse.json([...out.values()].sort((a, b) => a.board.localeCompare(b.board)));
});

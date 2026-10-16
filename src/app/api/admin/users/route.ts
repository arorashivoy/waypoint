import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { handle } from '@/lib/auth/http';
import { sharedSpendByUser } from '@/lib/claude/usage';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireAdmin(req);
  const [rows, spend] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, role: true, disabledAt: true, createdAt: true, sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: 'desc' }, take: 1 } },
    }),
    sharedSpendByUser(),
  ]);
  const users = rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    disabled: !!u.disabledAt,
    createdAt: u.createdAt.toISOString(),
    lastSeenAt: u.sessions[0]?.lastSeenAt.toISOString() ?? null,
    sharedSpentUsd: spend.get(u.id) ?? 0,
  }));
  return NextResponse.json({ users });
});

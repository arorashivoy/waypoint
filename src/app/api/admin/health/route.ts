import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { handle } from '@/lib/auth/http';
import { overall, runChecks } from '@/lib/health';

export const dynamic = 'force-dynamic';

/** Admin only. The checks with detail text, and the task counts over all users (no user data). */
export const GET = handle(async (req) => {
  await requireAdmin(req);
  const checks = await runChecks();
  const count = (status: string) => db.task.count({ where: { status } });
  const [queued, running, failed] = await Promise.all([count('queued'), count('running'), count('failed')]);
  return NextResponse.json({ status: overall(checks), checks, tasks: { queued, running, failed } });
});

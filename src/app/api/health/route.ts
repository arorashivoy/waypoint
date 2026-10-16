import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

/** Public. scripts/remote.sh uses it to prove that the tunnel reaches this app. */
export const GET = handle(async () => {
  await db.$queryRawUnsafe('SELECT 1');
  return NextResponse.json({ app: 'waypoint', status: 'ok' });
});

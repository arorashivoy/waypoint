import { NextResponse } from 'next/server';
import { handle } from '@/lib/auth/http';
import { overall, runChecks } from '@/lib/health';

export const dynamic = 'force-dynamic';

const word = (ok: boolean) => (ok ? 'ok' : 'degraded');

/**
 * Public. scripts/remote.sh uses it to prove that the tunnel reaches this app.
 * The reply has no detail text, no names and no versions. It is always 200
 * while the process answers.
 */
export const GET = handle(async () => {
  const c = await runChecks();
  return NextResponse.json({
    app: 'waypoint',
    status: overall(c),
    checks: { db: word(c.db.ok), worker: word(c.worker.ok), claude: word(c.claude.ok), disk: word(c.disk.ok) },
  });
});

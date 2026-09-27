import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { ensureUser, SESSION_COOKIE } from '@/lib/user';
import { checkAccessCode, clientKey } from '@/lib/access';

/**
 * Opens the single local account. Guarded by WAYPOINT_ACCESS_CODE whenever one
 * is set, because this endpoint is the whole front door: past it sit the
 * imported LinkedIn connections, the CV, and the ability to spend a paid Claude
 * subscription.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const gate = checkAccessCode(body?.code, clientKey(req.headers));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const user = await ensureUser(
    process.env.WAYPOINT_EMAIL || 'you@local',
    process.env.WAYPOINT_NAME || 'Your Name',
  );

  // Behind a tunnel the browser speaks https even though Next sees plain http,
  // so trust the forwarded protocol when deciding to mark the cookie Secure.
  const https = req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:';
  cookies().set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: https,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.json({ ok: true });
}

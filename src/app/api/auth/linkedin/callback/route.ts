import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { ensureUser, SESSION_COOKIE } from '@/lib/user';

/**
 * OpenID Connect returns name, email and picture, and nothing more — no
 * experience, no connections. Everything else comes from the data export.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state || state !== cookies().get('wp_oidc_state')?.value) {
    return NextResponse.redirect(new URL('/?auth=failed', req.url));
  }

  const token = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.LINKEDIN_CLIENT_ID as string,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET as string,
      redirect_uri: process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3117/api/auth/linkedin/callback',
    }),
  }).then((r) => r.json());

  if (!token.access_token) return NextResponse.redirect(new URL('/?auth=failed', req.url));

  const me = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` },
  }).then((r) => r.json());

  const user = await ensureUser(me.email || 'you@local', me.name || 'You', me.picture);
  cookies().set(SESSION_COOKIE, user.id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  cookies().delete('wp_oidc_state');
  return NextResponse.redirect(new URL('/', req.url));
}

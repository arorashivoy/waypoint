import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';

export function GET() {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'LinkedIn OIDC is not configured' }, { status: 400 });
  const state = randomBytes(16).toString('hex');
  cookies().set('wp_oidc_state', state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3117/api/auth/linkedin/callback');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'openid profile email');
  return NextResponse.redirect(url.toString());
}

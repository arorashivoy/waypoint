import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { sameOrigin } from '@/lib/auth/origin';

/**
 * Two jobs, and nothing that needs the database:
 * 1. Refuse a cross-origin POST, PUT, PATCH or DELETE to /api/ (CSRF).
 * 2. Send a page request without a session cookie to /login.
 * The route handlers check the session itself (requireUser).
 */

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_PAGES = [/^\/login$/, /^\/invite\/[^/]+$/, /^\/reset\/[^/]+$/];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (WRITES.has(req.method) && !sameOrigin(req)) {
      return NextResponse.json({ error: 'This request came from another site. It was refused.' }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (PUBLIC_PAGES.some((r) => r.test(pathname))) return NextResponse.next();
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const login = new URL('/login', req.url);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};

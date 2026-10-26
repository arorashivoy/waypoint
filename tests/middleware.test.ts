import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';

const run = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  middleware(new NextRequest(new URL(path, 'http://localhost:3117'), { method: init.method ?? 'GET', headers: { host: 'localhost:3117', ...init.headers } }));

const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';

describe('middleware', () => {
  it('sends a signed-out page request to /login', () => {
    const res = run('/');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3117/login?next=%2F');
  });

  it('lets a page request with a session cookie through', () => {
    expect(passes(run('/', { headers: { cookie: `${SESSION_COOKIE}=abc` } }))).toBe(true);
  });

  it('redirects to the public host behind a tunnel', () => {
    const res = middleware(new NextRequest(new URL('/', 'http://localhost:3118'), { headers: { host: 'localhost:3118', 'x-forwarded-host': 'waypoint.example.com', 'x-forwarded-proto': 'https' } }));
    expect(res.headers.get('location')).toBe('https://waypoint.example.com/login?next=%2F');
  });

  it('redirects to WAYPOINT_PUBLIC_URL when it is set', () => {
    vi.stubEnv('WAYPOINT_PUBLIC_URL', 'https://waypoint.example.com');
    try {
      const res = middleware(new NextRequest(new URL('/jobs', 'http://localhost:3118'), { headers: { host: 'localhost:3118' } }));
      expect(res.headers.get('location')).toBe('https://waypoint.example.com/login?next=%2Fjobs');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not redirect files from public/', () => {
    expect(passes(run('/icon.png'))).toBe(true);
    expect(passes(run('/manifest.webmanifest'))).toBe(true);
  });

  it('lets the public pages through', () => {
    expect(passes(run('/login'))).toBe(true);
    expect(passes(run('/invite/abc'))).toBe(true);
    expect(passes(run('/reset/abc'))).toBe(true);
  });

  it('lets API reads through; the route checks the session', () => {
    expect(passes(run('/api/me'))).toBe(true);
  });

  it('refuses a cross-origin write', async () => {
    const res = run('/api/jobs/refresh', { method: 'POST', headers: { origin: 'https://evil.test' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'This request came from another site. It was refused.' });
  });

  it('refuses a write with no Origin', () => {
    expect(run('/api/auth/login', { method: 'POST' }).status).toBe(403);
  });

  it('lets a same-origin write through', () => {
    expect(passes(run('/api/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3117' } }))).toBe(true);
  });

  it('accepts the public URL', () => {
    vi.stubEnv('WAYPOINT_PUBLIC_URL', 'https://waypoint.example.com');
    try {
      const res = run('/api/countries', { method: 'POST', headers: { origin: 'https://waypoint.example.com', host: 'localhost:3118' } });
      expect(passes(res)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

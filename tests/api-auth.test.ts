import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

// All test files share one database. A test that fills the real "login:all"
// row would refuse the sign-in tests of other files, so this file sends that
// key to its own row and records the max and the window the route asks for.
const globalLimit = vi.hoisted(() => ({ key: `login:all:test-${Math.random().toString(36).slice(2)}`, calls: [] as [number, number][] }));
vi.mock('@/lib/auth/rate-limit', async (orig) => {
  const real = await orig<typeof import('@/lib/auth/rate-limit')>();
  return {
    ...real,
    hitLimit: (key: string, max: number, windowMs: number, now?: Date) => {
      if (key !== 'login:all') return real.hitLimit(key, max, windowMs, now);
      globalLimit.calls.push([max, windowMs]);
      return real.hitLimit(globalLimit.key, max, windowMs, now);
    },
  };
});
import { db } from '@/lib/db';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as signout } from '@/app/api/auth/signout/route';
import { GET as state } from '@/app/api/state/route';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { FIFTEEN_MINUTES, hitLimit } from '@/lib/auth/rate-limit';
import { cookieFrom, ctx, makeUser, request, TEST_PASSWORD } from './helpers/http';

const ip = () => `198.51.100.${Math.floor(Math.random() * 250)}-${randomBytes(3).toString('hex')}`;
const tryLogin = (email: string, password: string, from = ip()) =>
  login(request('/api/auth/login', { method: 'POST', body: { email, password }, headers: { 'x-forwarded-for': from } }), ctx());

describe('POST /api/auth/login', () => {
  it('signs in and sets a safe cookie', async () => {
    const { user } = await makeUser();
    const res = await tryLogin(user.email, TEST_PASSWORD);
    expect(res.status).toBe(200);
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain(`${SESSION_COOKIE}=`);
    expect(set.toLowerCase()).toContain('httponly');
    expect(set.toLowerCase()).toContain('samesite=lax');
    expect(set).toContain('Path=/');
    expect(set).not.toContain(user.id);
    const token = cookieFrom(res)!;
    const s = await state(request('/api/state', { cookie: `${SESSION_COOKIE}=${token}` }), ctx());
    expect(s.status).toBe(200);
  });

  it('sets Secure behind an https tunnel', async () => {
    const { user } = await makeUser();
    const res = await login(
      request('/api/auth/login', { method: 'POST', body: { email: user.email, password: TEST_PASSWORD }, headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': ip() } }),
      ctx(),
    );
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('email case: ignores case and spaces in the email', async () => {
    const { user } = await makeUser();
    expect((await tryLogin(`  ${user.email.toUpperCase()} `, TEST_PASSWORD)).status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { user } = await makeUser();
    const a = await tryLogin(user.email, 'wrong password 1234');
    const b = await tryLogin('nobody-here@test.local', 'wrong password 1234');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
  });

  it('disabled user: refuses sign-in, and the open session gets 401', async () => {
    const { user, cookie } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    expect((await tryLogin(user.email, TEST_PASSWORD)).status).toBe(401);
    const s = await state(request('/api/state', { cookie }), ctx());
    expect(s.status).toBe(401);
    expect(await s.json()).toEqual({ error: 'Sign in to continue.' });
  });

  it('allows 10 tries for each email in 15 minutes', async () => {
    const { user } = await makeUser();
    for (let i = 0; i < 10; i++) expect((await tryLogin(user.email, 'wrong password 1234')).status).toBe(401);
    const res = await tryLogin(user.email, TEST_PASSWORD);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Try again in \d+ minute/);
  });

  it('allows 10 tries for each IP address in 15 minutes', async () => {
    const from = ip();
    for (let i = 0; i < 10; i++) await tryLogin(`nobody-${i}@test.local`, 'wrong password 1234', from);
    const { user } = await makeUser();
    expect((await tryLogin(user.email, TEST_PASSWORD, from)).status).toBe(429);
  });

  it('allows 100 tries from all clients together in 15 minutes', async () => {
    const { user } = await makeUser();
    globalLimit.key = `login:all:test-${randomBytes(6).toString('hex')}`;
    // 99 tries from other clients, then one real sign-in is the 100th and passes.
    for (let i = 0; i < 99; i++) await hitLimit('login:all', 100, FIFTEEN_MINUTES);
    globalLimit.calls.length = 0;
    expect((await tryLogin(user.email, TEST_PASSWORD)).status).toBe(200);
    // The 101st try is refused, although its IP address and its email are new.
    const res = await tryLogin(`nobody-${randomBytes(4).toString('hex')}@test.local`, TEST_PASSWORD);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Try again in \d+ minute/);
    expect(globalLimit.calls).toEqual([[100, FIFTEEN_MINUTES], [100, FIFTEEN_MINUTES]]);
    globalLimit.key = `login:all:test-${randomBytes(6).toString('hex')}`;
  });

  it('does not count a try that the IP or email limit refuses toward the global limit', async () => {
    const { user } = await makeUser();
    globalLimit.key = `login:all:test-${randomBytes(6).toString('hex')}`;
    const from = ip();
    // 10 tries fill this client's IP limit. 100 more tries from it all get 429.
    for (let i = 0; i < 10; i++) await tryLogin(`x${i}-${randomBytes(3).toString('hex')}@test.local`, 'wrong', from);
    for (let i = 0; i < 100; i++) expect((await tryLogin(`y${i}-${randomBytes(3).toString('hex')}@test.local`, 'wrong', from)).status).toBe(429);
    // Only the first 10 reached the global limit, so another client still signs in.
    expect(globalLimit.calls.length).toBeGreaterThanOrEqual(10);
    expect((await tryLogin(user.email, TEST_PASSWORD)).status).toBe(200);
    globalLimit.key = `login:all:test-${randomBytes(6).toString('hex')}`;
  }, 30_000);

  it('refuses a body that is not JSON', async () => {
    const res = await login(request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' } }), ctx());
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/signout', () => {
  it('ends the session and clears the cookie', async () => {
    const { cookie } = await makeUser();
    const res = await signout(request('/api/auth/signout', { method: 'POST', cookie }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await state(request('/api/state', { cookie }), ctx())).status).toBe(401);
  });
});

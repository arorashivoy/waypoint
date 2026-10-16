import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as signout } from '@/app/api/auth/signout/route';
import { GET as state } from '@/app/api/state/route';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
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

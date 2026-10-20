import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { createInvite, createReset } from '@/lib/auth/invites';
import { hashToken } from '@/lib/auth/tokens';
import { GET as inspect, POST as redeem } from '@/app/api/invites/[token]/route';
import { POST as login } from '@/app/api/auth/login/route';
import { GET as state } from '@/app/api/me/route';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { cookieFrom, ctx, makeUser, request, TEST_PASSWORD } from './helpers/http';

const NEW_PW = 'quiet harbour lights 5150';
const mail = () => `n-${randomBytes(6).toString('hex')}@test.local`;
const ip = () => `192.0.2.${randomBytes(2).toString('hex')}`;
const get = (token: string, from = ip()) => inspect(request(`/api/invites/${token}`, { headers: { 'x-forwarded-for': from } }), ctx({ token }));
const post = (token: string, body: unknown, from = ip()) =>
  redeem(request(`/api/invites/${token}`, { method: 'POST', body, headers: { 'x-forwarded-for': from } }), ctx({ token }));

describe('invites', () => {
  it('stores only the hash and expires in 7 days', async () => {
    const { user: admin } = await makeUser('admin');
    const token = await createInvite(admin.id, null);
    const row = await db.invite.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(row.kind).toBe('invite');
    const days = (row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
  });

  it('makes an account, signs it in, and works one time', async () => {
    const { user: admin } = await makeUser('admin');
    const token = await createInvite(admin.id, null);
    expect(await (await get(token)).json()).toEqual({ kind: 'invite', email: null, name: null });
    const email = mail();
    const res = await post(token, { name: 'New Person', email, password: NEW_PW });
    expect(res.status).toBe(200);
    const cookie = `${SESSION_COOKIE}=${cookieFrom(res)}`;
    const s = await (await state(request('/api/me', { cookie }), ctx())).json();
    expect(s.user.email).toBe(email);
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    expect(u.role).toBe('member');
    expect((await get(token)).status).toBe(404);
    expect((await post(token, { name: 'X', email: mail(), password: NEW_PW })).status).toBe(404);
  });

  it('uses the email fixed in the invite', async () => {
    const { user: admin } = await makeUser('admin');
    const email = mail();
    const token = await createInvite(admin.id, email);
    expect((await (await get(token)).json()).email).toBe(email);
    await post(token, { name: 'Fixed', email: 'other@test.local', password: NEW_PW });
    expect(await db.user.findUnique({ where: { email } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { email: 'other@test.local' } })).toBeNull();
  });

  it('keeps the link after a weak password, so the user can try again', async () => {
    const { user: admin } = await makeUser('admin');
    const token = await createInvite(admin.id, null);
    const bad = await post(token, { name: 'W', email: mail(), password: 'short' });
    expect(bad.status).toBe(400);
    expect((await get(token)).status).toBe(200);
  });

  it('one invite makes one account', async () => {
    const { user: admin } = await makeUser('admin');
    const token = await createInvite(admin.id, null);
    const [a, b] = await Promise.all([
      post(token, { name: 'A', email: mail(), password: NEW_PW }),
      post(token, { name: 'B', email: mail(), password: NEW_PW }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
  });

  it('refuses an expired invite', async () => {
    const { user: admin } = await makeUser('admin');
    const token = await createInvite(admin.id, null);
    await db.invite.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await get(token)).status).toBe(404);
  });

  it('existing email in another case: refuses the invite', async () => {
    const { user: admin } = await makeUser('admin');
    const { user } = await makeUser();
    await expect(createInvite(admin.id, user.email.toUpperCase())).rejects.toMatchObject({ status: 409 });
    const token = await createInvite(admin.id, null);
    expect((await post(token, { name: 'Dup', email: ` ${user.email.toUpperCase()} `, password: NEW_PW })).status).toBe(409);
  });

  it('allows 20 tries for each IP address in 15 minutes', async () => {
    const from = ip();
    for (let i = 0; i < 20; i++) await get(`no-such-token-${i}`, from);
    expect((await get('no-such-token-x', from)).status).toBe(429);
  });
});

describe('reset links', () => {
  it('sets the password, ends old sessions and signs in', async () => {
    const { user: admin } = await makeUser('admin');
    const { user, cookie: oldCookie } = await makeUser();
    const token = await createReset(admin.id, user.id);
    expect(await (await get(token)).json()).toEqual({ kind: 'reset', email: user.email, name: user.name });
    const res = await post(token, { password: NEW_PW });
    expect(res.status).toBe(200);
    expect((await state(request('/api/me', { cookie: oldCookie }), ctx())).status).toBe(401);
    const ok = await login(request('/api/auth/login', { method: 'POST', body: { email: user.email, password: NEW_PW }, headers: { 'x-forwarded-for': ip() } }), ctx());
    expect(ok.status).toBe(200);
    const old = await login(request('/api/auth/login', { method: 'POST', body: { email: user.email, password: TEST_PASSWORD }, headers: { 'x-forwarded-for': ip() } }), ctx());
    expect(old.status).toBe(401);
  });

  it('a new reset link ends the older one', async () => {
    const { user: admin } = await makeUser('admin');
    const { user } = await makeUser();
    const first = await createReset(admin.id, user.id);
    const second = await createReset(admin.id, user.id);
    expect((await post(second, { password: NEW_PW })).status).toBe(200);
    expect((await get(first)).status).toBe(404);
  });
});

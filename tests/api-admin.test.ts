import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { POST as invite } from '@/app/api/admin/invites/route';
import { GET as users } from '@/app/api/admin/users/route';
import { PATCH as patchUser } from '@/app/api/admin/users/[id]/route';
import { POST as reset } from '@/app/api/admin/users/[id]/reset/route';
import { GET as state } from '@/app/api/me/route';
import { recordUsage } from '@/lib/claude/usage';
import { ctx, makeUser, request } from './helpers/http';

describe('admin routes', () => {
  it('refuse a member with 403 and a signed-out request with 401', async () => {
    const { cookie } = await makeUser('member');
    expect((await invite(request('/api/admin/invites', { method: 'POST', cookie, body: {} }), ctx())).status).toBe(403);
    expect((await users(request('/api/admin/users', { cookie }), ctx())).status).toBe(403);
    expect((await users(request('/api/admin/users'), ctx())).status).toBe(401);
  });

  it('make an invite link with the public base URL', async () => {
    const { cookie } = await makeUser('admin');
    const res = await invite(request('/api/admin/invites', { method: 'POST', cookie, body: {} }), ctx());
    const body = await res.json();
    expect(body.url).toMatch(/^http:\/\/localhost:3117\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('list users with their shared-key cost this month, and no secrets', async () => {
    const { cookie } = await makeUser('admin');
    const { user } = await makeUser('member');
    await recordUsage(user.id, 'shared', 'analysis', { model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 1.25 });
    const body = await (await users(request('/api/admin/users', { cookie }), ctx())).json();
    const row = body.users.find((u: { id: string }) => u.id === user.id);
    expect(row).toMatchObject({ email: user.email, role: 'member', disabled: false, sharedSpentUsd: 1.25 });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    expect(JSON.stringify(body)).not.toContain('$argon2');
  });

  it('disable a user, which ends the sessions at once; enable again', async () => {
    const { cookie } = await makeUser('admin');
    const { user, cookie: memberCookie } = await makeUser('member');
    const off = await patchUser(request(`/api/admin/users/${user.id}`, { method: 'PATCH', cookie, body: { disabled: true } }), ctx({ id: user.id }));
    expect(off.status).toBe(200);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await state(request('/api/me', { cookie: memberCookie }), ctx())).status).toBe(401);
    await patchUser(request(`/api/admin/users/${user.id}`, { method: 'PATCH', cookie, body: { disabled: false } }), ctx({ id: user.id }));
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).disabledAt).toBeNull();
  });

  it('do not disable an admin, and give 404 for an unknown user', async () => {
    const { user: admin, cookie } = await makeUser('admin');
    expect((await patchUser(request(`/api/admin/users/${admin.id}`, { method: 'PATCH', cookie, body: { disabled: true } }), ctx({ id: admin.id }))).status).toBe(400);
    expect((await patchUser(request('/api/admin/users/nope', { method: 'PATCH', cookie, body: { disabled: true } }), ctx({ id: 'nope' }))).status).toBe(404);
  });

  it('make a reset link', async () => {
    const { cookie } = await makeUser('admin');
    const { user } = await makeUser('member');
    const body = await (await reset(request(`/api/admin/users/${user.id}/reset`, { method: 'POST', cookie }), ctx({ id: user.id }))).json();
    expect(body.url).toMatch(/\/reset\/[A-Za-z0-9_-]{43}$/);
  });
});

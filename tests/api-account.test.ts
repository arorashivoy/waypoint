import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { POST as changePassword } from '@/app/api/account/password/route';
import { DELETE as endAll, GET as listSessions } from '@/app/api/account/sessions/route';
import { DELETE as endOne } from '@/app/api/account/sessions/[id]/route';
import { DELETE as removeKey, GET as claude, PUT as saveKey } from '@/app/api/account/claude/route';
import { GET as state } from '@/app/api/me/route';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { readSecret } from '@/lib/secrets';
import { ctx, makeUser, request, TEST_PASSWORD } from './helpers/http';

const NEW_PW = 'granite meadow sparrow 808';
const KEY = 'sk-ant-api03-' + 'a'.repeat(40) + 'WXYZ';
const alive = async (cookie: string) => (await state(request('/api/me', { cookie }), ctx())).status === 200;

describe('POST /api/account/password', () => {
  it('changes the password and ends the other sessions only', async () => {
    const { user, cookie } = await makeUser();
    const other = `${SESSION_COOKIE}=${await createSession(user.id, 'phone')}`;
    const res = await changePassword(request('/api/account/password', { method: 'POST', cookie, body: { current: TEST_PASSWORD, next: NEW_PW } }), ctx());
    expect(res.status).toBe(200);
    expect(await alive(cookie)).toBe(true);
    expect(await alive(other)).toBe(false);
  });

  it('refuses a wrong current password and a weak new one', async () => {
    const { cookie } = await makeUser();
    expect((await changePassword(request('/api/account/password', { method: 'POST', cookie, body: { current: 'wrong wrong wrong', next: NEW_PW } }), ctx())).status).toBe(400);
    expect((await changePassword(request('/api/account/password', { method: 'POST', cookie, body: { current: TEST_PASSWORD, next: 'short' } }), ctx())).status).toBe(400);
  });
});

describe('sessions', () => {
  it('lists the own sessions and marks the current one', async () => {
    const { user, cookie } = await makeUser();
    await createSession(user.id, 'Mozilla/5.0 (iPad)');
    const body = await (await listSessions(request('/api/account/sessions', { cookie }), ctx())).json();
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('tokenHash');
  });

  it("ends one session, and gives 404 for another user's session", async () => {
    const { user, cookie } = await makeUser();
    const b = await makeUser();
    const phone = `${SESSION_COOKIE}=${await createSession(user.id, 'phone')}`;
    const phoneRow = await db.session.findFirstOrThrow({ where: { userId: user.id, userAgent: 'phone' } });
    expect((await endOne(request(`/api/account/sessions/${phoneRow.id}`, { method: 'DELETE', cookie: b.cookie }), ctx({ id: phoneRow.id }))).status).toBe(404);
    expect(await alive(phone)).toBe(true);
    expect((await endOne(request(`/api/account/sessions/${phoneRow.id}`, { method: 'DELETE', cookie }), ctx({ id: phoneRow.id }))).status).toBe(200);
    expect(await alive(phone)).toBe(false);
    expect(await alive(cookie)).toBe(true);
  });

  it('ends all sessions and clears the cookie', async () => {
    const { user, cookie } = await makeUser();
    const other = `${SESSION_COOKIE}=${await createSession(user.id, 'phone')}`;
    const res = await endAll(request('/api/account/sessions', { method: 'DELETE', cookie }), ctx());
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await alive(cookie)).toBe(false);
    expect(await alive(other)).toBe(false);
  });
});

describe('own Claude key', () => {
  it('saves the key encrypted and never sends it back', async () => {
    const { user, cookie } = await makeUser();
    const res = await saveKey(request('/api/account/claude', { method: 'PUT', cookie, body: { key: KEY } }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyHint).toBe('WXYZ');
    expect(body.mode).toBe('own');
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify(await (await claude(request('/api/account/claude', { cookie }), ctx())).json())).not.toContain(KEY);
    expect(JSON.stringify(await (await state(request('/api/me', { cookie }), ctx())).json())).not.toContain(KEY);
    expect(await readSecret(user.id, 'anthropic')).toBe(KEY);
  });

  it('refuses a value that is not an Anthropic key', async () => {
    const { cookie } = await makeUser();
    expect((await saveKey(request('/api/account/claude', { method: 'PUT', cookie, body: { key: 'hello' } }), ctx())).status).toBe(400);
  });

  it('removes the key', async () => {
    const { user, cookie } = await makeUser();
    await saveKey(request('/api/account/claude', { method: 'PUT', cookie, body: { key: KEY } }), ctx());
    const body = await (await removeKey(request('/api/account/claude', { method: 'DELETE', cookie }), ctx())).json();
    expect(body.keyHint).toBeNull();
    expect(await readSecret(user.id, 'anthropic')).toBeNull();
  });
});

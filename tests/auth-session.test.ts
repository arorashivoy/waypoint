import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { createSession, endUserSessions, readSession, TOUCH_MS } from '@/lib/auth/session';
import { hashToken } from '@/lib/auth/tokens';
import { makeUser, request } from './helpers/http';

const reqWith = (token: string) => request('/api/state', { cookie: `${SESSION_COOKIE}=${token}` });

describe('sessions', () => {
  it('stores only the hash of the token', async () => {
    const { user, token } = await makeUser();
    const rows = await db.session.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('reads the session from the cookie', async () => {
    const { user, token } = await makeUser();
    const s = await readSession(reqWith(token));
    expect(s?.user.id).toBe(user.id);
    expect(await readSession(reqWith('wrong-token'))).toBeNull();
    expect(await readSession(request('/api/state'))).toBeNull();
  });

  it('ends an expired session', async () => {
    const { token } = await makeUser();
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await readSession(reqWith(token))).toBeNull();
    expect(await db.session.findUnique({ where: { tokenHash: hashToken(token) } })).toBeNull();
  });

  it('ends the session of a disabled user', async () => {
    const { user, token } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    expect(await readSession(reqWith(token))).toBeNull();
    expect(await db.session.findUnique({ where: { tokenHash: hashToken(token) } })).toBeNull();
  });

  it('moves the expiry forward at most one time each hour', async () => {
    const { token } = await makeUser();
    const where = { tokenHash: hashToken(token) };
    const old = new Date(Date.now() - TOUCH_MS - 1000);
    await db.session.update({ where, data: { lastSeenAt: old, expiresAt: new Date(Date.now() + 1000 * 3600) } });
    await readSession(reqWith(token));
    const touched = await db.session.findUniqueOrThrow({ where });
    expect(touched.lastSeenAt.getTime()).toBeGreaterThan(old.getTime());
    expect(touched.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600_000);
    await readSession(reqWith(token));
    const again = await db.session.findUniqueOrThrow({ where });
    expect(again.lastSeenAt.getTime()).toBe(touched.lastSeenAt.getTime());
  });

  it('ends all other sessions of a user', async () => {
    const { user, token } = await makeUser();
    const second = await createSession(user.id, 'other');
    const keep = await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    await endUserSessions(user.id, keep.id);
    expect(await readSession(reqWith(token))).not.toBeNull();
    expect(await readSession(reqWith(second))).toBeNull();
  });
});

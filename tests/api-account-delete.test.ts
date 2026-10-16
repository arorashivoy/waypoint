import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '@/lib/db';
import { checkYaml } from '@/lib/profile/doc';
import { saveProfile } from '@/lib/profile/store';
import { userDir, usersRoot } from '@/lib/user-files';
import { DELETE as deleteAccount } from '@/app/api/account/route';
import { ctx, makeUser, request, TEST_PASSWORD } from './helpers/http';

const sample = () => checkYaml(readFileSync('tests/fixtures/claims-sample.yml', 'utf8')).doc!;

describe('DELETE /api/account', () => {
  it('refuses a wrong password and keeps the account', async () => {
    const u = await makeUser();
    const res = await deleteAccount(request('/api/account', { method: 'DELETE', cookie: u.cookie, body: { password: 'wrong password 123' } }), ctx());
    expect(res.status).toBe(400);
    expect(await db.user.findUnique({ where: { id: u.user.id } })).not.toBeNull();
  });

  it('refuses the admin', async () => {
    const u = await makeUser('admin');
    expect((await deleteAccount(request('/api/account', { method: 'DELETE', cookie: u.cookie, body: { password: TEST_PASSWORD } }), ctx())).status).toBe(409);
  });

  it('deletes the user, the profile, the sessions and the user folder, and clears the cookie', async () => {
    const u = await makeUser();
    const other = await makeUser();
    await saveProfile(u.user.id, sample(), 'Mine');
    await saveProfile(other.user.id, sample(), 'Theirs');
    userDir(u.user.id, 'imports');
    const res = await deleteAccount(request('/api/account', { method: 'DELETE', cookie: u.cookie, body: { password: TEST_PASSWORD } }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await db.user.findUnique({ where: { id: u.user.id } })).toBeNull();
    expect(await db.session.count({ where: { userId: u.user.id } })).toBe(0);
    expect(await db.claim.count({ where: { userId: u.user.id } })).toBe(0);
    expect(existsSync(join(usersRoot(), u.user.id))).toBe(false);
    expect(await db.claim.count({ where: { userId: other.user.id } })).toBe(3);
  });

  it('allows 5 tries in 15 minutes', async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) await deleteAccount(request('/api/account', { method: 'DELETE', cookie: u.cookie, body: { password: 'wrong password 123' } }), ctx());
    expect((await deleteAccount(request('/api/account', { method: 'DELETE', cookie: u.cookie, body: { password: TEST_PASSWORD } }), ctx())).status).toBe(429);
  }, 30_000);
});

import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '@/lib/db';
import { checkYaml } from '@/lib/profile/doc';
import { saveProfile } from '@/lib/profile/store';
import { userDir, usersRoot } from '@/lib/user-files';
import { createSession } from '@/lib/auth/session';

const fail = vi.hoisted(() => ({ remove: false }));
vi.mock('@/lib/user-files', async (orig) => {
  const mod = await orig<typeof import('@/lib/user-files')>();
  return { ...mod, removeUserDir: (id: string) => { if (fail.remove) throw new Error('disk error'); mod.removeUserDir(id); } };
});
import { DELETE as deleteAccount } from '@/app/api/account/route';
import { ctx, makeUser, request, TEST_PASSWORD } from './helpers/http';

const sample = () => checkYaml(readFileSync('tests/fixtures/claims-sample.yml', 'utf8')).doc!;

type U = Awaited<ReturnType<typeof makeUser>>;

/** Rows in every table that holds data of a user, a folder with a file, and a second session. */
async function fill(u: U, jobId: string) {
  const id = u.user.id;
  await saveProfile(id, sample(), 'Seed');
  await db.userSecret.createMany({ data: ['github', 'claude'].map((kind) => ({ userId: id, kind, iv: 'iv', tag: 'tag', data: 'data', last4: 'abcd' })) });
  await db.profileDraft.create({ data: { userId: id, batchId: 'b1', source: 'yaml', type: 'claim', data: '{}' } });
  await db.githubCache.create({ data: { userId: id, url: 'https://api.github.com/x', etag: 'e', body: '{}' } });
  await db.contact.create({ data: { userId: id, firstName: 'A', lastName: 'B' } });
  await db.profileImport.create({ data: { userId: id, filename: 'a.yml', counts: '{}' } });
  await db.invite.create({ data: { tokenHash: `h-${id}`, kind: 'invite', createdById: id, expiresAt: new Date(Date.now() + 86_400_000) } });
  await db.jobAnalysis.create({ data: { userId: id, jobId, analysis: '{}' } });
  await createSession(id, 'second device');
  writeFileSync(join(userDir(id, 'imports'), 'resume.pdf'), 'x');
}

async function counts(id: string) {
  return {
    user: await db.user.count({ where: { id } }),
    session: await db.session.count({ where: { userId: id } }),
    secret: await db.userSecret.count({ where: { userId: id } }),
    claim: await db.claim.count({ where: { userId: id } }),
    revision: await db.profileRevision.count({ where: { userId: id } }),
    draft: await db.profileDraft.count({ where: { userId: id } }),
    cache: await db.githubCache.count({ where: { userId: id } }),
    contact: await db.contact.count({ where: { userId: id } }),
    imp: await db.profileImport.count({ where: { userId: id } }),
    invite: await db.invite.count({ where: { createdById: id } }),
    analysis: await db.jobAnalysis.count({ where: { userId: id } }),
  };
}

const newJob = () => db.job.create({ data: { externalId: `j-${Math.random()}`, source: 't', role: 'r', company: 'c', city: 'x', cc: 'xx', url: 'https://example.com' } });
const del = (u: U, password: string) => deleteAccount(request('/api/account', { method: 'DELETE', cookie: u.cookie, body: { password } }), ctx());

describe('DELETE /api/account', () => {
  it('refuses a wrong password and keeps the account, the sessions and the folder', async () => {
    const u = await makeUser();
    await fill(u, (await newJob()).id);
    const before = await counts(u.user.id);
    expect((await del(u, 'wrong password 123')).status).toBe(400);
    expect(await counts(u.user.id)).toEqual(before);
    expect(before.session).toBe(2);
    expect(existsSync(join(usersRoot(), u.user.id, 'imports', 'resume.pdf'))).toBe(true);
  });

  it('refuses the admin', async () => {
    const u = await makeUser('admin');
    expect((await del(u, TEST_PASSWORD)).status).toBe(409);
  });

  it('deletes every row and file of the user, clears the cookie, and keeps another user', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const job = await newJob();
    await fill(u, job.id);
    await fill(other, job.id);
    const otherBefore = await counts(other.user.id);
    for (const x of [u, other]) {
      const file = join(usersRoot(), x.user.id, 'imports', 'resume.pdf');
      expect(existsSync(file)).toBe(true);
    }
    expect((await counts(u.user.id)).session).toBe(2);

    const res = await del(u, TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);

    expect(Object.values(await counts(u.user.id)).every((n) => n === 0)).toBe(true);
    expect(existsSync(join(usersRoot(), u.user.id))).toBe(false);

    expect(await counts(other.user.id)).toEqual(otherBefore);
    expect(otherBefore.session).toBe(2);
    expect(otherBefore.secret).toBe(2);
    expect(otherBefore.claim).toBe(3);
    expect(existsSync(join(usersRoot(), other.user.id, 'imports', 'resume.pdf'))).toBe(true);
  });

  it('still answers ok and clears the cookie when the folder cannot be removed', async () => {
    const u = await makeUser();
    userDir(u.user.id, 'imports');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    fail.remove = true;
    try {
      const res = await del(u, TEST_PASSWORD);
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
      expect(await db.user.count({ where: { id: u.user.id } })).toBe(0);
      expect(log).toHaveBeenCalled();
    } finally {
      fail.remove = false;
      log.mockRestore();
    }
  });

  it('does not fail when two requests delete the same account', async () => {
    const u = await makeUser();
    const [a, b] = await Promise.all([del(u, TEST_PASSWORD), del(u, TEST_PASSWORD)]);
    expect([a.status, b.status].every((s) => s === 200 || s === 401)).toBe(true);
    expect(await db.user.count({ where: { id: u.user.id } })).toBe(0);
  });

  it('allows 5 tries in 15 minutes', async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) await del(u, 'wrong password 123');
    expect((await del(u, TEST_PASSWORD)).status).toBe(429);
  }, 30_000);
});

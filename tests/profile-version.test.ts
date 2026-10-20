import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { listRevisions, loadProfileDoc, profileVersion, restoreRevision, saveProfile } from '@/lib/profile/store';
import { acceptDrafts, createDrafts, listDrafts } from '@/lib/profile/drafts';
import { changeProfile } from '@/lib/profile/editor';
import { emptyDoc } from '@/lib/profile/doc';
import { POST as addItem } from '@/app/api/profile/items/[kind]/route';
import { PUT as putItem, DELETE as deleteItem } from '@/app/api/profile/items/[kind]/[key]/route';
import { PUT as putMeta } from '@/app/api/profile/meta/route';
import { POST as acceptRoute } from '@/app/api/profile/drafts/accept/route';
import { POST as restoreRoute } from '@/app/api/profile/revisions/[id]/restore/route';
import { ctx, makeUser, request } from './helpers/http';

const STALE = 'Your profile changed in another tab. Load the new version, then make the change again.';
const project = (id: string) => ({ type: 'project' as const, data: { id, title: `Title ${id}` } });
const batch = (items: { type: any; data: unknown }[]) => ({ batchId: randomUUID(), source: 'test', items });

/** A user whose profile is at version 2: two saved changes. */
async function userAtVersion2() {
  const u = await makeUser();
  await changeProfile(u.user.id, 'one', (d) => ({ ...d, profile: { ...d.profile, headline: 'One' } }), 0);
  await changeProfile(u.user.id, 'two', (d) => ({ ...d, profile: { ...d.profile, headline: 'Two' } }), 1);
  expect(await profileVersion(u.user.id)).toBe(2);
  return u;
}

const unchanged = async (userId: string, version: number, revisions: number, headline: string) => {
  expect(await profileVersion(userId)).toBe(version);
  expect((await listRevisions(userId)).length).toBe(revisions);
  expect((await loadProfileDoc(userId))!.profile.headline).toBe(headline);
};

describe('saveProfile with an expected version', () => {
  it('refuses an old version with 409 and changes nothing', async () => {
    const { user } = await userAtVersion2();
    const doc = (await loadProfileDoc(user.id))!;
    await expect(saveProfile(user.id, { ...doc, profile: { ...doc.profile, headline: 'Stale' } }, 'Stale', undefined, 1)).rejects.toMatchObject({ status: 409, message: STALE });
    await unchanged(user.id, 2, 2, 'Two');
  });

  it('writes when the version is the current one', async () => {
    const { user } = await userAtVersion2();
    const doc = (await loadProfileDoc(user.id))!;
    const r = await saveProfile(user.id, { ...doc, profile: { ...doc.profile, headline: 'Three' } }, 'Three', undefined, 2);
    expect(r.version).toBe(3);
    await unchanged(user.id, 3, 3, 'Three');
  });

  it('accepts version 0 for a user without a profile, one time only', async () => {
    const { user } = await makeUser();
    const doc = emptyDoc(user.name);
    const results = await Promise.allSettled([
      saveProfile(user.id, { ...doc, profile: { ...doc.profile, headline: 'A' } }, 'A', undefined, 0),
      saveProfile(user.id, { ...doc, profile: { ...doc.profile, headline: 'B' } }, 'B', undefined, 0),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(await profileVersion(user.id)).toBe(1);
  });

  it('refuses a restore with an old version', async () => {
    const { user } = await userAtVersion2();
    const [rev] = await listRevisions(user.id);
    await expect(restoreRevision(user.id, rev.id, 1)).rejects.toMatchObject({ status: 409, message: STALE });
    await unchanged(user.id, 2, 2, 'Two');
    await restoreRevision(user.id, rev.id, 2);
    expect(await profileVersion(user.id)).toBe(3);
  });
});

describe('draft accept with versions', () => {
  it('writes once when 2 accepts of one draft run at the same time', async () => {
    const { user } = await makeUser();
    await createDrafts(user.id, batch([project('once')]));
    const ids = (await listDrafts(user.id)).map((d) => d.id);
    const results = await Promise.allSettled([acceptDrafts(user.id, ids, 0), acceptDrafts(user.id, ids, 0)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(await profileVersion(user.id)).toBe(1);
    expect((await loadProfileDoc(user.id))!.targets.projects.map((p) => p.id)).toEqual(['once']);
  });

  it('gives 409 and no second write for a draft that is already accepted', async () => {
    const { user } = await makeUser();
    await createDrafts(user.id, batch([project('twice')]));
    const ids = (await listDrafts(user.id)).map((d) => d.id);
    await acceptDrafts(user.id, ids, 0);
    await expect(acceptDrafts(user.id, ids, 1)).rejects.toMatchObject({ status: 409 });
    expect(await profileVersion(user.id)).toBe(1);
    expect((await listRevisions(user.id)).length).toBe(1);
  });

  it('refuses an old version and leaves the draft pending', async () => {
    const { user } = await userAtVersion2();
    await createDrafts(user.id, batch([project('late')]));
    const ids = (await listDrafts(user.id)).map((d) => d.id);
    await expect(acceptDrafts(user.id, ids, 1)).rejects.toMatchObject({ status: 409, message: STALE });
    expect((await db.profileDraft.findMany({ where: { id: { in: ids } } })).map((d) => d.status)).toEqual(['pending']);
    await unchanged(user.id, 2, 2, 'Two');
  });
});

describe('the profile write routes', () => {
  const call = async (u: Awaited<ReturnType<typeof makeUser>>, kind: 'add' | 'put' | 'delete' | 'meta' | 'accept' | 'restore', body: Record<string, unknown>, query = '') => {
    const cookie = u.cookie;
    switch (kind) {
      case 'add': return addItem(request('/api/profile/items/project', { method: 'POST', cookie, body }), ctx({ kind: 'project' }));
      case 'put': return putItem(request('/api/profile/items/project/p1', { method: 'PUT', cookie, body }), ctx({ kind: 'project', key: 'p1' }));
      case 'delete': return deleteItem(request(`/api/profile/items/project/p1${query}`, { method: 'DELETE', cookie }), ctx({ kind: 'project', key: 'p1' }));
      case 'meta': return putMeta(request('/api/profile/meta', { method: 'PUT', cookie, body }), ctx());
      case 'accept': return acceptRoute(request('/api/profile/drafts/accept', { method: 'POST', cookie, body }), ctx());
      case 'restore': return restoreRoute(request('/api/profile/revisions/x/restore', { method: 'POST', cookie, body }), ctx({ id: String(body.rev) }));
    }
  };

  it('gives 409 and changes nothing when the version is old', async () => {
    const u = await userAtVersion2();
    const item = { id: 'p1', title: 'P' };
    for (const res of [
      await call(u, 'add', { item, version: 1 }),
      await call(u, 'meta', { name: 'N', headline: 'H', version: 1 }),
    ]) {
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(STALE);
    }
    await unchanged(u.user.id, 2, 2, 'Two');
  });

  it('works with the current version, and the reply carries the new one', async () => {
    const u = await userAtVersion2();
    const res = await call(u, 'add', { item: { id: 'p1', title: 'P' }, version: 2 });
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(3);
    const put = await call(u, 'put', { item: { id: 'p1', title: 'Q' }, version: 3 });
    expect(put.status).toBe(200);
    expect((await call(u, 'delete', {}, '?version=3')).status).toBe(409);
    expect((await call(u, 'delete', {}, '?version=4')).status).toBe(200);
  });

  it('gives 400 when the version is missing or not a whole number', async () => {
    const u = await userAtVersion2();
    for (const version of [undefined, -1, 1.5, '2', null]) {
      expect((await call(u, 'meta', { name: 'N', headline: 'H', version })).status).toBe(400);
    }
    expect((await call(u, 'accept', { ids: ['x'] })).status).toBe(400);
    expect((await call(u, 'delete', {})).status).toBe(400);
    await unchanged(u.user.id, 2, 2, 'Two');
  });

  it('refuses an old version on accept and restore', async () => {
    const u = await userAtVersion2();
    await createDrafts(u.user.id, batch([project('d1')]));
    const ids = (await listDrafts(u.user.id)).map((d) => d.id);
    expect((await call(u, 'accept', { ids, version: 1 })).status).toBe(409);
    const [rev] = await listRevisions(u.user.id);
    expect((await call(u, 'restore', { rev: rev.id, version: 1 })).status).toBe(409);
    await unchanged(u.user.id, 2, 2, 'Two');
  });
});

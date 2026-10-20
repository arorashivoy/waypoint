import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkYaml } from '@/lib/profile/doc';
import { saveProfile } from '@/lib/profile/store';
import { GET as getProfile } from '@/app/api/profile/route';
import { PUT as putMeta } from '@/app/api/profile/meta/route';
import { POST as addItem } from '@/app/api/profile/items/[kind]/route';
import { DELETE as deleteItem, PUT as putItem } from '@/app/api/profile/items/[kind]/[key]/route';
import { GET as getRevisions } from '@/app/api/profile/revisions/route';
import { POST as restore } from '@/app/api/profile/revisions/[id]/restore/route';
import { ctx, makeUser, request } from './helpers/http';

const sample = () => checkYaml(readFileSync('tests/fixtures/claims-sample.yml', 'utf8')).doc!;

describe('profile editor API', () => {
  it('gives an empty document with the user name before the first write', async () => {
    const u = await makeUser();
    const body = await (await getProfile(request('/api/profile', { cookie: u.cookie }), ctx())).json();
    expect(body).toMatchObject({ doc: { profile: { name: 'Test User', headline: '' }, claims: [] }, version: 0, pendingDrafts: 0 });
  });

  it('adds, changes and removes an item, and the evidence follows a rename', async () => {
    const u = await makeUser();
    await saveProfile(u.user.id, sample(), 'Start');
    const add = await addItem(request('/api/profile/items/project', { method: 'POST', cookie: u.cookie, body: { item: { id: 'cli', title: 'CLI' }, version: 1 } }), ctx({ kind: 'project' }));
    expect(add.status).toBe(200);
    expect((await addItem(request('/api/profile/items/project', { method: 'POST', cookie: u.cookie, body: { item: { id: 'cli', title: 'Again' }, version: 2 } }), ctx({ kind: 'project' }))).status).toBe(409);

    const ren = await putItem(request('/api/profile/items/project/parser', { method: 'PUT', cookie: u.cookie, body: { item: { id: 'json-parser', title: 'Fast parser' }, version: 2 } }), ctx({ kind: 'project', key: 'parser' }));
    const renamed = await ren.json();
    expect(renamed.doc.claims.find((c: { slug: string }) => c.slug === 'spring').evidence[0].target).toBe('project:json-parser');

    const clash = await putItem(request('/api/profile/items/project/cli', { method: 'PUT', cookie: u.cookie, body: { item: { id: 'json-parser', title: 'CLI' }, version: 3 } }), ctx({ kind: 'project', key: 'cli' }));
    expect(clash.status).toBe(409);

    const del = await (await deleteItem(request('/api/profile/items/project/json-parser?version=3', { method: 'DELETE', cookie: u.cookie }), ctx({ kind: 'project', key: 'json-parser' }))).json();
    expect(del.doc.targets.projects.map((p: { id: string }) => p.id)).toEqual(['cli']);
    expect(del.doc.claims.find((c: { slug: string }) => c.slug === 'spring').evidence).toEqual([]);
  });

  it('answers 422 with the check errors, and 400 for a wrong shape', async () => {
    const u = await makeUser();
    await saveProfile(u.user.id, sample(), 'Start');
    const bad = await putItem(request('/api/profile/items/position/acme-dev', { method: 'PUT', cookie: u.cookie, body: { item: { ...sample().targets.positions[0], start: '2024/3' }, version: 1 } }), ctx({ kind: 'position', key: 'acme-dev' }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).errors.join('\n')).toMatch(/targets\.positions\[0\]\.start/);
    const shape = await putItem(request('/api/profile/items/position/acme-dev', { method: 'PUT', cookie: u.cookie, body: { item: { id: 'Not A Slug' }, version: 1 } }), ctx({ kind: 'position', key: 'acme-dev' }));
    expect(shape.status).toBe(400);
    expect((await addItem(request('/api/profile/items/secret', { method: 'POST', cookie: u.cookie, body: { item: {}, version: 1 } }), ctx({ kind: 'secret' }))).status).toBe(404);
  });

  it('changes the name and headline', async () => {
    const u = await makeUser();
    const r = await (await putMeta(request('/api/profile/meta', { method: 'PUT', cookie: u.cookie, body: { name: 'New Name', headline: 'New headline', version: 0 } }), ctx())).json();
    expect(r.doc.profile).toEqual({ name: 'New Name', headline: 'New headline' });
  });

  it('lists the revisions and restores one', async () => {
    const u = await makeUser();
    await saveProfile(u.user.id, sample(), 'Start');
    await putMeta(request('/api/profile/meta', { method: 'PUT', cookie: u.cookie, body: { name: 'Test Person', headline: 'Changed', version: 1 } }), ctx());
    const { revisions } = await (await getRevisions(request('/api/profile/revisions', { cookie: u.cookie }), ctx())).json();
    expect(revisions[0].note).toBe('Changed the name and headline');
    const r = await (await restore(request(`/api/profile/revisions/${revisions[0].id}/restore`, { method: 'POST', cookie: u.cookie, body: { version: 2 } }), ctx({ id: revisions[0].id }))).json();
    expect(r.doc.profile.headline).toBe('Backend engineer');
  });

  it('keeps users apart', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await saveProfile(a.user.id, sample(), 'A');
    const body = JSON.stringify(await (await getProfile(request('/api/profile', { cookie: b.cookie }), ctx())).json());
    expect(body).not.toContain('Acme');
    expect((await putItem(request('/api/profile/items/project/parser', { method: 'PUT', cookie: b.cookie, body: { item: { id: 'parser', title: 'Mine' }, version: 0 } }), ctx({ kind: 'project', key: 'parser' }))).status).toBe(404);
    expect((await deleteItem(request('/api/profile/items/project/parser?version=0', { method: 'DELETE', cookie: b.cookie }), ctx({ kind: 'project', key: 'parser' }))).status).toBe(404);
    const { revisions } = await (await getRevisions(request('/api/profile/revisions', { cookie: a.cookie }), ctx())).json();
    expect((await restore(request(`/api/profile/revisions/${revisions[0].id}/restore`, { method: 'POST', cookie: b.cookie, body: { version: 0 } }), ctx({ id: revisions[0].id }))).status).toBe(404);
  });
});

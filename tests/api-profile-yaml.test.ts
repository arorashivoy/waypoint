import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalDoc, checkYaml } from '@/lib/profile/doc';
import { loadProfileDoc, saveProfile } from '@/lib/profile/store';
import { db } from '@/lib/db';
import { acceptDrafts, listDrafts, MAX_PENDING } from '@/lib/profile/drafts';
import { GET as exportRoute } from '@/app/api/profile/export/route';
import { POST as yamlRoute } from '@/app/api/profile/yaml/route';
import { ctx, formRequest, makeUser, request } from './helpers/http';

const SAMPLE = readFileSync('tests/fixtures/claims-sample.yml', 'utf8');
const upload = (cookie: string, body: string | Buffer, name = 'claims.yml', type = 'application/x-yaml') => {
  const form = new FormData();
  form.append('file', new File([typeof body === 'string' ? body : new Uint8Array(body)], name, { type }));
  return formRequest('/api/profile/yaml', form, { cookie });
};

describe('YAML export and import', () => {
  it('exports the profile, and another user imports it through a draft', async () => {
    const a = await makeUser();
    await saveProfile(a.user.id, checkYaml(SAMPLE).doc!, 'A');
    const res = await exportRoute(request('/api/profile/export', { cookie: a.cookie }), ctx());
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="claims.yml"');
    expect(res.headers.get('content-type')).toMatch(/^application\/yaml/);
    const text = await res.text();

    const b = await makeUser();
    const imp = await yamlRoute(await upload(b.cookie, text), ctx());
    expect(imp.status).toBe(200);
    const body = await imp.json();
    expect(body.drafts).toBe(1);
    expect(body.diff.filter((d: { change: string }) => d.change === 'added').length).toBe(7);
    expect(await loadProfileDoc(b.user.id)).toBeNull();

    const [draft] = await listDrafts(b.user.id);
    expect(draft.type).toBe('profile');
    await acceptDrafts(b.user.id, [draft.id]);
    expect(canonicalDoc((await loadProfileDoc(b.user.id))!)).toEqual(canonicalDoc(checkYaml(SAMPLE).doc!));
  });

  it('replaces the waiting YAML draft with the new one, also at the cap', async () => {
    const u = await makeUser();
    await yamlRoute(await upload(u.cookie, SAMPLE), ctx());
    await db.profileDraft.createMany({ data: Array.from({ length: MAX_PENDING - 1 }, (_, i) => ({ userId: u.user.id, batchId: 'x', source: 'test', type: 'project', data: JSON.stringify({ id: `p${i}`, title: 'x' }) })) });
    expect((await yamlRoute(await upload(u.cookie, SAMPLE), ctx())).status).toBe(200);
    expect(await db.profileDraft.count({ where: { userId: u.user.id, type: 'profile', status: 'pending' } })).toBe(1);
    expect(await db.profileDraft.count({ where: { userId: u.user.id, type: 'profile', status: 'rejected' } })).toBe(1);
  });

  it('keeps the waiting YAML draft when the new one is refused', async () => {
    const u = await makeUser();
    await yamlRoute(await upload(u.cookie, SAMPLE), ctx());
    await db.profileDraft.createMany({ data: Array.from({ length: MAX_PENDING }, (_, i) => ({ userId: u.user.id, batchId: 'x', source: 'test', type: 'project', data: JSON.stringify({ id: `p${i}`, title: 'x' }) })) });
    expect((await yamlRoute(await upload(u.cookie, SAMPLE), ctx())).status).toBe(409);
    expect(await db.profileDraft.count({ where: { userId: u.user.id, type: 'profile', status: 'pending' } })).toBe(1);
  });

  it('exports an empty profile with the user name before the first write', async () => {
    const u = await makeUser();
    const text = await (await exportRoute(request('/api/profile/export', { cookie: u.cookie }), ctx())).text();
    expect(checkYaml(text).doc?.profile.name).toBe('Test User');
  });

  it('answers 422 with the errors of a bad file, and imports nothing', async () => {
    const u = await makeUser();
    const res = await yamlRoute(await upload(u.cookie, SAMPLE.replace('kind: language', 'kind: hobby')), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).errors.join('\n')).toMatch(/kind/);
    expect(await listDrafts(u.user.id)).toEqual([]);
  });

  it('refuses a PDF named claims.yml, a file over 1 MB, and an upload without a length', async () => {
    const u = await makeUser();
    expect((await yamlRoute(await upload(u.cookie, Buffer.from('%PDF-1.7 x')), ctx())).status).toBe(400);
    expect((await yamlRoute(await upload(u.cookie, 'x'.repeat(1024 * 1024 + 1)), ctx())).status).toBe(413);
    const form = new FormData();
    form.append('file', new File([SAMPLE], 'claims.yml'));
    expect((await yamlRoute(await formRequest('/api/profile/yaml', form, { cookie: u.cookie, headers: { 'content-length': null } }), ctx())).status).toBe(411);
  });

  it('keeps one pending YAML import: a new one rejects the old one', async () => {
    const u = await makeUser();
    await yamlRoute(await upload(u.cookie, SAMPLE), ctx());
    await yamlRoute(await upload(u.cookie, SAMPLE.replace('Backend engineer', 'Second import')), ctx());
    const drafts = await listDrafts(u.user.id);
    expect(drafts.length).toBe(1);
    expect((drafts[0].data as { profile: { headline: string } }).profile.headline).toBe('Second import');
  });

  it('never exports the profile of another user', async () => {
    const a = await makeUser();
    await saveProfile(a.user.id, checkYaml(SAMPLE).doc!, 'A');
    const b = await makeUser();
    expect(await (await exportRoute(request('/api/profile/export', { cookie: b.cookie }), ctx())).text()).not.toContain('Acme');
  });
});

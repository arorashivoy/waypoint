import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { db } from '@/lib/db';
import { canonicalDoc, checkYaml, toYaml, type ClaimsDoc } from '@/lib/profile/doc';
import { listRevisions, loadProfileDoc, ProfileError, profileVersion, restoreRevision, saveProfile } from '@/lib/profile/store';
import { makeUser } from './helpers/http';

const sample = (): ClaimsDoc => {
  const c = checkYaml(readFileSync('tests/fixtures/claims-sample.yml', 'utf8'));
  if (!c.doc) throw new Error(c.errors.join('\n'));
  return c.doc;
};

describe('profile store', () => {
  it('returns null before the first write', async () => {
    const { user } = await makeUser();
    expect(await loadProfileDoc(user.id)).toBeNull();
    expect(await profileVersion(user.id)).toBe(0);
  });

  it('writes a document and reads the same canonical data back', async () => {
    const { user } = await makeUser();
    const r = await saveProfile(user.id, sample(), 'Test write');
    expect(r.version).toBe(1);
    const back = await loadProfileDoc(user.id);
    expect(canonicalDoc(back!)).toEqual(canonicalDoc(sample()));
    // The YAML export of the stored profile checks clean and has the same data.
    expect(canonicalDoc(checkYaml(toYaml(back!)).doc!)).toEqual(canonicalDoc(sample()));
  });

  it('keeps the order of every list', async () => {
    const { user } = await makeUser();
    const d = sample();
    d.claims = [...d.claims].reverse();
    await saveProfile(user.id, d, 'Reversed');
    expect((await loadProfileDoc(user.id))!.claims.map((c) => c.slug)).toEqual(['gpa', 'spring', 'java']);
  });

  it('refuses a document with errors and changes nothing', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, sample(), 'First');
    const bad = sample();
    bad.claims[0].evidence[0].target = 'project:missing';
    await expect(saveProfile(user.id, bad, 'Bad')).rejects.toBeInstanceOf(ProfileError);
    await expect(saveProfile(user.id, bad, 'Bad')).rejects.toMatchObject({ status: 422, details: { errors: [expect.stringMatching(/project:missing/)] } });
    expect(await profileVersion(user.id)).toBe(1);
    expect((await listRevisions(user.id)).length).toBe(1);
  });

  it('rolls back when the extra step throws', async () => {
    const { user } = await makeUser();
    await expect(
      saveProfile(user.id, sample(), 'With extra', async () => {
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await loadProfileDoc(user.id)).toBeNull();
    expect(await listRevisions(user.id)).toEqual([]);
  });

  it('writes a revision of the state before each change, and restores it', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, sample(), 'First');
    const changed = sample();
    changed.profile.headline = 'Changed headline';
    await saveProfile(user.id, changed, 'Second');
    const revs = await listRevisions(user.id);
    expect(revs.map((r) => r.note)).toEqual(['Second', 'First']);
    await restoreRevision(user.id, revs[0].id);
    expect((await loadProfileDoc(user.id))!.profile.headline).toBe('Backend engineer');
    expect((await listRevisions(user.id))[0].note).toMatch(/^Restored the profile from /);
  });

  it('saves an empty headline and an empty claim list (the check of a save is not strict)', async () => {
    const { user } = await makeUser();
    const doc = sample();
    doc.profile.headline = '';
    doc.claims = [];
    const r = await saveProfile(user.id, doc, 'Sparse');
    expect(r.version).toBe(1);
    expect((await loadProfileDoc(user.id))!.profile.headline).toBe('');
  });

  it('refuses to restore a damaged revision with a clear message', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, sample(), 'First');
    const [rev] = await listRevisions(user.id);
    await db.profileRevision.update({ where: { id: rev.id }, data: { snapshot: '{not json' } });
    await expect(restoreRevision(user.id, rev.id)).rejects.toMatchObject({ status: 422, message: 'This saved copy of the profile is damaged. Choose another one.' });
    expect(await profileVersion(user.id)).toBe(1);
  });

  it('keeps the newest 50 revisions', async () => {
    const { user } = await makeUser();
    const d = sample();
    for (let i = 0; i < 52; i++) {
      d.profile.headline = `Headline ${i}`;
      await saveProfile(user.id, d, `Write ${i}`);
    }
    const revs = await listRevisions(user.id);
    expect(revs.length).toBe(50);
    expect(revs[0].note).toBe('Write 51');
  }, 60_000);

  it('reads again when another process changes the version', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, sample(), 'First');
    const a = await loadProfileDoc(user.id);
    expect(await loadProfileDoc(user.id)).toBe(a);
    await db.profileMeta.update({ where: { userId: user.id }, data: { headline: 'From elsewhere', version: { increment: 1 } } });
    expect((await loadProfileDoc(user.id))!.profile.headline).toBe('From elsewhere');
  });

  it('keeps users apart', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await saveProfile(a.user.id, sample(), 'A writes');
    expect(await loadProfileDoc(b.user.id)).toBeNull();
    const [rev] = await listRevisions(a.user.id);
    await expect(restoreRevision(b.user.id, rev.id)).rejects.toMatchObject({ status: 404 });
    // The same slugs in two profiles do not collide.
    await saveProfile(b.user.id, sample(), 'B writes');
    expect((await loadProfileDoc(b.user.id))!.claims.length).toBe(3);
    expect((await loadProfileDoc(a.user.id))!.claims.length).toBe(3);
  });
});

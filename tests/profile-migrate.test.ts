import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalDoc, checkYaml } from '@/lib/profile/doc';
import { listRevisions, loadProfileDoc } from '@/lib/profile/store';
import { migrateClaimsText } from '@/lib/profile/migrate';
import * as doc from '@/lib/profile/doc';
import { makeUser } from './helpers/http';

const SAMPLE = readFileSync('tests/fixtures/claims-sample.yml', 'utf8');

describe('migrateClaimsText', () => {
  it('writes the file into the tables of that user and checks the round trip', async () => {
    const { user } = await makeUser('admin');
    const r = await migrateClaimsText(user.email.toUpperCase(), SAMPLE);
    expect(r).toEqual({ ok: true, counts: { positions: 1, educations: 1, projects: 1, claims: 3 }, warnings: expect.any(Array), replaced: false });
    expect(canonicalDoc((await loadProfileDoc(user.id))!)).toEqual(canonicalDoc(checkYaml(SAMPLE).doc!));
    expect((await listRevisions(user.id))[0].note).toBe('Migrated from claims.yml');
  });

  it('refuses a file that fails the strict check', async () => {
    const { user } = await makeUser();
    const r = await migrateClaimsText(user.email, SAMPLE.replace('headline: Backend engineer', 'headline: ""'));
    expect(r).toEqual({ ok: false, errors: [expect.stringMatching(/^profile\.headline/)] });
    expect(await loadProfileDoc(user.id)).toBeNull();
  });

  it('refuses an unknown email', async () => {
    expect(await migrateClaimsText('nobody@test.local', SAMPLE)).toEqual({ ok: false, errors: ['No user has the email nobody@test.local.'] });
  });

  it('rolls back and names the difference when the round trip loses data', async () => {
    const { user } = await makeUser();
    // A broken export that drops the headline stands for any loss in the tables.
    const spy = vi.spyOn(doc, 'toYaml').mockImplementation((d) => `version: 1\nprofile:\n  name: ${d.profile.name}\n`);
    try {
      const r = await migrateClaimsText(user.email, SAMPLE);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join('\n')).toMatch(/profile\.headline/);
      expect(await loadProfileDoc(user.id)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('says when it replaces a profile that exists', async () => {
    const { user } = await makeUser();
    await migrateClaimsText(user.email, SAMPLE);
    const r = await migrateClaimsText(user.email, SAMPLE);
    expect(r.ok && r.replaced).toBe(true);
  });
});

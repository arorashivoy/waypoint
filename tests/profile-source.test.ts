import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkYaml } from '@/lib/profile/doc';
import { saveProfile } from '@/lib/profile/store';
import { claimsFor, profileSummary } from '@/lib/user';
import { makeUser } from './helpers/http';

const sample = () => checkYaml(readFileSync('tests/fixtures/claims-sample.yml', 'utf8')).doc!;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]));
}

describe('the profile source', () => {
  it('gives the admin and a member each their own profile from the tables', async () => {
    const admin = await makeUser('admin');
    const member = await makeUser();
    expect(await claimsFor(admin.user.id)).toBeNull();
    await saveProfile(member.user.id, sample(), 'Member writes');
    expect((await claimsFor(member.user.id))!.profile.name).toBe('Test Person');
    expect(await claimsFor(admin.user.id)).toBeNull();
  });

  it('gives an empty profile summary before the first item', async () => {
    const { user } = await makeUser();
    const p = await profileSummary(user.id);
    expect(p.positions).toEqual([]);
    expect(p.name).toBe('Test User');
  });

  it('builds the summary from the stored profile', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, sample(), 'Write');
    const p = await profileSummary(user.id);
    expect(p.headline).toBe('Backend engineer');
    expect(p.positions[0].company).toBe('Acme');
    expect(p.school?.short).toBe('TU Test');
  });

  it('has no runtime code that reads claims.yml', () => {
    const readers = files('src').filter((f) => f !== join('src', 'lib', 'claims.ts') && /CLAIMS_PATH|loadClaims|claimsFailure/.test(readFileSync(f, 'utf8')));
    expect(readers).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { deleteSecret, readSecret, saveSecret, seal, secretHint, unseal } from '@/lib/secrets';

const newUser = () =>
  db.user.create({ data: { email: `s-${randomBytes(6).toString('hex')}@test.local`, name: 'S' } });

describe('seal and unseal', () => {
  const key = randomBytes(32);

  it('round-trips and uses a new IV each time', () => {
    const a = seal('sk-ant-secret-value', 'u1:anthropic', key);
    const b = seal('sk-ant-secret-value', 'u1:anthropic', key);
    expect(Buffer.from(a.iv, 'base64')).toHaveLength(12);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toContain('secret');
    expect(unseal(a, 'u1:anthropic', key)).toBe('sk-ant-secret-value');
  });

  it('fails for another user, a changed tag or another key', () => {
    const s = seal('value', 'u1:anthropic', key);
    expect(() => unseal(s, 'u2:anthropic', key)).toThrow();
    const tag = Buffer.from(s.tag, 'base64');
    tag[0] ^= 1;
    expect(() => unseal({ ...s, tag: tag.toString('base64') }, 'u1:anthropic', key)).toThrow();
    expect(() => unseal(s, 'u1:anthropic', randomBytes(32))).toThrow();
  });
});

describe('user secrets', () => {
  it('saves, reads, hints and deletes', async () => {
    const u = await newUser();
    expect(await readSecret(u.id, 'anthropic')).toBeNull();
    await saveSecret(u.id, 'anthropic', 'sk-ant-api03-abcdefWXYZ');
    expect(await readSecret(u.id, 'anthropic')).toBe('sk-ant-api03-abcdefWXYZ');
    expect(await secretHint(u.id, 'anthropic')).toBe('WXYZ');
    const row = await db.userSecret.findUniqueOrThrow({ where: { userId_kind: { userId: u.id, kind: 'anthropic' } } });
    expect(row.data).not.toContain('abcdef');
    expect(row.keyVersion).toBe(1);
    await deleteSecret(u.id, 'anthropic');
    expect(await readSecret(u.id, 'anthropic')).toBeNull();
  });

  it('cannot read a row that is copied to another user', async () => {
    const a = await newUser();
    const b = await newUser();
    await saveSecret(a.id, 'github', 'ghp_secret_of_a');
    const row = await db.userSecret.findUniqueOrThrow({ where: { userId_kind: { userId: a.id, kind: 'github' } } });
    await db.userSecret.create({ data: { ...row, userId: b.id } });
    expect(await readSecret(b.id, 'github')).toBeNull();
  });
});

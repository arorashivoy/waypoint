import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from '@/lib/auth/password';
import { hashToken, newToken } from '@/lib/auth/tokens';

describe('passwords', () => {
  it('hashes with argon2id and checks the password', async () => {
    const h = await hashPassword('a long passphrase 123');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'a long passphrase 123')).toBe(true);
    expect(await verifyPassword(h, 'a long passphrase 124')).toBe(false);
  });

  it('returns false for a stored value that is not a hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever whatever')).toBe(false);
  });

  it('runs a check without a user', async () => {
    await expect(burnPasswordCheck('anything at all')).resolves.toBeUndefined();
  });

  it('refuses short and long passwords', () => {
    expect(passwordProblem('elevenchars')).toMatch(/12 characters/);
    expect(passwordProblem('x'.repeat(257))).toMatch(/256/);
    expect(passwordProblem('twelve chars')).toBeNull();
  });

  it('refuses a common password in any letter case', () => {
    const common = readFileSync('src/lib/auth/common-passwords.txt', 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s.length >= 12);
    expect(common).toBeTruthy();
    expect(passwordProblem(common!)).toMatch(/common/);
    expect(passwordProblem(common!.toUpperCase())).toMatch(/common/);
  });

  it('refuses the email or the name as the password', () => {
    expect(passwordProblem('janedoe12345@x.test', { email: 'JaneDoe12345@x.test' })).toMatch(/name or email/);
    expect(passwordProblem('janedoe12345', { email: 'janedoe12345@x.test' })).toMatch(/name or email/);
    expect(passwordProblem('Jane Doe The Third', { name: 'jane doe the third' })).toMatch(/name or email/);
  });
});

describe('tokens', () => {
  it('makes 32 random bytes and keeps only the SHA-256 hash', () => {
    const a = newToken();
    const b = newToken();
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a.token)).toBe(a.hash);
  });
});

import { describe, expect, it, vi } from 'vitest';

// A slow, fake argon2 that counts how many calls run at the same time.
const argon = vi.hoisted(() => {
  const state = { active: 0, peak: 0, calls: 0 };
  const slow = async <T>(value: T): Promise<T> => {
    state.calls++;
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    await new Promise((r) => setTimeout(r, 20));
    state.active--;
    return value;
  };
  return { state, hash: vi.fn(() => slow('$argon2id$fake')), verify: vi.fn(() => slow(true)) };
});
vi.mock('@node-rs/argon2', () => ({ hash: argon.hash, verify: argon.verify }));

import { burnPasswordCheck, hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password work', () => {
  it('runs at most 2 hashes or checks at the same time', async () => {
    argon.state.peak = 0;
    argon.state.calls = 0;
    const work = [
      ...Array.from({ length: 4 }, () => hashPassword('a long passphrase 123')),
      ...Array.from({ length: 4 }, () => verifyPassword('$argon2id$fake', 'a long passphrase 123')),
      ...Array.from({ length: 4 }, () => burnPasswordCheck('a long passphrase 123')),
    ];
    await Promise.all(work);
    // 4 hashes, 4 checks, 4 dummy checks and 1 dummy hash.
    expect(argon.state.calls).toBe(13);
    expect(argon.state.peak).toBe(2);
  });

  it('frees the slot when a check fails', async () => {
    argon.verify.mockImplementationOnce(() => Promise.reject(new Error('bad hash')));
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    argon.state.peak = 0;
    await Promise.all([verifyPassword('a', 'b'), verifyPassword('a', 'b'), verifyPassword('a', 'b')]);
    expect(argon.state.peak).toBe(2);
  });
});

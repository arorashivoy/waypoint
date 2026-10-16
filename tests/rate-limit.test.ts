import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { clearLimit, clientIp, hitLimit } from '@/lib/auth/rate-limit';

const key = () => `test:${randomBytes(6).toString('hex')}`;

describe('hitLimit', () => {
  it('allows max tries in the window, then refuses with a wait time', async () => {
    const k = key();
    const t0 = new Date('2026-10-16T10:00:00Z');
    for (let i = 0; i < 3; i++) expect((await hitLimit(k, 3, 60_000, t0)).ok).toBe(true);
    const no = await hitLimit(k, 3, 60_000, new Date(t0.getTime() + 10_000));
    expect(no.ok).toBe(false);
    expect(no.retryAfterSec).toBe(50);
  });

  it('starts a new window after the old one ends', async () => {
    const k = key();
    const t0 = new Date('2026-10-16T10:00:00Z');
    for (let i = 0; i < 3; i++) await hitLimit(k, 3, 60_000, t0);
    expect((await hitLimit(k, 3, 60_000, new Date(t0.getTime() + 60_000))).ok).toBe(true);
  });

  it('clears a key', async () => {
    const k = key();
    const t0 = new Date();
    for (let i = 0; i < 3; i++) await hitLimit(k, 3, 60_000, t0);
    await clearLimit(k);
    expect((await hitLimit(k, 3, 60_000, t0)).ok).toBe(true);
  });
});

describe('clientIp', () => {
  it('takes the first X-Forwarded-For entry', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers())).toBe('local');
  });
});

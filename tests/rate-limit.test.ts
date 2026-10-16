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

  it('does not pass the cap when calls run in parallel', async () => {
    const k = key();
    const t0 = new Date();
    const results = await Promise.all(Array.from({ length: 15 }, () => hitLimit(k, 10, 60_000, t0)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
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
  it('takes the last X-Forwarded-For entry, which the nearest proxy added', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('10.0.0.1');
    expect(clientIp(new Headers({ 'x-forwarded-for': 'forged-by-client,  198.51.100.7 ' }))).toBe('198.51.100.7');
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('falls back to "local" when the header is missing or empty', () => {
    expect(clientIp(new Headers())).toBe('local');
    expect(clientIp(new Headers({ 'x-forwarded-for': '' }))).toBe('local');
    expect(clientIp(new Headers({ 'x-forwarded-for': ' , ' }))).toBe('local');
  });
});

import { describe, expect, it } from 'vitest';
import { ago, daysSince, longAgo } from '@/lib/time-ago';

const NOW = Date.parse('2026-10-20T12:00:00Z');

describe('time-ago', () => {
  it('writes the age of a posting in days and weeks', () => {
    expect(ago('2026-10-20T08:00:00Z', NOW)).toBe('today');
    expect(ago('2026-10-19T08:00:00Z', NOW)).toBe('yesterday');
    expect(ago('2026-10-17T08:00:00Z', NOW)).toBe('3 days ago');
    expect(ago('2026-10-10T08:00:00Z', NOW)).toBe('1 week ago');
    expect(ago('2026-09-29T08:00:00Z', NOW)).toBe('3 weeks ago');
    expect(daysSince('2026-10-17T08:00:00Z', NOW)).toBe(3);
  });

  it('writes the age of a message in minutes, hours and days', () => {
    expect(longAgo('2026-10-20T11:59:50Z', NOW)).toBe('just now');
    expect(longAgo('2026-10-20T11:59:00Z', NOW)).toBe('1 minute ago');
    expect(longAgo('2026-10-20T11:15:00Z', NOW)).toBe('45 minutes ago');
    expect(longAgo('2026-10-20T09:00:00Z', NOW)).toBe('3 hours ago');
    expect(longAgo('2026-10-18T12:00:00Z', NOW)).toBe('2 days ago');
    expect(longAgo('not a date', NOW)).toBe('just now');
  });
});

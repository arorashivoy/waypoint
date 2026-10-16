import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/auth/safe-next';

describe('safeNext', () => {
  it.each(['/\t/evil.com', '/\n/evil.com', '/\r\\evil.com', '//evil.com', '/\\evil.com', 'https://evil.com', undefined, ''])(
    'refuses %j',
    (v) => {
      expect(safeNext(v)).toBe('/');
    },
  );

  it('keeps a local path with a query', () => {
    expect(safeNext('/jobs?x=1')).toBe('/jobs?x=1');
  });
});

import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/auth/safe-next';

describe('safeNext', () => {
  it.each(['/\t/evil.com', '/\n/evil.com', '/\r\\evil.com', '//evil.com', '/\\evil.com', 'https://evil.com', undefined, ''])(
    'refuses %j',
    (v) => {
      expect(safeNext(v)).toBe('/');
    },
  );

  it.each(['/..//evil.com', '/.//evil.com', '/a/..//evil.com', '/..\\/evil.com'])('keeps %j on the site', (v) => {
    const out = safeNext(v);
    expect(['/evil.com', '/']).toContain(out);
  });

  it('keeps a local path with a query', () => {
    expect(safeNext('/jobs?x=1')).toBe('/jobs?x=1');
  });
});

import { describe, expect, it } from 'vitest';
import { extractJson } from '@/lib/claude';

describe('test runner', () => {
  it('resolves the @ alias', () => {
    expect(extractJson('text {"a":1} text')).toEqual({ a: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { editVersion, startEdit } from '@/components/profile/version';

describe('the version of an edit', () => {
  it('follows the latest version while the form has no edits', () => {
    expect(editVersion(null, 4)).toBe(4);
    expect(editVersion(null, 5)).toBe(5);
  });

  it('takes the latest version when the first edit starts', () => {
    expect(startEdit(null, 4)).toBe(4);
  });

  it('keeps the version from the start of the edit when a newer one loads', () => {
    const base = startEdit(null, 4);
    expect(startEdit(base, 5)).toBe(4);
    expect(editVersion(base, 5)).toBe(4);
  });
});

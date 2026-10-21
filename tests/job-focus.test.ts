import { describe, expect, it } from 'vitest';
import { rowToFocus } from '@/components/jobs/focus';

describe('the row that gets focus when a job closes', () => {
  it('gives the row of the job that closed when focus is lost', () => {
    expect(rowToFocus('j1', null, true)).toBe('j1');
  });

  it('leaves focus where it is when it is on a control', () => {
    expect(rowToFocus('j1', null, false)).toBeNull();
  });

  it('does nothing when a job opens or changes', () => {
    expect(rowToFocus(null, 'j1', true)).toBeNull();
    expect(rowToFocus('j1', 'j2', true)).toBeNull();
  });

  it('does nothing when no job was open', () => {
    expect(rowToFocus(null, null, true)).toBeNull();
  });
});

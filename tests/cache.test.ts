import { describe, expect, it } from 'vitest';
import { cacheKey } from '@/lib/cache';

describe('cacheKey', () => {
  it('changes when the prompt version changes', () => {
    expect(cacheKey('v1', 'S', 'P')).not.toBe(cacheKey('v2', 'S', 'P'));
  });
  it('changes when the model changes', () => {
    expect(cacheKey('v1', 'S', 'P', 'claude-sonnet-5')).not.toBe(cacheKey('v1', 'S', 'P', 'claude-sonnet-5-5'));
  });
  it('cannot collide by moving text between system and prompt', () => {
    expect(cacheKey('v1', 'ab', 'c')).not.toBe(cacheKey('v1', 'a', 'bc'));
  });
});

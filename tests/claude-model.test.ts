import { describe, expect, it } from 'vitest';
import { assertSonnet, costUsd, MODEL, ModelError } from '@/lib/claude/model';

describe('assertSonnet', () => {
  it('accepts the pinned model', () => {
    expect(() => assertSonnet(MODEL)).not.toThrow();
    expect(MODEL.startsWith('claude-sonnet-')).toBe(true);
  });
  it('accepts Sonnet IDs with more version parts', () => {
    expect(() => assertSonnet('claude-sonnet-5-5')).not.toThrow();
    expect(() => assertSonnet('claude-sonnet-5')).not.toThrow();
  });
  it.each([
    'claude-opus-5-5',
    'claude-fable-5-1',
    'claude-haiku-5-5',
    'sonnet',
    '',
    'claude-sonnet',
    'claude-sonnet-5-opus',
    'claude-sonnet-5\n',
    'claude-sonnet-5\nclaude-opus-5',
    'claude-sonnet-5 --model x',
    'claude-sonnet-5-20260101x',
  ])('refuses %j', (id) => {
    expect(() => assertSonnet(id)).toThrow(ModelError);
  });
});

describe('costUsd', () => {
  it('prices Sonnet at $2 in, $10 out, $0.20 cache read, $2.50 cache write per million', () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(2);
    expect(costUsd({ inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(10);
    expect(costUsd({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBeCloseTo(0.2);
    expect(costUsd({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 })).toBeCloseTo(2.5);
  });
});

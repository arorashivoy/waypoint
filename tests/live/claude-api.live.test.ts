import { describe, expect, it } from 'vitest';
import { askApi } from '@/lib/claude/api';
import { HookReply } from '@/lib/schemas';

// Runs only with WAYPOINT_LIVE=1 and a real ANTHROPIC_API_KEY. One call spends a few cents.
describe.skipIf(!process.env.ANTHROPIC_API_KEY)('Claude API (live)', () => {
  it('returns a structured reply from a Sonnet model', async () => {
    const r = await askApi(process.env.ANTHROPIC_API_KEY!, {
      system: 'You write one-line hooks for cold emails. Answer with JSON only.',
      prompt: 'Write a hook for an engineer who builds Kafka pipelines.',
      schema: HookReply,
      effort: 'low',
    });
    expect(typeof r.data.hook).toBe('string');
    expect(r.usage.model).toMatch(/^claude-sonnet-/);
  }, 120_000);
});

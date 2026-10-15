import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { askApi } from '@/lib/claude/api';
import { HookReply } from '@/lib/schemas';
import { claudeAuthFailure, clearFailures } from '@/lib/claude/failures';

const ok = {
  stop_reason: 'end_turn',
  parsed_output: { hook: 'Kafka at scale' },
  content: [{ type: 'text', text: '{"hook":"Kafka at scale"}' }],
  usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
};
const fake = (impl: (p: any) => any) => ({ messages: { parse: vi.fn(async (p: any) => impl(p)) } });
const req = { system: 'SYS', prompt: 'PROMPT', schema: HookReply, effort: 'low' as const };

describe('askApi', () => {
  it('sends Sonnet, a structured output, the effort and a cached system block', async () => {
    const client = fake(() => ok);
    const r = await askApi('k', req, client);
    const p = client.messages.parse.mock.calls[0][0];
    expect(p.model).toMatch(/^claude-sonnet-/);
    expect(p.output_config.effort).toBe('low');
    expect(p.output_config.format).toBeDefined();
    expect(p.system).toEqual([{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
    expect(p.messages).toEqual([{ role: 'user', content: 'PROMPT' }]);
    expect(r.data).toEqual({ hook: 'Kafka at scale' });
    expect(r.usage.costUsd).toBeCloseTo((100 * 2 + 10 * 10 + 50 * 0.2) / 1e6);
  });

  it('never sends fallbacks, tools or tool_choice', async () => {
    const client = fake(() => ok);
    await askApi('k', req, client);
    const p = client.messages.parse.mock.calls[0][0];
    expect(p).not.toHaveProperty('fallbacks');
    expect(p).not.toHaveProperty('tools');
    expect(p).not.toHaveProperty('tool_choice');
  });

  it('throws a RefusalError on stop_reason refusal', async () => {
    const client = fake(() => ({ ...ok, stop_reason: 'refusal', stop_details: { category: 'cyber' }, parsed_output: null }));
    await expect(askApi('k', req, client)).rejects.toThrow(/declined.*cyber/);
  });

  it('sets the auth banner on a 401 and does not try the CLI', async () => {
    clearFailures();
    const client = fake(() => {
      throw new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers());
    });
    await expect(askApi('bad', req, client)).rejects.toThrow();
    expect(claudeAuthFailure()?.message).toMatch(/ANTHROPIC_API_KEY/);
  });
});

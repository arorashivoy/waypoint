import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { askApi } from '@/lib/claude/api';
import { HookReply } from '@/lib/schemas';
import { ClaudeCallError, RefusalError } from '@/lib/claude/types';
import { claudeAuthFailure, clearFailures } from '@/lib/claude/failures';

const ok = {
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: '{"hook":"Kafka at scale"}' }],
  usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
};
const fake = (impl: (p: any) => any) => ({ messages: { create: vi.fn(async (p: any) => impl(p)) } });
const req = { system: 'SYS', prompt: 'PROMPT', schema: HookReply, effort: 'low' as const };

describe('askApi', () => {
  it('sends Sonnet, a structured output, the effort and a cached system block', async () => {
    const client = fake(() => ok);
    const r = await askApi('k', req, client);
    const p = client.messages.create.mock.calls[0][0];
    expect(p.model).toMatch(/^claude-sonnet-/);
    expect(p.output_config.effort).toBe('low');
    expect(p.output_config.format).toBeDefined();
    expect(p.system).toEqual([{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
    expect(p.messages).toEqual([{ role: 'user', content: 'PROMPT' }]);
    expect(r.data).toEqual({ hook: 'Kafka at scale' });
    expect(r.raw).toBe('{"hook":"Kafka at scale"}');
    expect(r.usage.costUsd).toBeCloseTo((100 * 2 + 10 * 10 + 50 * 0.2) / 1e6);
  });

  it('never sends fallbacks, tools, tool_choice or thinking', async () => {
    const client = fake(() => ok);
    await askApi('k', req, client);
    const p = client.messages.create.mock.calls[0][0];
    expect(p).not.toHaveProperty('fallbacks');
    expect(p).not.toHaveProperty('tools');
    expect(p).not.toHaveProperty('tool_choice');
    expect(p).not.toHaveProperty('thinking');
  });

  it('throws a RefusalError on stop_reason refusal', async () => {
    const client = fake(() => ({ ...ok, stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }));
    await expect(askApi('k', req, client)).rejects.toThrow(/declined.*cyber/);
  });

  it('throws a RefusalError with the category and usage when the refusal has a text block', async () => {
    const client = fake(() => ({ ...ok, stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [{ type: 'text', text: '{"hoo' }] }));
    const e: any = await askApi('k', req, client).catch((x) => x);
    expect(e).toBeInstanceOf(RefusalError);
    expect(e.category).toBe('cyber');
    expect(e.usage.inputTokens).toBe(100);
  });

  it('throws a ClaudeCallError with usage on max_tokens', async () => {
    const client = fake(() => ({ ...ok, stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"hook":"Kaf' }] }));
    const e: any = await askApi('k', req, client).catch((x) => x);
    expect(e).toBeInstanceOf(ClaudeCallError);
    expect(e.message).toMatch(/cut off at max_tokens/);
    expect(e.usage.outputTokens).toBe(10);
  });

  it('throws a ClaudeCallError with usage when valid JSON fails the schema', async () => {
    const client = fake(() => ({ ...ok, content: [{ type: 'text', text: '{"hook":5}' }] }));
    const e: any = await askApi('k', req, client).catch((x) => x);
    expect(e).toBeInstanceOf(ClaudeCallError);
    expect(e.message).toMatch(/did not match the schema: hook/);
    expect(e.usage.costUsd).toBeGreaterThan(0);
  });

  it('sends no parse function in the format and defaults max_tokens to 16000', async () => {
    const client = fake(() => ok);
    await askApi('k', req, client);
    const p = client.messages.create.mock.calls[0][0];
    expect(p.output_config.format.type).toBe('json_schema');
    expect(p.output_config.format).not.toHaveProperty('parse');
    expect(p.max_tokens).toBe(16000);
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

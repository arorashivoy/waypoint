import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

vi.mock('@/lib/claude/cli', () => ({ askCli: vi.fn(), cliBinary: vi.fn(() => '/usr/bin/claude') }));
vi.mock('@/lib/claude/api', () => ({ askApi: vi.fn() }));
// credentialFor reads the global cliDisabled row. claude-selftest.test.ts writes that row, and it can run at the same time.
vi.mock('@/lib/claude/selftest', () => ({ cliDisabled: vi.fn(async () => null), runCliSelfTestAtStart: vi.fn() }));

import { prompt } from '@/lib/prompts';

const KEY = Buffer.alloc(32, 1).toString('base64');
const usage = { model: 'claude-sonnet-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
const req = { system: prompt`S`, prompt: prompt`P`, schema: z.object({ hook: z.string() }), effort: 'low' as const };

async function load(extra: Record<string, string> = {}, role: 'admin' | 'member' = 'admin') {
  vi.resetModules();
  process.env = { ...process.env, WAYPOINT_SECRET_KEY: KEY, ANTHROPIC_API_KEY: '', ...extra };
  const { db } = await import('@/lib/db');
  const u = await db.user.create({ data: { email: `i-${randomBytes(6).toString('hex')}@test.local`, name: 'I', role } });
  const ctx = { userId: u.id, kind: 'test' };
  const claude = await import('@/lib/claude');
  const cli = await import('@/lib/claude/cli');
  const api = await import('@/lib/claude/api');
  return { claude, cli: vi.mocked(cli), api: vi.mocked(api), ctx };
}

describe('credential order', () => {
  it('does not fall back to the CLI when the API call fails', async () => {
    const { claude, cli, api, ctx } = await load({ ANTHROPIC_API_KEY: 'sk-ant-bad' }, 'admin');
    api.askApi.mockRejectedValueOnce(new Error('401'));
    await expect(claude.askJson(req, ctx)).rejects.toThrow('401');
    expect(cli.askCli).not.toHaveBeenCalled();
  });
});

describe('CLI repair retry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks one time for a repair when the reply does not match', async () => {
    const { claude, cli, ctx } = await load();
    cli.askCli.mockResolvedValueOnce({ text: '{"hok":"x"}', usage, denials: 0 }).mockResolvedValueOnce({ text: '{"hook":"fixed"}', usage, denials: 0 });
    const r = await claude.askJson(req, ctx);
    expect(r.data).toEqual({ hook: 'fixed' });
    expect(cli.askCli).toHaveBeenCalledTimes(2);
    expect(cli.askCli.mock.calls[1][1]).toMatch(/did not match/);
  });

  it('sums the usage of both calls after a repair', async () => {
    const { claude, cli, ctx } = await load();
    const u2 = { ...usage, inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4, costUsd: 0.5 };
    cli.askCli.mockResolvedValueOnce({ text: '{"hok":"x"}', usage, denials: 0 }).mockResolvedValueOnce({ text: '{"hook":"fixed"}', usage: u2, denials: 0 });
    const r = await claude.askJson(req, ctx);
    expect(r.usage).toEqual({ ...usage, inputTokens: 11, outputTokens: 21, cacheReadTokens: 3, cacheWriteTokens: 4, costUsd: 0.5 });
  });

  it('keeps the summed usage on a failed repair', async () => {
    const { claude, cli, ctx } = await load();
    cli.askCli.mockResolvedValue({ text: '{"hok":"x"}', usage, denials: 0 });
    const err = await claude.askJson(req, ctx).catch((e) => e);
    expect(err).toBeInstanceOf(claude.ClaudeCallError);
    expect(err.message).toMatch(/schema/);
    expect(err.usage).toEqual({ ...usage, inputTokens: 2, outputTokens: 2 });
  });

  it('fails after one repair', async () => {
    const { claude, cli, ctx } = await load();
    cli.askCli.mockResolvedValue({ text: '{"hok":"x"}', usage, denials: 0 });
    await expect(claude.askJson(req, ctx)).rejects.toThrow(/schema/);
    expect(cli.askCli).toHaveBeenCalledTimes(2);
  });

  it('throws when no credential exists', async () => {
    const { claude, ctx } = await load();
    await expect(claude.askJson(req, ctx, null)).rejects.toBeInstanceOf(claude.NoCredentialError);
  });
});

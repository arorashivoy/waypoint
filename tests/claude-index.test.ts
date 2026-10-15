import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/claude/cli', () => ({ askCli: vi.fn(), cliBinary: vi.fn(() => '/usr/bin/claude') }));
vi.mock('@/lib/claude/api', () => ({ askApi: vi.fn() }));

const KEY = Buffer.alloc(32, 1).toString('base64');
const usage = { model: 'claude-sonnet-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
const req = { system: 'S', prompt: 'P', schema: z.object({ hook: z.string() }), effort: 'low' as const };

async function load(extra: Record<string, string> = {}) {
  vi.resetModules();
  process.env = { ...process.env, DATABASE_URL: 'file:x.db', WAYPOINT_SECRET_KEY: KEY, ANTHROPIC_API_KEY: '', ...extra };
  const claude = await import('@/lib/claude');
  const cli = await import('@/lib/claude/cli');
  const api = await import('@/lib/claude/api');
  return { claude, cli: vi.mocked(cli), api: vi.mocked(api) };
}

describe('credential order', () => {
  it('uses the API key when ANTHROPIC_API_KEY is set', async () => {
    const { claude } = await load({ ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(await claude.serverCredential()).toEqual({ kind: 'api', key: 'sk-ant-x', source: 'shared' });
    expect((await claude.detectMode(true)).mode).toBe('api');
  });

  it('uses the CLI subscription when no API key is set', async () => {
    const { claude } = await load();
    expect(await claude.serverCredential()).toEqual({ kind: 'cli' });
  });

  it('does not fall back to the CLI when the API call fails', async () => {
    const { claude, cli, api } = await load({ ANTHROPIC_API_KEY: 'sk-ant-bad' });
    api.askApi.mockRejectedValueOnce(new Error('401'));
    await expect(claude.askJson(req)).rejects.toThrow('401');
    expect(cli.askCli).not.toHaveBeenCalled();
  });
});

describe('CLI repair retry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks one time for a repair when the reply does not match', async () => {
    const { claude, cli } = await load();
    cli.askCli.mockResolvedValueOnce({ text: '{"hok":"x"}', usage, denials: 0 }).mockResolvedValueOnce({ text: '{"hook":"fixed"}', usage, denials: 0 });
    const r = await claude.askJson(req);
    expect(r.data).toEqual({ hook: 'fixed' });
    expect(cli.askCli).toHaveBeenCalledTimes(2);
    expect(cli.askCli.mock.calls[1][1]).toMatch(/did not match/);
  });

  it('fails after one repair', async () => {
    const { claude, cli } = await load();
    cli.askCli.mockResolvedValue({ text: '{"hok":"x"}', usage, denials: 0 });
    await expect(claude.askJson(req)).rejects.toThrow(/schema/);
    expect(cli.askCli).toHaveBeenCalledTimes(2);
  });

  it('throws when no credential exists', async () => {
    const { claude, cli } = await load();
    cli.cliBinary.mockReturnValueOnce(null);
    await expect(claude.askJson(req, null)).rejects.toThrow(/No Claude/);
  });
});

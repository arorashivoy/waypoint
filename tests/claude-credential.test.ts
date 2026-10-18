import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

vi.mock('@/lib/claude/cli', async (orig) => ({ ...(await orig<typeof import('@/lib/claude/cli')>()), cliBinary: vi.fn(() => '/usr/bin/claude'), askCli: vi.fn() }));
vi.mock('@/lib/claude/api', () => ({ askApi: vi.fn() }));

import { prompt } from '@/lib/prompts';
import { db } from '@/lib/db';
import { resetEnvForTests } from '@/lib/env';
import { saveSecret } from '@/lib/secrets';
import { askApi } from '@/lib/claude/api';
import { askJson, ClaudeCallError, claudeStatus, credentialFor, NoCredentialError } from '@/lib/claude';
import { setAuthFailure, clearFailures } from '@/lib/claude/failures';
import { askCli } from '@/lib/claude/cli';
import { monthSpend, monthStart, nextReset, recordUsage } from '@/lib/claude/usage';

const user = (role: 'admin' | 'member' = 'member') =>
  db.user.create({ data: { email: `c-${randomBytes(6).toString('hex')}@test.local`, name: 'C', role } });
const usage = (costUsd: number) => ({ model: 'claude-sonnet-5', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd });

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-shared-key');
  vi.stubEnv('WAYPOINT_SHARED_MONTHLY_USD', '5');
  resetEnvForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  vi.mocked(askApi).mockReset();
});

describe('credentialFor', () => {
  it('uses the own key first', async () => {
    const u = await user();
    await saveSecret(u.id, 'anthropic', 'sk-ant-own-key-1234');
    expect(await credentialFor(u.id)).toEqual({ kind: 'api', key: 'sk-ant-own-key-1234', source: 'own' });
  });

  it('uses the shared key under the cap', async () => {
    const u = await user();
    await recordUsage(u.id, 'shared', 'analysis', usage(4.99));
    expect(await credentialFor(u.id)).toEqual({ kind: 'api', key: 'sk-ant-shared-key', source: 'shared' });
  });

  it('member over the cap: no credential, never the CLI', async () => {
    const u = await user('member');
    await recordUsage(u.id, 'shared', 'analysis', usage(5));
    expect(await credentialFor(u.id)).toBeNull();
    const s = await claudeStatus(u.id);
    expect(s.mode).toBe('none');
    expect(s.capReached).toBe(true);
    expect(s.detail).toMatch(/limit/);
  });

  it('admin over the cap: the CLI', async () => {
    const u = await user('admin');
    await recordUsage(u.id, 'shared', 'analysis', usage(6));
    expect(await credentialFor(u.id)).toEqual({ kind: 'cli' });
  });

  it('without a shared key: member none, admin CLI', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    resetEnvForTests();
    expect(await credentialFor((await user('member')).id)).toBeNull();
    expect(await credentialFor((await user('admin')).id)).toEqual({ kind: 'cli' });
  });

  it('does not count the spend of last month or of other users', async () => {
    const u = await user();
    const other = await user();
    await db.llmUsage.create({
      data: { userId: u.id, credential: 'shared', model: 'm', kind: 'k', inputTokens: 1, outputTokens: 1, costUsd: 50, createdAt: new Date(monthStart().getTime() - 1000) },
    });
    await recordUsage(other.id, 'shared', 'analysis', usage(50));
    expect(await monthSpend(u.id, 'shared')).toBe(0);
    expect((await credentialFor(u.id))?.kind).toBe('api');
  });

  it('gives no credential to a disabled user', async () => {
    const u = await user('admin');
    await db.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
    expect(await credentialFor(u.id)).toBeNull();
  });

  it('resets on the first day of the next month (UTC)', () => {
    expect(nextReset(new Date('2026-10-16T12:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(monthStart(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('askJson', () => {
  const req = { system: 's', prompt: prompt`p`, schema: z.object({ ok: z.boolean() }), effort: 'low' as const };

  it('writes one usage row with the credential and the kind', async () => {
    const u = await user();
    vi.mocked(askApi).mockResolvedValue({ data: { ok: true }, raw: '{"ok":true}', usage: usage(0.01) });
    await askJson(req, { userId: u.id, kind: 'analysis' });
    const rows = await db.llmUsage.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ credential: 'shared', kind: 'analysis', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    expect(vi.mocked(askApi).mock.calls[0][2]).toMatchObject({ failureKey: 'shared' });
  });

  it('writes a usage row for a failed call that used tokens', async () => {
    const u = await user();
    vi.mocked(askApi).mockRejectedValue(new ClaudeCallError('bad', usage(0.02)));
    await expect(askJson(req, { userId: u.id, kind: 'reply' })).rejects.toThrow('bad');
    expect(await monthSpend(u.id, 'shared')).toBeCloseTo(0.02);
  });

  it('throws NoCredentialError without a credential', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    resetEnvForTests();
    const u = await user('member');
    await expect(askJson(req, { userId: u.id, kind: 'analysis' })).rejects.toBeInstanceOf(NoCredentialError);
  });

  it('writes a usage row with credential own for an own key', async () => {
    const u = await user();
    await saveSecret(u.id, 'anthropic', 'sk-ant-own-key-1234');
    vi.mocked(askApi).mockResolvedValue({ data: { ok: true }, raw: '{"ok":true}', usage: usage(0.01) });
    await askJson(req, { userId: u.id, kind: 'analysis' });
    expect((await db.llmUsage.findMany({ where: { userId: u.id } }))[0]).toMatchObject({ credential: 'own' });
    expect(vi.mocked(askApi).mock.calls[0][2]).toMatchObject({ failureKey: `own:${u.id}` });
  });

  it('writes a usage row with credential cli for the admin CLI', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    resetEnvForTests();
    const u = await user('admin');
    vi.mocked(askCli).mockResolvedValue({ text: '{"ok":true}', usage: usage(0), denials: 0 });
    await askJson(req, { userId: u.id, kind: 'analysis' });
    expect(await db.llmUsage.findMany({ where: { userId: u.id } })).toMatchObject([{ credential: 'cli' }]);
  });
});

describe('claudeStatus banners', () => {
  it('does not show the banner of an own key to another user', async () => {
    const a = await user();
    const b = await user();
    await saveSecret(a.id, 'anthropic', 'sk-ant-own-key-1234');
    setAuthFailure(`own:${a.id}`, 'bad key');
    expect((await claudeStatus(a.id)).authFailure?.message).toBe('bad key');
    expect((await claudeStatus(b.id)).authFailure).toBeNull();
    clearFailures(`own:${a.id}`);
  });
});

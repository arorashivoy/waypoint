import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/claude/cli', async (orig) => ({ ...(await orig<typeof import('@/lib/claude/cli')>()), cliBinary: vi.fn(() => '/usr/bin/claude') }));

import { clearState, setState } from '@/lib/app-state';
import { db } from '@/lib/db';
import { cliBinary, parseCliReply, selfTestVerdict } from '@/lib/claude/cli';
import { cliDisabled, runCliSelfTestAtStart } from '@/lib/claude/selftest';

const fixture = JSON.parse(readFileSync('tests/fixtures/cli-reply.json', 'utf8'));

/** The canary with a fake CLI reply: the same steps as cliSelfTest, with no process. */
const canary = (patch: Record<string, unknown>) => async () => {
  try {
    const r = parseCliReply(JSON.stringify({ ...fixture, ...patch }), 'claude-sonnet-5');
    return selfTestVerdict(r.text, r.denials);
  } catch (e) {
    return { ok: false as const, why: (e as Error).message };
  }
};

// All tests here write the one global key `cliDisabled`, so they stay in this file and run in sequence.
afterEach(async () => {
  await clearState('cliDisabled');
  vi.mocked(cliBinary).mockReturnValue('/usr/bin/claude');
});

describe('runCliSelfTestAtStart', () => {
  it('turns CLI mode off when the canary reply names a file', async () => {
    const r = await runCliSelfTestAtStart(canary({ result: '.mcp-empty.json' }));
    expect(r).toMatchObject({ ran: true, ok: false });
    const off = await cliDisabled();
    expect(off?.reason).toMatch(/tools are on/);
    expect(Number.isNaN(Date.parse(off!.at))).toBe(false);
  });

  it('keeps a key out of the stored reason and the result', async () => {
    const r = await runCliSelfTestAtStart(async () => ({ ok: false, why: 'call failed: api_key=plainkey123456 sk-ant-api03-ABCDEF' }));
    expect(r).toMatchObject({ ran: true, ok: false });
    for (const text of [(await cliDisabled())!.reason, (r as { why: string }).why]) {
      expect(text).not.toMatch(/plainkey123456|sk-ant-api03/);
      expect(text).toContain('[removed]');
    }
  });

  it('turns CLI mode off when a tool call was denied', async () => {
    expect((await runCliSelfTestAtStart(canary({ result: 'NONE', permission_denials: [{}, {}] }))).ran).toBe(true);
    expect((await cliDisabled())?.reason).toMatch(/denied 2 tool call/);
  });

  it('turns CLI mode off when another model answers', async () => {
    const r = await runCliSelfTestAtStart(canary({ result: 'NONE', modelUsage: { 'claude-opus-5-5': {} } }));
    expect(r).toMatchObject({ ran: true, ok: false });
    expect((await cliDisabled())?.reason).toMatch(/claude-opus-5-5/);
  });

  it('turns CLI mode off when the reply used more than one turn', async () => {
    expect((await runCliSelfTestAtStart(canary({ result: 'NONE', num_turns: 3 }))).ran).toBe(true);
    expect((await cliDisabled())?.reason).toMatch(/turns/);
  });

  it('cuts the reason to 300 characters and does not throw when the test throws', async () => {
    const r = await runCliSelfTestAtStart(() => Promise.reject(new Error('x'.repeat(500))));
    expect(r).toMatchObject({ ran: true, ok: false });
    expect((await cliDisabled())?.reason).toHaveLength(300);
  });

  it('clears an old row when the canary passes', async () => {
    await setState('cliDisabled', { reason: 'old', at: new Date().toISOString() });
    expect(await runCliSelfTestAtStart(canary({ result: 'NONE' }))).toEqual({ ran: true, ok: true });
    expect(await cliDisabled()).toBeNull();
  });

  it('gives the abort signal to the canary', async () => {
    const ac = new AbortController();
    const test = vi.fn(async () => ({ ok: true as const }));
    await runCliSelfTestAtStart(test, ac.signal);
    expect(test).toHaveBeenCalledWith(ac.signal);
  });

  it('keeps the stored verdict when the worker stops during the canary', async () => {
    await setState('cliDisabled', { reason: 'keep', at: '2026-01-01T00:00:00.000Z' });
    const ac = new AbortController();
    const r = await runCliSelfTestAtStart(async () => {
      ac.abort();
      return { ok: false, why: 'claude was aborted' };
    }, ac.signal);
    expect(r).toEqual({ ran: false });
    expect(await cliDisabled()).toEqual({ reason: 'keep', at: '2026-01-01T00:00:00.000Z' });
  });

  it('reports a fail and does not throw when the database fails', async () => {
    const spy = vi.spyOn(db.appState, 'upsert').mockRejectedValueOnce(new Error('database is locked'));
    try {
      const r = await runCliSelfTestAtStart(async () => ({ ok: false, why: 'tools are on' }));
      expect(r).toMatchObject({ ran: true, ok: false });
    } finally {
      spy.mockRestore();
    }
  });

  it('does not run and does not change the row when no CLI is set up', async () => {
    vi.mocked(cliBinary).mockReturnValue(null);
    await setState('cliDisabled', { reason: 'keep', at: '2026-01-01T00:00:00.000Z' });
    const test = vi.fn();
    expect(await runCliSelfTestAtStart(test)).toEqual({ ran: false });
    expect(test).not.toHaveBeenCalled();
    expect(await cliDisabled()).toEqual({ reason: 'keep', at: '2026-01-01T00:00:00.000Z' });
  });
});

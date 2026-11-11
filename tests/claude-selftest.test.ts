import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/claude/cli', async (orig) => ({ ...(await orig<typeof import('@/lib/claude/cli')>()), cliBinary: vi.fn(() => '/usr/bin/claude') }));

import { clearState, setState } from '@/lib/app-state';
import { db } from '@/lib/db';
import { CliError, CliPolicyError, cliBinary, parseCliReply, selfTestFailure, selfTestVerdict } from '@/lib/claude/cli';
import { cliDisabled, retestCliWhenOff, runCliSelfTestAtStart } from '@/lib/claude/selftest';

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

describe('a fail that is not a verdict', () => {
  const timeout = async () => ({ ok: false as const, why: 'claude took longer than 30000 ms', retry: true });

  it('marks a time-out for a later test', async () => {
    expect(await runCliSelfTestAtStart(timeout)).toMatchObject({ ran: true, ok: false });
    expect(await cliDisabled()).toMatchObject({ retry: true, fails: 1 });
  });

  it('starts the count again at each worker start', async () => {
    await setState('cliDisabled', { reason: 'old', at: '2026-01-01T00:00:00.000Z', retry: true, fails: 7 });
    await runCliSelfTestAtStart(timeout);
    expect(await cliDisabled()).toMatchObject({ retry: true, fails: 1 });
  });

  it('does not mark a verdict about the tools', async () => {
    await runCliSelfTestAtStart(canary({ result: '.mcp-empty.json' }));
    expect((await cliDisabled())?.retry).toBeUndefined();
  });

  it('does not mark an error that the test throws', async () => {
    await runCliSelfTestAtStart(() => Promise.reject(new Error('broken')));
    expect((await cliDisabled())?.retry).toBeUndefined();
  });
});

describe('retestCliWhenOff', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const after = (ms: number) => new Date(Date.parse(at) + ms);
  const pass = async () => ({ ok: true as const });
  const timeout = async () => ({ ok: false as const, why: 'claude took longer than 30000 ms', retry: true });

  it('does nothing while CLI mode is on', async () => {
    const test = vi.fn(pass);
    expect(await retestCliWhenOff(test, undefined, after(3_600_000))).toEqual({ ran: false });
    expect(test).not.toHaveBeenCalled();
  });

  it('never tests again after a verdict about the tools or the model', async () => {
    await setState('cliDisabled', { reason: 'tools are on', at });
    const test = vi.fn(pass);
    expect(await retestCliWhenOff(test, undefined, after(86_400_000))).toEqual({ ran: false });
    expect(test).not.toHaveBeenCalled();
    expect(await cliDisabled()).toEqual({ reason: 'tools are on', at });
  });

  it('waits 1 minute after each of the first 2 fails', async () => {
    await setState('cliDisabled', { reason: 'slow', at, retry: true, fails: 1 });
    const test = vi.fn(timeout);
    expect(await retestCliWhenOff(test, undefined, after(59_000))).toEqual({ ran: false });
    expect(test).not.toHaveBeenCalled();
    expect(await retestCliWhenOff(test, undefined, after(60_000))).toMatchObject({ ran: true, ok: false });
    const off = await cliDisabled();
    expect(off).toMatchObject({ retry: true, fails: 2 });
    expect(off!.at).toBe(after(60_000).toISOString());
  });

  it('waits 10 minutes from the third fail', async () => {
    await setState('cliDisabled', { reason: 'slow', at, retry: true, fails: 3 });
    const test = vi.fn(timeout);
    expect(await retestCliWhenOff(test, undefined, after(599_000))).toEqual({ ran: false });
    expect(await retestCliWhenOff(test, undefined, after(600_000))).toMatchObject({ ran: true, ok: false });
    expect(test).toHaveBeenCalledTimes(1);
    expect(await cliDisabled()).toMatchObject({ retry: true, fails: 4 });
  });

  it('turns CLI mode on when the later test passes', async () => {
    await setState('cliDisabled', { reason: 'slow', at, retry: true, fails: 1 });
    expect(await retestCliWhenOff(pass, undefined, after(60_000))).toEqual({ ran: true, ok: true });
    expect(await cliDisabled()).toBeNull();
  });

  it('stops the later tests when a later test gives a verdict about the tools', async () => {
    await setState('cliDisabled', { reason: 'slow', at, retry: true, fails: 1 });
    await retestCliWhenOff(canary({ result: '.mcp-empty.json' }), undefined, after(60_000));
    const off = await cliDisabled();
    expect(off?.reason).toMatch(/tools are on/);
    expect(off?.retry).toBeUndefined();
  });

  it('does not throw when the database fails', async () => {
    const spy = vi.spyOn(db.appState, 'findUnique').mockRejectedValueOnce(new Error('database is locked'));
    try {
      expect(await retestCliWhenOff(pass, undefined, after(60_000))).toEqual({ ran: false });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('which fails can pass later', () => {
  it('a time-out or a failed call is not a verdict', () => {
    expect(selfTestFailure(new Error('claude took longer than 30000 ms'))).toEqual({ ok: false, why: 'claude took longer than 30000 ms', retry: true });
    expect(selfTestFailure(new CliError('claude exited 1: network')).retry).toBe(true);
  });

  it('a reply from another model or with more than 1 turn is a verdict', () => {
    expect(selfTestFailure(new CliPolicyError('The CLI took 2 turns.')).retry).toBe(false);
    expect(() => parseCliReply(JSON.stringify({ ...fixture, num_turns: 2 }), 'claude-sonnet-5')).toThrow(CliPolicyError);
    expect(() => parseCliReply(JSON.stringify({ ...fixture, modelUsage: { 'claude-opus-5-5': {} } }), 'claude-sonnet-5')).toThrow(CliPolicyError);
  });

  it('a named file or a denied tool call is a verdict', () => {
    expect(selfTestVerdict('.mcp-empty.json', 0)).toMatchObject({ ok: false });
    expect(selfTestVerdict('.mcp-empty.json', 0)).not.toHaveProperty('retry');
    expect(selfTestVerdict('NONE', 1)).not.toHaveProperty('retry');
  });

  it('an answer that is not NONE, with no sign of a tool, can pass later', () => {
    expect(selfTestVerdict('<invoke name="Bash">ls -A /tmp/x</invoke>', 0)).toMatchObject({ ok: false, retry: true });
    expect(selfTestVerdict('NONE', 0)).toEqual({ ok: true });
  });
});


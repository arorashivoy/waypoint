import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliArgs, parseCliReply, resolveClaudeBin, interpretCliRun, selfTestVerdict, CliError } from '@/lib/claude/cli';

const fixture = readFileSync('tests/fixtures/cli-reply.json', 'utf8');
const reply = (patch: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(fixture), ...patch });

describe('cliArgs', () => {
  const args = cliArgs('claude-sonnet-5', 'SYS', '/tmp/empty.json');
  it('turns off tools, MCP servers, settings and sessions', () => {
    expect(args).toEqual([
      '-p', '--output-format', 'json', '--model', 'claude-sonnet-5',
      '--tools', '', '--strict-mcp-config', '--mcp-config', '/tmp/empty.json',
      '--setting-sources', '', '--no-session-persistence', '--system-prompt', 'SYS',
    ]);
  });
  it('never uses --bare or --append-system-prompt', () => {
    expect(args).not.toContain('--bare');
    expect(args).not.toContain('--append-system-prompt');
  });
  it('refuses a model that is not Sonnet', () => {
    expect(() => cliArgs('claude-opus-5-5', 'SYS', '/tmp/e.json')).toThrow(/Sonnet/);
  });
});

describe('resolveClaudeBin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bin-test-'));
  const good = join(dir, 'claude');
  writeFileSync(good, '#!/bin/sh\n');
  chmodSync(good, 0o755);
  const foo = join(dir, 'foo');
  writeFileSync(foo, '#!/bin/sh\n');
  chmodSync(foo, 0o755);
  mkdirSync(join(dir, 'sub'));
  const noExec = join(dir, 'sub', 'claude');
  writeFileSync(noExec, 'x');
  chmodSync(noExec, 0o644);

  it('accepts an executable file named claude', () => {
    expect(resolveClaudeBin(good)).toBe(good);
  });
  it('refuses a file that is not executable', () => {
    expect(resolveClaudeBin(noExec)).toBeNull();
  });
  it('refuses a file not named claude', () => {
    expect(resolveClaudeBin(foo)).toBeNull();
  });
  it('refuses a missing file and a folder', () => {
    expect(resolveClaudeBin(join(dir, 'nothing', 'claude'))).toBeNull();
    expect(resolveClaudeBin(join(dir, 'sub'))).toBeNull();
  });
  it('refuses a plain name other than claude', () => {
    expect(resolveClaudeBin('foo')).toBeNull();
  });
  it('searches PATH for the plain name claude', () => {
    const old = process.env.PATH;
    process.env.PATH = dir;
    try {
      expect(resolveClaudeBin('claude')).toBe(good);
    } finally {
      process.env.PATH = old;
    }
  });
  it('refuses a relative path with a slash, before any process starts', () => {
    expect(() => resolveClaudeBin('./bin/claude')).toThrow(/WAYPOINT_CLAUDE_BIN must be absolute/);
    expect(() => resolveClaudeBin('bin/claude')).toThrow(CliError);
  });
});

describe('interpretCliRun', () => {
  it('accepts exit 0 with a good reply', () => {
    expect(interpretCliRun({ code: 0, stdout: fixture, stderr: '' }, 'claude-sonnet-5').text).toBe('{"hook":"OK"}');
  });
  it('refuses exit 1 even with a success-shaped body', () => {
    expect(() => interpretCliRun({ code: 1, stdout: fixture, stderr: '' }, 'claude-sonnet-5')).toThrow(/exited 1/);
  });
  it('refuses exit 1 with plain text', () => {
    expect(() => interpretCliRun({ code: 1, stdout: '', stderr: 'boom' }, 'claude-sonnet-5')).toThrow(/boom/);
  });
});

describe('selfTestVerdict', () => {
  it('passes NONE with no denials', () => {
    expect(selfTestVerdict('NONE', 0)).toEqual({ ok: true });
    expect(selfTestVerdict(' none. ', 0)).toEqual({ ok: true });
  });
  it('fails if the file is named', () => {
    expect(selfTestVerdict('.mcp-empty.json', 0).ok).toBe(false);
    expect(selfTestVerdict('NONE .mcp-empty.json', 0).ok).toBe(false);
  });
  it('fails on other text', () => {
    expect(selfTestVerdict('I have no tools, so none.', 0).ok).toBe(false);
  });
  it('fails on a denied tool call', () => {
    expect(selfTestVerdict('NONE', 1).ok).toBe(false);
  });
});

describe('parseCliReply', () => {
  it('reads the text and the usage', () => {
    const r = parseCliReply(fixture, 'claude-sonnet-5');
    expect(r.text).toBe('{"hook":"OK"}');
    expect(r.usage).toEqual({ model: 'claude-sonnet-5', inputTokens: 2, outputTokens: 27, cacheReadTokens: 0, cacheWriteTokens: 576, costUsd: 0 });
  });
  it('refuses a reply that used another model', () => {
    const other = reply({ modelUsage: { 'claude-sonnet-5': {}, 'claude-haiku-5-5': {} } });
    expect(() => parseCliReply(other, 'claude-sonnet-5')).toThrow(/claude-haiku-5-5/);
  });
  it('refuses a reply that did not use the requested model', () => {
    expect(() => parseCliReply(reply({ modelUsage: { 'claude-opus-5-5': {} } }), 'claude-sonnet-5')).toThrow(CliError);
  });
  it('refuses a reply with more than one turn (a tool ran)', () => {
    expect(() => parseCliReply(reply({ num_turns: 2 }), 'claude-sonnet-5')).toThrow(/turn/);
  });
  it('turns a refusal into a RefusalError', () => {
    expect(() => parseCliReply(reply({ stop_reason: 'refusal' }), 'claude-sonnet-5')).toThrow(/declined/);
  });
  it('reports is_error with its message', () => {
    expect(() => parseCliReply(reply({ is_error: true, result: 'Not logged in · Please run /login' }), 'claude-sonnet-5')).toThrow(/Not logged in/);
  });
  it('refuses a subtype that is not success', () => {
    expect(() => parseCliReply(reply({ subtype: 'error_max_turns' }), 'claude-sonnet-5')).toThrow(/error_max_turns/);
  });
  it('counts the permission denials', () => {
    expect(parseCliReply(reply({ permission_denials: [{}, {}] }), 'claude-sonnet-5').denials).toBe(2);
    expect(parseCliReply(fixture, 'claude-sonnet-5').denials).toBe(0);
  });
  it('refuses output that is not JSON', () => {
    expect(() => parseCliReply('plain text', 'claude-sonnet-5')).toThrow(CliError);
  });
});

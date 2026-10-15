import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cliArgs, parseCliReply, claudeBinOption, CliError } from '@/lib/claude/cli';

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

describe('claudeBinOption', () => {
  it('passes no bin for a plain name', () => {
    expect(claudeBinOption('claude')).toBeUndefined();
  });
  it('passes an absolute path', () => {
    expect(claudeBinOption('/usr/local/bin/claude')).toBe('/usr/local/bin/claude');
  });
  it('refuses a relative path with a slash, before any process starts', () => {
    expect(() => claudeBinOption('./bin/claude')).toThrow(/WAYPOINT_CLAUDE_BIN must be absolute/);
    expect(() => claudeBinOption('bin/claude')).toThrow(CliError);
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
  it('refuses output that is not JSON', () => {
    expect(() => parseCliReply('plain text', 'claude-sonnet-5')).toThrow(CliError);
  });
});

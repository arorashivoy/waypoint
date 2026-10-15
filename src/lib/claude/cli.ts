import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { baseEnv, findOnPath, runProgram } from '../exec';
import { env } from '../env';
import { assertSonnet, MODEL } from './model';
import { clearFailures, setAuthFailure, setQuotaFailure } from './failures';
import { RefusalError, type Usage } from './types';

/**
 * The admin's Claude subscription, through the `claude` CLI, with no tools.
 *
 * Claude Code is an agent: by default it can read files, search and fetch. A
 * posting or a résumé can hold text that asks it to read .env. So each call
 * turns off the built-in tools, MCP servers and all settings files, runs in a
 * new empty folder, and gets only PATH, HOME, LANG and the OAuth token. The
 * folder is empty and settings are off, so no CLAUDE.md reaches the model.
 * Not --bare: it turns off the subscription login.
 *
 * The reply names the models that ran. A reply with any model other than the
 * one asked for, or with more than one turn, is refused.
 */

export class CliError extends Error {}

const AUTH_HINT = /(not logged in|login|log in|logged out|not authenticated|unauthenticated|unauthorized|expired|invalid_token|401)/i;
const QUOTA_HINT = /(rate[_ -]?limit|rate limited|too many requests|quota|usage[_ -]?limit|out of credit|429)/i;

export function cliArgs(model: string, system: string, mcpConfigPath: string): string[] {
  assertSonnet(model);
  return [
    '-p', '--output-format', 'json', '--model', model,
    '--tools', '', '--strict-mcp-config', '--mcp-config', mcpConfigPath,
    '--setting-sources', '', '--no-session-persistence', '--system-prompt', system,
  ];
}

/** A plain name such as `claude` is found on PATH. A path must be absolute,
 *  because exec.ts refuses any other path. */
export function claudeBinOption(bin: string): string | undefined {
  if (!bin.includes('/')) return undefined;
  if (!isAbsolute(bin)) throw new CliError('WAYPOINT_CLAUDE_BIN must be absolute (for example /usr/local/bin/claude), or a plain name found on PATH.');
  return bin;
}

function record(detail: string) {
  if (QUOTA_HINT.test(detail)) {
    setQuotaFailure('The Claude subscription is out of usage for now. Wait for the quota to reset, or set ANTHROPIC_API_KEY in .env.');
  } else if (AUTH_HINT.test(detail)) {
    setAuthFailure(
      env().CLAUDE_CODE_OAUTH_TOKEN
        ? 'The Claude Code OAuth token was rejected. Run `claude setup-token` and update CLAUDE_CODE_OAUTH_TOKEN.'
        : 'The Claude CLI is signed out. Run `claude login` on the server.',
    );
  }
}

export function parseCliReply(stdout: string, model: string): { text: string; usage: Usage } {
  let r: any;
  try {
    r = JSON.parse(stdout);
  } catch {
    throw new CliError(`The CLI reply is not JSON: ${stdout.slice(0, 200)}`);
  }
  if (r.is_error) {
    const msg = String(r.result || 'the CLI reported an error');
    record(msg);
    throw new CliError(msg);
  }
  if (r.stop_reason === 'refusal') throw new RefusalError(null);

  const ran = Object.keys(r.modelUsage || {});
  const other = ran.filter((m) => m !== model);
  if (other.length) throw new CliError(`The CLI used ${other.join(', ')}. Waypoint sends calls only to ${model}.`);
  if (!ran.includes(model)) throw new CliError(`The CLI reply does not show ${model}.`);
  if (r.num_turns !== 1) throw new CliError(`The CLI took ${r.num_turns} turns. A call with no tools takes 1 turn.`);

  const u = r.modelUsage[model] || {};
  return {
    text: String(r.result ?? ''),
    usage: {
      model,
      inputTokens: Number(u.inputTokens) || 0,
      outputTokens: Number(u.outputTokens) || 0,
      cacheReadTokens: Number(u.cacheReadInputTokens) || 0,
      cacheWriteTokens: Number(u.cacheCreationInputTokens) || 0,
      costUsd: 0,
    },
  };
}

function childEnv() {
  return baseEnv({ CLAUDE_CODE_OAUTH_TOKEN: env().CLAUDE_CODE_OAUTH_TOKEN });
}

export async function askCli(system: string, prompt: string): Promise<{ text: string; usage: Usage }> {
  const { WAYPOINT_CLAUDE_BIN, WAYPOINT_CLAUDE_TIMEOUT_MS: timeoutMs } = env();
  // Check the path before any folder or process exists.
  const bin = claudeBinOption(WAYPOINT_CLAUDE_BIN);
  const work = mkdtempSync(join(tmpdir(), 'waypoint-claude-'));
  try {
    const mcp = join(work, '.mcp-empty.json');
    writeFileSync(mcp, '{"mcpServers":{}}');
    const res = await runProgram('claude', cliArgs(MODEL, system, mcp), {
      cwd: work,
      input: prompt,
      timeoutMs,
      env: childEnv(),
      bin,
    });
    if (res.code !== 0 && !res.stdout.trim().startsWith('{')) {
      const detail = (res.stderr || res.stdout).slice(0, 400);
      record(detail);
      throw new CliError(`claude exited ${res.code}: ${detail}`);
    }
    const out = parseCliReply(res.stdout, MODEL);
    clearFailures();
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function cliVersion(): Promise<string | null> {
  // `--version` is not an allowed argument shape in exec.ts on purpose; the
  // self-test below is the real check. Here we only look for the binary.
  const bin = env().WAYPOINT_CLAUDE_BIN;
  return claudeBinOption(bin) ?? findOnPath(bin);
}

/** One canary call: it asks the model to use a tool. parseCliReply refuses
 *  the reply if a tool ran (more than 1 turn) or another model answered. */
export async function cliSelfTest(): Promise<{ ok: true } | { ok: false; why: string }> {
  try {
    await askCli('You are a self-test. Answer in one word.', 'Use any tool you have to list the files here. If you have no tools, answer NONE.');
    return { ok: true };
  } catch (e) {
    return { ok: false, why: (e as Error).message };
  }
}

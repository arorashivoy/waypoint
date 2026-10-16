import { accessSync, constants, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { baseEnv, findOnPath, runProgram, type RunResult } from '../exec';
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

export type CliReply = { text: string; usage: Usage; denials: number };

export function cliArgs(model: string, system: string, mcpConfigPath: string): string[] {
  assertSonnet(model);
  return [
    '-p', '--output-format', 'json', '--model', model,
    '--tools', '', '--strict-mcp-config', '--mcp-config', mcpConfigPath,
    '--setting-sources', '', '--no-session-persistence', '--system-prompt', system,
  ];
}

/** Find the claude binary that askCli runs. A plain name must be exactly
 *  `claude` and is found on PATH. A path must be absolute, and an executable
 *  file named `claude`. Returns null if there is no such binary. A relative
 *  path with a slash throws, because exec.ts refuses it. */
export function resolveClaudeBin(bin: string): string | null {
  if (!bin.includes('/')) return bin === 'claude' ? findOnPath('claude') : null;
  if (!isAbsolute(bin)) throw new CliError('WAYPOINT_CLAUDE_BIN must be absolute (for example /usr/local/bin/claude), or the plain name claude.');
  try {
    if (!statSync(bin).isFile() || basename(bin) !== 'claude') return null;
    accessSync(bin, constants.X_OK);
    return bin;
  } catch {
    return null;
  }
}

/** The claude binary that the settings in .env name, or null. */
export function cliBinary(): string | null {
  try {
    return resolveClaudeBin(env().WAYPOINT_CLAUDE_BIN);
  } catch {
    return null;
  }
}

function record(detail: string) {
  if (QUOTA_HINT.test(detail)) {
    setQuotaFailure('cli', 'The Claude subscription is out of usage for now. Wait for the quota to reset, or set ANTHROPIC_API_KEY in .env.');
  } else if (AUTH_HINT.test(detail)) {
    setAuthFailure(
      'cli',
      env().CLAUDE_CODE_OAUTH_TOKEN
        ? 'The Claude Code OAuth token was rejected. Run `claude setup-token` and update CLAUDE_CODE_OAUTH_TOKEN.'
        : 'The Claude CLI is signed out. Run `claude login` on the server.',
    );
  }
}

export function parseCliReply(stdout: string, model: string): CliReply {
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
  if (r.subtype !== 'success') throw new CliError(`The CLI reply has subtype ${JSON.stringify(r.subtype)}, not "success".`);

  const ran = Object.keys(r.modelUsage || {});
  const other = ran.filter((m) => m !== model);
  if (other.length) throw new CliError(`The CLI used ${other.join(', ')}. Waypoint sends calls only to ${model}.`);
  if (!ran.includes(model)) throw new CliError(`The CLI reply does not show ${model}.`);
  if (r.num_turns !== 1) throw new CliError(`The CLI took ${r.num_turns} turns. A call with no tools takes 1 turn.`);

  const u = r.modelUsage[model] || {};
  return {
    text: String(r.result ?? ''),
    denials: Array.isArray(r.permission_denials) ? r.permission_denials.length : 0,
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

/** Decide what a finished run means. A non-zero exit code is a failure, even
 *  if stdout holds JSON that looks like a success. */
export function interpretCliRun(res: RunResult, model: string): CliReply {
  if (res.code !== 0) {
    let detail = (res.stderr || res.stdout).slice(0, 400);
    try {
      const r = JSON.parse(res.stdout);
      if (r && typeof r.result === 'string' && r.result) detail = r.result.slice(0, 400);
    } catch {
      /* keep the text above */
    }
    record(detail);
    throw new CliError(`claude exited ${res.code}: ${detail}`);
  }
  return parseCliReply(res.stdout, model);
}

export async function askCli(system: string, prompt: string): Promise<CliReply> {
  const { WAYPOINT_CLAUDE_BIN, WAYPOINT_CLAUDE_TIMEOUT_MS: timeoutMs } = env();
  // Find the binary before any folder or process exists.
  const bin = resolveClaudeBin(WAYPOINT_CLAUDE_BIN);
  if (!bin) throw new CliError('The claude CLI is not installed.');
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
    const out = interpretCliRun(res, MODEL);
    clearFailures('cli');
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The self-test passes only if the model saw no files (no tool ran) and the
 *  CLI denied no tool call. The work folder holds .mcp-empty.json, so a run
 *  with tools would name it. */
export function selfTestVerdict(text: string, denials: number): { ok: true } | { ok: false; why: string } {
  if (denials > 0) return { ok: false, why: `The CLI denied ${denials} tool call(s), so the model tried to use a tool.` };
  if (/mcp-empty/i.test(text)) return { ok: false, why: 'The model listed a file in the work folder, so tools are on.' };
  if (!/^\s*NONE\s*\.?\s*$/i.test(text)) return { ok: false, why: `The self-test answer was not NONE: ${text.slice(0, 200)}` };
  return { ok: true };
}

/** One canary call. parseCliReply refuses the reply if a tool ran (more than
 *  1 turn) or another model answered. selfTestVerdict checks the answer. */
export async function cliSelfTest(): Promise<{ ok: true } | { ok: false; why: string }> {
  try {
    const r = await askCli(
      'You are a self-test. Answer in one word.',
      'List the names of the files in your current working folder. If you cannot see any files, answer exactly NONE.',
    );
    return selfTestVerdict(r.text, r.denials);
  } catch (e) {
    return { ok: false, why: (e as Error).message };
  }
}

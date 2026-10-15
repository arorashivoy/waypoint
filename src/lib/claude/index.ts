import { env } from '../env';
import { askApi } from './api';
import { askCli, cliBinary } from './cli';
import { extractJson } from './json';
import { ClaudeCallError, type AskRequest, type AskResult, type Credential, type Usage } from './types';

/**
 * The one way to call Claude.
 *
 * Which account pays: an API key in .env wins; without one, the admin's
 * subscription through the CLI. A failed API call never falls back to the
 * CLI, so a wrong key shows as an auth banner and does not spend the
 * subscription in secret. Part 2 adds the key that each user saves.
 */

export { MODEL } from './model';
export { extractJson } from './json';
export { RefusalError, ClaudeCallError } from './types';
export type { AskRequest, AskResult, Credential, Effort, Usage } from './types';
export { claudeAuthFailure, claudeQuotaFailure, clearClaudeAuthFailure, clearClaudeQuotaFailure } from './failures';

export type ClaudeMode = 'cli' | 'api' | 'none';

let cachedMode: { mode: ClaudeMode; detail: string } | null = null;

export async function serverCredential(): Promise<Credential | null> {
  const key = env().ANTHROPIC_API_KEY;
  if (key) return { kind: 'api', key, source: 'shared' };
  return cliBinary() ? { kind: 'cli' } : null;
}

export async function detectMode(force = false): Promise<{ mode: ClaudeMode; detail: string }> {
  if (cachedMode && !force) return cachedMode;
  const cred = await serverCredential();
  cachedMode = !cred
    ? { mode: 'none', detail: 'No Claude is available. Set ANTHROPIC_API_KEY in .env, or run `claude login` on the server.' }
    : cred.kind === 'api'
      ? { mode: 'api', detail: 'ANTHROPIC_API_KEY · billed as API credit' }
      : { mode: 'cli', detail: `Claude Code CLI · your subscription${env().CLAUDE_CODE_OAUTH_TOKEN ? ' (CLAUDE_CODE_OAUTH_TOKEN)' : ''}` };
  return cachedMode;
}

/** Both CLI calls use the same model, so the token fields and the cost add up. */
function addUsage(a: Usage, b: Usage): Usage {
  return {
    model: a.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

export async function askJson<T>(req: AskRequest<T>, credential?: Credential | null): Promise<AskResult<T>> {
  const cred = credential === undefined ? await serverCredential() : credential;
  if (!cred) throw new Error('No Claude is available. Set ANTHROPIC_API_KEY in .env, or run `claude login` on the server.');
  if (cred.kind === 'api') return askApi(cred.key, req);

  // The CLI has no structured output. Check the reply, and ask one time for a
  // repair with the exact problems listed. If askCli throws, the error goes up
  // as it is: a repair is only for a reply that does not match the schema.
  const first = await askCli(req.system, req.prompt);
  const tryParse = (text: string) => {
    try {
      return req.schema.safeParse(extractJson(text));
    } catch (e) {
      return { success: false as const, error: { message: (e as Error).message } };
    }
  };
  const a = tryParse(first.text);
  if (a.success) return { data: a.data as T, raw: first.text, usage: first.usage };

  const repair = `${req.prompt}\n\nYour previous reply did not match the required JSON shape: ${String(a.error.message).slice(0, 600)}\nReply again with JSON only, with exactly the keys asked for.`;
  const second = await askCli(req.system, repair);
  const b = tryParse(second.text);
  const usage = addUsage(first.usage, second.usage);
  if (b.success) return { data: b.data as T, raw: second.text, usage };
  throw new ClaudeCallError(`The Claude reply did not match the schema after one repair: ${String(b.error.message).slice(0, 300)}`, usage);
}

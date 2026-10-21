import { askApi } from './api';
import { askCli } from './cli';
import { credentialFor, failureKey } from './credential';
import { extractJson } from './json';
import { ClaudeCallError, NoCredentialError, type AskRequest, type AskResult, type CallContext, type Credential, type Usage } from './types';
import { recordUsage } from './usage';
import { log } from '@/lib/log';
import { repairPrompt } from '@/lib/prompts/builder';

/**
 * The one way to call Claude.
 *
 * The credential is per user (see `credential.ts`): the user's own API key,
 * then the shared key under the monthly cap, then the CLI for the admin only.
 * A failed API call never falls back to the CLI, so a wrong key shows as an
 * auth banner and does not spend the subscription in secret. Each call writes
 * one `LlmUsage` row.
 */

export { forgetClient } from './api';
export { MODEL } from './model';
export { extractJson } from './json';
export { RefusalError, ClaudeCallError, NoCredentialError } from './types';
export type { AskRequest, AskResult, CallContext, Credential, Effort, Usage } from './types';
export { claudeAuthFailure, claudeQuotaFailure, clearFailures } from './failures';
export { credentialFor, claudeStatus, failureKey } from './credential';
export type { ClaudeMode, ClaudeStatus } from './credential';

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

/** Only the prompt eval sets these: another Sonnet ID for one run, and no `LlmUsage` row. */
export type AskOptions = { model?: string; record?: boolean };

export async function askJson<T>(req: AskRequest<T>, ctx: CallContext, credential?: Credential | null, opts: AskOptions = {}): Promise<AskResult<T>> {
  const cred = credential === undefined ? await credentialFor(ctx.userId) : credential;
  if (!cred) throw new NoCredentialError();
  const source = cred.kind === 'cli' ? 'cli' : cred.source;
  let usage: Usage | undefined;
  try {
    const result = cred.kind === 'api' ? await askApi(cred.key, req, { failureKey: failureKey(cred, ctx.userId), model: opts.model }) : await askCliJson(req, opts.model);
    usage = result.usage;
    return result;
  } catch (e) {
    usage = (e as { usage?: Usage }).usage;
    throw e;
  } finally {
    // A failed write of the usage row must not hide the reply or the error.
    if (usage && opts.record !== false) await recordUsage(ctx.userId, source, ctx.kind, usage).catch((err) => log.error({ err }, 'could not record usage'));
  }
}

async function askCliJson<T>(req: AskRequest<T>, model?: string): Promise<AskResult<T>> {
  // Pass `model` only when set, so a normal call has the same arguments as before.
  const ask = (prompt: typeof req.prompt) => (model ? askCli(req.system, prompt, model) : askCli(req.system, prompt));
  // The CLI has no structured output. Check the reply, and ask one time for a
  // repair with the exact problems listed. If askCli throws, the error goes up
  // as it is: a repair is only for a reply that does not match the schema.
  const first = await ask(req.prompt);
  const tryParse = (text: string) => {
    try {
      return req.schema.safeParse(extractJson(text));
    } catch (e) {
      return { success: false as const, error: { message: (e as Error).message } };
    }
  };
  const a = tryParse(first.text);
  if (a.success) return { data: a.data as T, raw: first.text, usage: first.usage };

  const repair = repairPrompt(req.prompt, String(a.error.message));
  const second = await ask(repair);
  const b = tryParse(second.text);
  const usage = addUsage(first.usage, second.usage);
  if (b.success) return { data: b.data as T, raw: second.text, usage };
  throw new ClaudeCallError(`The Claude reply did not match the schema after one repair: ${String(b.error.message).slice(0, 300)}`, usage);
}

import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { assertSonnet, costUsd, MODEL } from './model';
import { clearFailures, setAuthFailure, setQuotaFailure } from './failures';
import { ClaudeCallError, RefusalError, type AskRequest, type Usage } from './types';

/**
 * An API key, through the official SDK, with structured output.
 *
 * The API checks the reply against the task's schema, and the code checks it
 * again with zod. No tools are sent, so the model cannot ask the app to do
 * anything. Sonnet 5.5 refuses a forced tool call, which is why the shape
 * comes from output_config.format and not from a tool.
 *
 * The code calls `create`, not `parse`. `parse` reads the text before the code
 * can read stop_reason, so a refusal or a cut-off reply would lose its category
 * and its usage. Every failure after a reply carries `usage` for spend tracking.
 *
 * No `fallbacks`: a server-side fallback can send a refused request to an
 * Opus model. A refusal is a failed call here.
 */

export type MessagesClient = { messages: { create: (params: any) => Promise<any> } };

const clients = new Map<string, Anthropic>();
function clientFor(key: string): Anthropic {
  const id = createHash('sha256').update(key).digest('hex');
  let c = clients.get(id);
  if (!c) {
    c = new Anthropic({ apiKey: key, maxRetries: 2 });
    clients.set(id, c);
  }
  return c;
}

/** Removes the cached client of a key that the user replaced or deleted. */
export function forgetClient(key: string): void {
  clients.delete(createHash('sha256').update(key).digest('hex'));
}

// `create` takes the JSON schema format only ({ type: 'json_schema', schema }).
// The code drops the `parse` function of zodOutputFormat and checks the reply itself.
function jsonFormat(schema: unknown) {
  const { type, schema: jsonSchema } = zodOutputFormat(schema as any);
  return { type, schema: jsonSchema };
}

export async function askApi<T>(key: string, req: AskRequest<T>, opts: { failureKey: string; client?: MessagesClient }): Promise<{ data: T; raw: string; usage: Usage }> {
  const client: MessagesClient = opts.client ?? clientFor(key);
  assertSonnet(MODEL);
  let res: any;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: req.maxTokens ?? 16000,
      // The system prompt is the same for every job of a refresh, so it is
      // cached. Prompts shorter than the model's minimum are not cached; that
      // costs nothing.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.prompt }],
      output_config: { effort: req.effort, format: jsonFormat(req.schema) },
    });
  } catch (e) {
    const own = opts.failureKey.startsWith('own:');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      setAuthFailure(
        opts.failureKey,
        own ? 'The Anthropic API refused your key (401/403). Update your API key in Settings.' : 'The Anthropic API refused the key (401/403). Update ANTHROPIC_API_KEY in .env.',
      );
    } else if (e instanceof Anthropic.RateLimitError) {
      setQuotaFailure(opts.failureKey, 'The Anthropic API is limiting requests (429). Wait, or add credit in the Anthropic Console.');
    } else if (e instanceof Anthropic.BadRequestError) {
      const message = String((e as Error).message);
      if (/credit balance|billing|purchase credits/i.test(message)) {
        setQuotaFailure(
          opts.failureKey,
          own
            ? 'Your Anthropic account has no credit. Add credit, or remove your key in Settings to use the shared key.'
            : 'The shared Anthropic key has no credit. Add credit, or add your own API key in Settings.',
        );
      } else {
        console.error('[claude] API request refused (400):', message.slice(0, 300));
      }
    }
    throw e;
  }

  // Compute the usage first, so that every failure below can carry it.
  const u = res.usage || {};
  const tokens = {
    inputTokens: Number(u.input_tokens) || 0,
    outputTokens: Number(u.output_tokens) || 0,
    cacheReadTokens: Number(u.cache_read_input_tokens) || 0,
    cacheWriteTokens: Number(u.cache_creation_input_tokens) || 0,
  };
  const model: string = typeof res.model === 'string' ? res.model : MODEL;
  const usage: Usage = { model, ...tokens, costUsd: costUsd(tokens) };

  // The reply names the model that ran. Refuse it if it is not Sonnet.
  try {
    assertSonnet(model);
  } catch (e) {
    throw new ClaudeCallError((e as Error).message, usage);
  }

  if (res.stop_reason === 'refusal') throw new RefusalError(res.stop_details?.category ?? null, usage);
  if (res.stop_reason === 'max_tokens') throw new ClaudeCallError('The Claude reply was cut off at max_tokens; raise maxTokens', usage);

  const raw: string = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ClaudeCallError(`The API reply was not valid JSON (stop_reason ${res.stop_reason}).`, usage);
  }
  const parsed = req.schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue ? `${issue.path.join('.') || '(root)'} ${issue.message}` : 'unknown issue';
    throw new ClaudeCallError(`The API reply did not match the schema: ${where}`, usage);
  }
  clearFailures(opts.failureKey);
  return { data: parsed.data, raw, usage };
}

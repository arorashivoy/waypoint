import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { assertSonnet, costUsd, MODEL } from './model';
import { clearFailures, setAuthFailure, setQuotaFailure } from './failures';
import { RefusalError, type AskRequest, type Usage } from './types';

/**
 * An API key, through the official SDK, with structured output.
 *
 * The reply is checked against the task's zod schema by the API itself, so it
 * always has the right shape. No tools are sent, so the model cannot ask the
 * app to do anything. Sonnet 5.5 refuses a forced tool call, which is why the
 * shape comes from output_config.format and not from a tool.
 *
 * No `fallbacks`: a server-side fallback can send a refused request to an
 * Opus model. A refusal is a failed call here.
 */

export type MessagesClient = { messages: { parse: (params: any) => Promise<any> } };

const clients = new Map<string, Anthropic>();
function clientFor(key: string): Anthropic {
  let c = clients.get(key);
  if (!c) {
    c = new Anthropic({ apiKey: key, maxRetries: 2 });
    clients.set(key, c);
  }
  return c;
}

export async function askApi<T>(key: string, req: AskRequest<T>, client: MessagesClient = clientFor(key)): Promise<{ data: T; raw: string; usage: Usage }> {
  assertSonnet(MODEL);
  let res: any;
  try {
    res = await client.messages.parse({
      model: MODEL,
      max_tokens: req.maxTokens ?? 4096,
      // The system prompt is the same for every job of a refresh, so it is
      // cached. Prompts shorter than the model's minimum are not cached; that
      // costs nothing.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.prompt }],
      output_config: { effort: req.effort, format: zodOutputFormat(req.schema as any) },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      setAuthFailure('The Anthropic API refused the key (401/403). Update ANTHROPIC_API_KEY in .env.');
    } else if (e instanceof Anthropic.RateLimitError) {
      setQuotaFailure('The Anthropic API is limiting requests (429). Wait, or add credit in the Anthropic Console.');
    }
    throw e;
  }

  if (res.stop_reason === 'refusal') throw new RefusalError(res.stop_details?.category ?? null);
  if (res.parsed_output == null) throw new Error(`The API reply did not match the schema (stop_reason ${res.stop_reason}).`);

  const u = res.usage || {};
  const tokens = {
    inputTokens: Number(u.input_tokens) || 0,
    outputTokens: Number(u.output_tokens) || 0,
    cacheReadTokens: Number(u.cache_read_input_tokens) || 0,
    cacheWriteTokens: Number(u.cache_creation_input_tokens) || 0,
  };
  clearFailures();
  const raw = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return { data: res.parsed_output as T, raw: raw || JSON.stringify(res.parsed_output), usage: { model: MODEL, ...tokens, costUsd: costUsd(tokens) } };
}

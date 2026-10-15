/**
 * Every call goes to Sonnet. Never Opus.
 *
 * One constant, checked before each call on both paths. The CLI default can be
 * Opus on some plans, so the CLI always gets --model, and its reply is checked
 * for the model that actually ran (cli.ts).
 *
 * The model ID is part of the cache key in cache.ts, so a change here causes
 * one new call for each cached prompt. Change it only after `npm run eval`
 * passes on the new model.
 */
export const MODEL = 'claude-sonnet-5';

export class ModelError extends Error {}

export function assertSonnet(id: string): void {
  if (!/^claude-sonnet-\d+(-\d+)*$/.test(id)) throw new ModelError(`Model ${id || '(none)'} is not a Sonnet model. Waypoint sends calls only to Sonnet.`);
}

/** US dollars for each million tokens, for claude-sonnet-5 and claude-sonnet-5-5
 *  (the same price, checked 2026-10-15). A cache write uses the 5-minute TTL. */
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

export function costUsd(u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
  return (u.inputTokens * PRICE.input + u.outputTokens * PRICE.output + u.cacheReadTokens * PRICE.cacheRead + u.cacheWriteTokens * PRICE.cacheWrite) / 1_000_000;
}

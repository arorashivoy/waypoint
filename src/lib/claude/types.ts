import type { z } from 'zod';

export type Effort = 'low' | 'medium' | 'high';

/** Which account pays for a call. `own` and `shared` are API keys (part 2 adds
 *  the key that each user saves); `cli` is the admin's subscription. */
export type Credential = { kind: 'api'; key: string; source: 'own' | 'shared' } | { kind: 'cli' };

export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** 0 for the CLI: the subscription pays, not API credit. */
  costUsd: number;
};

export type AskRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  effort: Effort;
  maxTokens?: number;
};

export type AskResult<T> = { data: T; raw: string; usage: Usage };

export class RefusalError extends Error {
  constructor(public category: string | null) {
    super(`Claude declined this request${category ? ` (${category})` : ''}.`);
  }
}

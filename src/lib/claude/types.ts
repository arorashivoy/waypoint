import type { z } from 'zod';
import type { BuiltPrompt } from '../prompts/builder';

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
  /** Only the `prompt` tag of the prompt builder makes a `BuiltPrompt`. */
  prompt: BuiltPrompt;
  schema: z.ZodType<T>;
  effort: Effort;
  maxTokens?: number;
};

export type AskResult<T> = { data: T; raw: string; usage: Usage };

export class RefusalError extends Error {
  constructor(public category: string | null, public usage?: Usage) {
    super(`Claude declined this request${category ? ` (${category})` : ''}.`);
  }
}

/** A failed call that still used tokens. `usage` lets the caller count the spend. */
export class ClaudeCallError extends Error {
  constructor(message: string, public usage?: Usage) {
    super(message);
  }
}

/** Who the call is for and what it is. `kind` goes to LlmUsage (analysis, referral, note, reply, refine, ...). */
export type CallContext = { userId: string; kind: string };

export class NoCredentialError extends Error {
  constructor() {
    super('Add an API key in Settings to use Claude.');
  }
}

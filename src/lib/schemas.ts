import { z } from 'zod';

/**
 * The shapes of the model replies that the app uses today.
 *
 * The API path sends each schema as a structured output, so the reply always
 * matches. The CLI path has no such option: it checks the reply against the
 * same schema and asks one time for a repair (claude/index.ts). The schemas
 * are plain (no transforms), because the structured output needs a JSON
 * schema. Old cached replies that wrapped a string in an object are fixed by
 * `coerceText` where the app reads them (analysis.ts).
 */

export const coerceText = (v: unknown): string =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? coerceText(Object.values(v).find((x) => typeof x === 'string') ?? '') : String(v ?? '');

export const AnalysisReply = z.object({
  field: z.string(),
  mode: z.string(),
  level: z.string(),
  sponsor: z.boolean(),
  visa: z.string(),
  requirements: z.array(z.object({ t: z.string(), ok: z.boolean() })),
  must: z.array(z.string()),
  projects: z.array(z.object({ n: z.string(), why: z.string() })),
});

export const SlotsReply = z.object({ highlight: z.string(), hook: z.string(), proof: z.string() });

export const HookReply = z.object({ hook: z.string() });

export const RefineReply = z.object({
  projects: z.array(z.string()).nullable(),
  bullets: z.array(z.string()).nullable(),
  skills: z.array(z.string()).nullable(),
  reply: z.string(),
});

export const DraftReply = z.object({ draft: z.string(), certain: z.boolean(), reason: z.string() });

export type AnalysisReplyT = z.infer<typeof AnalysisReply>;
export type SlotsReplyT = z.infer<typeof SlotsReply>;
export type HookReplyT = z.infer<typeof HookReply>;
export type RefineReplyT = z.infer<typeof RefineReply>;
export type DraftReplyT = z.infer<typeof DraftReply>;

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

export const BLOCKER_TYPES = ['citizenship', 'clearance', 'language', 'location', 'seniority', 'other'] as const;
export const LEGITIMACY_FLAGS = ['no-company', 'pay-to-apply', 'reposted', 'vague-role'] as const;

/**
 * The reply of the job check. `fields` is the list the user may get as `field`:
 * the saved fields of the user, or the default list, and always 'Other'. The
 * schema is built for each call, because the structured output sends the list.
 */
export function jobCheckSchema(fields: readonly string[]) {
  const choices = [...new Set([...fields, 'Other'])] as [string, ...string[]];
  return z.object({
    requirements: z
      .array(
        z.object({
          text: z.string(),
          importance: z.enum(['must', 'nice']),
          status: z.enum(['met', 'partial', 'missing']),
          evidence: z.array(z.string()),
        }),
      )
      .max(15),
    blockers: z.array(z.object({ type: z.enum(BLOCKER_TYPES), quote: z.string() })).max(6),
    legitimacy: z.array(z.enum(LEGITIMACY_FLAGS)),
    level: z.enum(['Entry', 'Mid', 'Senior']),
    mode: z.enum(['Remote', 'Hybrid', 'On-site']),
    sponsor: z.boolean(),
    visa: z.string(),
    field: z.enum(choices),
    summary: z.string(),
  });
}

/** The schema with the default list of fields. */
export const JobCheckReply = jobCheckSchema([]);

export const SlotsReply = z.object({ highlight: z.string(), hook: z.string(), proof: z.string() });

export const HookReply = z.object({ hook: z.string() });

export const RefineReply = z.object({
  projects: z.array(z.string()).nullable(),
  bullets: z.array(z.string()).nullable(),
  skills: z.array(z.string()).nullable(),
  reply: z.string(),
});

export const DraftReply = z.object({ draft: z.string(), certain: z.boolean(), reason: z.string() });

export type JobCheckReplyT = z.infer<typeof JobCheckReply>;
export type SlotsReplyT = z.infer<typeof SlotsReply>;
export type HookReplyT = z.infer<typeof HookReply>;
export type RefineReplyT = z.infer<typeof RefineReply>;
export type DraftReplyT = z.infer<typeof DraftReply>;

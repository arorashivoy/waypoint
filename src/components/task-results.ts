import { z } from 'zod';

/**
 * The result of each kind of task, as the screens read it. `runTask` checks the
 * result with one of these parsers, so a changed or broken result gives a clear
 * error and not a wrong screen. Unknown keys stay.
 */

const text = z.string();
const maybeText = z.string().nullable();

export const refreshResult = z.looseObject({
  added: z.number(),
  total: z.number(),
  report: z.array(z.looseObject({ source: text, error: z.unknown().optional() })),
  analysing: z.looseObject({ total: z.number() }).nullable().optional(),
  note: text.optional(),
});

export const pasteResult = z.looseObject({ jobId: text, warning: maybeText, note: maybeText.optional() });

export const referralResult = z.looseObject({
  copy: text,
  open: maybeText,
  name: text,
  resume: z.looseObject({ tailored: z.boolean(), lead: maybeText, publicUrl: maybeText, reason: maybeText, shareReason: maybeText }).nullable(),
});

/** An alumni note or the referral message after an alumnus accepted. */
export const messageResult = z.looseObject({ copy: text, open: maybeText, name: text });

const chatTurn = z.looseObject({ role: z.enum(['you', 'claude']), text, at: text.optional() });
const wording = {
  suggestions: z.looseObject({
    dropped: z.number(),
    items: z.array(z.looseObject({ bulletId: text, text, old: text, labels: z.array(text), status: z.enum(['pending', 'accepted', 'rejected']) })),
  }),
  keywords: z.looseObject({ inResume: z.array(text), missingWithEvidence: z.array(text) }),
};

/** A CV build or refine gives the CV. A suggest task gives only the wording. */
export const cvResult = z.looseObject({
  pdfUrl: text,
  driveUrl: maybeText,
  builtAt: maybeText.optional(),
  driveReason: maybeText.optional(),
  tailored: z.boolean().optional(),
  lead: maybeText.optional(),
  projects: z.array(text).optional(),
  bullets: z.array(text).optional(),
  skills: z.array(text).optional(),
  reason: maybeText.optional(),
  chat: z.array(chatTurn),
  suggestions: wording.suggestions.optional(),
  keywords: wording.keywords.optional(),
});
export const wordingResult = z.looseObject({ suggestions: wording.suggestions, keywords: wording.keywords });

export const importResult = z.looseObject({ drafts: z.number(), dropped: z.number(), hidden: z.number() });
export const githubResult = z.looseObject({ drafts: z.number(), dropped: z.number() });
export const replyResult = z.looseObject({ certain: z.boolean() });

/** A parser for runTask: it returns the checked value or throws. */
export const parser = <T>(schema: z.ZodType<T>) => (raw: unknown): T => {
  const r = schema.safeParse(raw);
  if (!r.success) throw new Error('The task gave a result that Waypoint cannot read. Try again; if it fails again, tell the admin.');
  return r.data;
};

/** A cold email draft for a recruiter. */
export const emailResult = z.looseObject({ id: text, name: text, email: text, subject: text, body: text });

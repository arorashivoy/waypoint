import { z } from 'zod';
import { HttpError } from '../auth/http';
import { CLAIM_KINDS, DEPTHS, PROJECT_SOURCES, RELS, SURFACES } from './doc';
import type { DraftType } from './apply';

/**
 * The shape of each item that a draft or an editor request carries. These
 * schemas check types and sizes only. checkDoc checks the rules (IDs that
 * exist, month formats, metric scales) when the item goes into a profile.
 */

const line = z.string().max(400);
const text = z.string().max(4000).nullish();
const slug = z.string().max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase-kebab-case');

export const ITEM_SCHEMAS: Record<DraftType, z.ZodType> = {
  meta: z.object({ name: line, headline: line }),
  position: z.object({
    id: slug,
    title: line,
    company: line,
    location: text,
    start: z.string().max(7).nullish(),
    end: z.string().max(7).nullish(),
    summary: text,
    bullets: z.array(z.object({ id: slug, match: line, text: line.optional() })).max(30).default([]),
  }),
  education: z.object({ id: slug, school: line, degree: text, field: text, years: text, aliases: z.array(line).max(30).default([]) }),
  project: z.object({
    id: slug,
    title: line,
    org: text,
    description: text,
    url: text,
    tex: text,
    bullets: z.array(line).max(8).default([]),
    source: z.enum(PROJECT_SOURCES).default('manual'),
    repoUrl: z.string().max(200).nullish(),
  }),
  claim: z.object({
    slug,
    kind: z.enum(CLAIM_KINDS),
    label: line,
    aliases: z.array(line).max(30).default([]),
    links: z.array(z.object({ to: slug, rel: z.enum(RELS), w: z.number().gt(0).max(1).default(1) })).max(50).default([]),
    evidence: z.array(z.object({ target: z.string().max(200), depth: z.enum(DEPTHS).default('used'), proof: z.string().max(200).optional(), since: z.string().max(7).optional() })).max(50).default([]),
    mentions: z.array(z.object({ surface: z.enum(SURFACES), url: z.string().max(400).optional(), listed: z.boolean().default(true) })).max(20).default([]),
    value: z.number().optional(),
    scaleMax: z.number().optional(),
    higherIsBetter: z.boolean().optional(),
  }),
  profile: z.record(z.string(), z.unknown()),
};

/** The item in its schema shape, or HttpError(400) that names the first problem. */
export function parseItem(type: DraftType, raw: unknown): unknown {
  const r = ITEM_SCHEMAS[type].safeParse(raw);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw new HttpError(400, `The ${type} is not valid: ${issue.path.join('.') || 'value'} ${issue.message}.`);
}

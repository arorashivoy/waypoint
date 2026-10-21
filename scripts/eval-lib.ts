import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { FIELDS, LEVELS } from '../src/lib/countries';
import { checkYaml, type ClaimsDoc } from '../src/lib/profile/doc';
import { BLOCKER_TYPES, LEGITIMACY_FLAGS } from '../src/lib/schemas';

/**
 * The fixtures of the prompt eval and their checks. This module holds no
 * database, network or Claude code, so `--dry-run` and the test can use it.
 */

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'a slug has lower-case letters, digits and hyphens');

export const FixtureSchema = z
  .object({
    id: slug,
    title: z.string().min(1),
    company: z.string().min(1),
    location: z.string().min(1),
    cc: z.string().regex(/^[A-Z]{2}$/, 'a country code has 2 capital letters'),
    description: z.string().min(40),
    notes: z.string().optional(),
    expected: z.object({
      field: z.enum(FIELDS).optional(),
      level: z.enum(LEVELS).optional(),
      /** Other fields that a careful reader could set. The check passes on `field` or on one of these. */
      fieldAlt: z.array(z.enum(FIELDS)).optional(),
      /** Other levels that a careful reader could set. */
      levelAlt: z.array(z.enum(LEVELS)).optional(),
      /** Blocker types that the check must find. */
      blockers: z.array(z.enum(BLOCKER_TYPES)),
      /** True when the posting holds no hard condition, so the check must return no blocker. */
      noFakeBlockers: z.boolean(),
      /** With `noFakeBlockers`: blocker types that are real for the synthetic profile (a city outside its countries, a language, many years). They are not counted as fake. */
      allowedBlockers: z.array(z.enum(BLOCKER_TYPES)).optional(),
      /** Flags that the check must set. */
      legitimacy: z.array(z.enum(LEGITIMACY_FLAGS)),
      /** True when the posting holds an injection attempt. */
      injection: z.boolean(),
      /** Claim slugs that the check must cite. */
      mustMet: z.array(slug).optional(),
      /** Injection fixtures: the highest requirement ratio (0 to 1) that a reply can reach if it ignores the injection. */
      maxRatio: z.number().min(0).max(1).optional(),
      /** Injection fixtures: slugs that the injection asks the model to cite. A met or partial requirement that cites one fails. */
      forbidCredit: z.array(slug).optional(),
      /** Injection fixtures: phrases from the attack that must not show in the summary or in a requirement text. */
      forbidText: z.array(z.string().min(1)).optional(),
    }),
  })
  .strict()
  .refine(
    (f) => {
      const e = f.expected;
      return !e.injection || (!!e.field && !!e.level && e.maxRatio !== undefined && !!e.forbidCredit && !!e.forbidText?.length);
    },
    { message: 'an injection fixture needs field, level, maxRatio, forbidCredit and forbidText', path: ['expected'] },
  )
  .refine((f) => !(f.expected.noFakeBlockers && f.expected.blockers.length), { message: 'noFakeBlockers and blockers cannot both be set', path: ['expected'] });

export type Fixture = z.infer<typeof FixtureSchema>;

export const POSTINGS_DIR = 'eval/postings';
export const SYNTHETIC_PROFILE = 'eval/profiles/synthetic.yml';

export type Loaded<T> = { value: T | null; errors: string[] };

export function loadFixtures(root = process.cwd()): { fixtures: Fixture[]; errors: string[] } {
  const dir = join(root, POSTINGS_DIR);
  const errors: string[] = [];
  const fixtures: Fixture[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) errors.push(`${POSTINGS_DIR}: no fixture files`);
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (e) {
      errors.push(`${file}: ${(e as Error).message}`);
      continue;
    }
    const parsed = FixtureSchema.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues) errors.push(`${file}: ${i.path.join('.') || '(root)'} ${i.message}`);
      continue;
    }
    if (`${parsed.data.id}.json` !== file) errors.push(`${file}: the id "${parsed.data.id}" must match the file name`);
    if (fixtures.some((f) => f.id === parsed.data.id)) errors.push(`${file}: the id "${parsed.data.id}" is used twice`);
    fixtures.push(parsed.data);
  }
  return { fixtures, errors };
}

/** The synthetic profile, read with the loader of the YAML import. */
export function loadSyntheticProfile(root = process.cwd()): Loaded<ClaimsDoc> {
  const check = checkYaml(readFileSync(join(root, SYNTHETIC_PROFILE), 'utf8'), { strict: true });
  return { value: check.doc, errors: [...check.errors, ...check.warnings].map((m) => `${SYNTHETIC_PROFILE}: ${m}`) };
}

/** Claim slugs that a check may cite: evidence deeper than "mentioned" (same rule as `citableClaims`). */
export const citableSlugs = (doc: ClaimsDoc): Set<string> => new Set(doc.claims.filter((c) => c.evidence.some((e) => e.depth !== 'mentioned')).map((c) => c.slug));

export type DryRun = { errors: string[]; fixtures: number; claims: number; injections: number };

/** Loads and checks every fixture and the synthetic profile. No network, no database, no Claude. */
export function dryRun(root = process.cwd()): DryRun {
  const { fixtures, errors } = loadFixtures(root);
  const profile = loadSyntheticProfile(root);
  errors.push(...profile.errors);
  if (profile.value) {
    const slugs = citableSlugs(profile.value);
    for (const f of fixtures) {
      for (const s of f.expected.mustMet ?? []) if (!slugs.has(s)) errors.push(`${f.id}: mustMet "${s}" is not a citable claim of the synthetic profile`);
    }
  }
  return { errors, fixtures: fixtures.length, claims: profile.value?.claims.length ?? 0, injections: fixtures.filter((f) => f.expected.injection).length };
}

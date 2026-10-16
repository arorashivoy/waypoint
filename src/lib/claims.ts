import { join } from 'path';
import { inferLevels } from './match';
import type { ProfileSummary } from './prompts';
import { checkDoc, checkYaml, type Check, type Claim, type ClaimsDoc } from './profile/doc';

export * from './profile/doc';

/** The strict check of check:claims and migrate:claims: an empty headline and zero claims are errors. */
export const validate = (raw: unknown): Check => checkDoc(raw, { strict: true });
export const checkText = (text: string): Check => checkYaml(text, { strict: true });

const MONTH = /^\d{4}(-\d{2})?$/;

/**
 * The claims ledger: helpers on the profile document.
 *
 * The profile of each user is in the database (src/lib/profile/store.ts), and
 * claims.yml is its import and export form (src/lib/profile/doc.ts). This file
 * keeps the helpers that turn a document into the profile that prompts read,
 * and the strict checks of `npm run check:claims` and `npm run migrate:claims`.
 */

export const CLAIMS_PATH = process.env.CLAIMS_FILE || join(process.cwd(), 'data/profile/claims.yml');


const month = (s?: string | null) => (s && MONTH.test(s) ? new Date(`${s.length === 4 ? `${s}-01` : s}-01T00:00:00Z`) : null);
const fmt = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : 'present');

/** A metric rendered for a prompt keeps its scale attached, because "8.43"
 *  alone is not a fact. */
export const renderMetric = (c: Claim) =>
  c.value === undefined ? c.label : `${c.label} ${c.value}${c.scaleMax ? `/${c.scaleMax}` : ''}`;

/** The school the alumni fallback searches. `short` is what goes in front of
 *  people — the first alias, since "Indraprastha Institute of Information
 *  Technology Delhi alum" spends a fifth of a 300-character note on a name
 *  nobody uses. */
export type School = { name: string; short: string };

export type ResolvedProfile = ProfileSummary & { levels: string[]; currentEmployer: string; schools: string[]; interests: string[]; school: School | null };

export function schoolOf(e: { school: string; aliases?: string[] } | undefined): School | null {
  if (!e?.school) return null;
  return { name: e.school, short: e.aliases?.[0] || e.school };
}

export function profileFromClaims(doc: ClaimsDoc): ResolvedProfile {
  const positions = doc.targets.positions
    .map((p) => ({ ...p, startedAt: month(p.start), endedAt: month(p.end) }))
    .sort((a, b) => (b.startedAt?.getTime() || 0) - (a.startedAt?.getTime() || 0));

  /** Claims evidenced on a target become that target's tags, which is what
   *  makes a project searchable by the skill it demonstrates rather than by
   *  whatever LinkedIn happened to tag it with. */
  const tagsFor = (target: string) =>
    doc.claims.filter((c) => c.evidence.some((e) => e.target === target || e.target.startsWith(`${target}/`))).map((c) => c.label);

  /** A proof line is the only sentence about this work that the user wrote and
   *  vouched for, so it is appended to the description the model reads. */
  const proofsFor = (target: string) =>
    doc.claims.flatMap((c) =>
      // `position:gs-analyst/java-spring` is evidence about that position, so
      // its proof belongs in the position's summary too.
      c.evidence.filter((e) => (e.target === target || e.target.startsWith(`${target}/`)) && e.proof).map((e) => e.proof!),
    );

  const skillLabels = doc.claims.filter((c) => c.kind === 'skill' || c.kind === 'language').map((c) => c.label);
  const measured = doc.claims.filter((c) => c.kind === 'metric' || c.kind === 'credential').map(renderMetric);

  return {
    name: doc.profile.name,
    headline: doc.profile.headline,
    positions: positions.map((p) => ({
      title: p.title,
      company: p.company,
      location: p.location ?? null,
      summary: [p.summary, ...proofsFor(`position:${p.id}`)].filter(Boolean).join(' ') || null,
      years: `${fmt(p.startedAt)} – ${fmt(p.endedAt)}`,
    })),
    educations: doc.targets.educations.map((e) => ({ school: e.school, degree: e.degree ?? null, field: e.field ?? null, years: e.years ?? null })),
    projects: doc.targets.projects.map((p) => ({
      title: p.title,
      org: p.org ?? null,
      description: [p.description, ...proofsFor(`project:${p.id}`)].filter(Boolean).join(' ') || null,
      tags: tagsFor(`project:${p.id}`).join(', '),
    })),
    skills: [...skillLabels, ...measured],
    levels: inferLevels(positions.map((p) => ({ title: p.title, startedAt: p.startedAt, endedAt: p.endedAt }))),
    currentEmployer: positions[0]?.company || '',
    // Both the registered name and its short forms, because `rankRoutes` tests
    // each against a contact's headline and only the short forms ever appear there.
    schools: doc.targets.educations.flatMap((e) => [e.school, ...(e.aliases || [])]),
    interests: [...new Set(doc.targets.projects.flatMap((p) => tagsFor(`project:${p.id}`)))],
    school: schoolOf(doc.targets.educations[0]),
  };
}

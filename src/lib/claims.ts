import { existsSync, readFileSync, statSync } from 'fs';
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
 * The hand-authored claim graph, and the single source of truth about Shivoy
 * when it exists.
 *
 * Everything else Waypoint knows is derived and replaceable: the LinkedIn
 * export can be re-downloaded, job rows re-fetched, analyses re-run, and
 * `data/waypoint.db` is disposable by design. This file is the one dataset that
 * is written by hand and cannot be regenerated, which is why it is a text file
 * rather than rows in SQLite — it diffs, it reviews, and it survives
 * `prisma db push --force-reset`. It is gitignored because it is personal data;
 * back it up yourself.
 *
 * The LinkedIn import stays the fallback, not the truth. LinkedIn's skills list
 * is whatever a 2022 undergraduate endorsed; this file says what is actually
 * evidenced, where it is evidenced, and where it is currently advertised.
 *
 * Validation is deliberately in this module rather than in the checker script,
 * so that the gate the script enforces and the gate the app applies at load are
 * the same code. A rule that exists in only one of the two is a rule that will
 * eventually disagree with itself.
 */

export const CLAIMS_PATH = process.env.CLAIMS_FILE || join(process.cwd(), 'data/profile/claims.yml');


let cached: { mtimeMs: number; check: Check } | null = null;

/** Returns the parsed file, or null when it does not exist. An existing file
 *  that fails validation also returns null *and logs*, so the app falls back to
 *  the LinkedIn import rather than running on a half-read profile: a partly
 *  parsed claim graph would put confident, wrong facts into a message sent to a
 *  stranger, which is worse than falling back to stale LinkedIn data. */
export function loadClaims(): ClaimsDoc | null {
  if (!existsSync(CLAIMS_PATH)) return null;
  const mtimeMs = statSync(CLAIMS_PATH).mtimeMs;
  if (!cached || cached.mtimeMs !== mtimeMs) {
    cached = { mtimeMs, check: checkText(readFileSync(CLAIMS_PATH, 'utf8')) };
    if (cached.check.errors.length) {
      console.error(
        `[claims] ${CLAIMS_PATH} is invalid, falling back to the LinkedIn import.\n` +
          cached.check.errors.map((e) => `  - ${e}`).join('\n') +
          `\nRun: npm run check:claims`,
      );
    }
  }
  return cached.check.doc;
}

/**
 * Set when the file exists but does not validate — the one state the user must
 * be told about. A missing file is a legitimate configuration (the app runs on
 * the LinkedIn import by design), but a present-and-broken one means his own
 * source of truth is being ignored, and the only visible symptom would be
 * outreach messages quietly citing a 2022 undergraduate's skills list.
 *
 * Safe to call in any order relative to `loadClaims`: the mtime cache makes the
 * second call free.
 */
export function claimsFailure(): { path: string; errors: string[] } | null {
  if (!existsSync(CLAIMS_PATH)) return null;
  loadClaims();
  const errors = cached?.check.errors ?? [];
  return errors.length ? { path: CLAIMS_PATH, errors } : null;
}

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

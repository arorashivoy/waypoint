import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { inferLevels } from './match';
import type { ProfileSummary } from './prompts';

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

export const CLAIM_KINDS = ['skill', 'language', 'metric', 'credential', 'award'] as const;
export const DEPTHS = ['mentioned', 'used', 'built'] as const;
export const RELS = ['alias_of', 'broader', 'narrower', 'related'] as const;
export const TARGET_KINDS = ['project', 'position', 'education'] as const;

/** The recruiter-facing surfaces a claim can be advertised on. A closed set on
 *  purpose: "LinkedIn" and "LinkedIn Skills" are different searches, and only
 *  the latter is what a recruiter filter matches on. */
export const SURFACES = [
  'resume',
  'linkedin-headline',
  'linkedin-about',
  'linkedin-experience',
  'linkedin-skills',
  'linkedin-projects',
  'linkedin-honors',
  'linkedin-courses',
  'linkedin-education',
  'github-profile',
  'github-repo',
  'portfolio',
  'orcid',
] as const;

export type ClaimKind = (typeof CLAIM_KINDS)[number];
export type Depth = (typeof DEPTHS)[number];
export type Rel = (typeof RELS)[number];
export type Surface = (typeof SURFACES)[number];

export type Evidence = { target: string; depth: Depth; proof?: string; since?: string };
export type Link = { to: string; rel: Rel; w: number };
export type Mention = { surface: Surface; url?: string; listed: boolean };

export type Claim = {
  slug: string;
  kind: ClaimKind;
  label: string;
  aliases: string[];
  links: Link[];
  evidence: Evidence[];
  mentions: Mention[];
  /** metric/credential only. A bare number is meaningless without its scale and
   *  its direction: 8.43 of 10 (higher better) and a German Note of 1.8 of 5
   *  (lower better) are both "good", and a converter that sees only the number
   *  reads the second as a near-fail. */
  value?: number;
  scaleMax?: number;
  higherIsBetter?: boolean;
};

export type ProjectTarget = { id: string; title: string; org?: string | null; description?: string | null; url?: string | null };
/** One bullet of a position, addressable as `position:<id>/<bullet id>`.
 *
 *  `match` is a distinctive phrase from the CV bullet rather than the bullet's
 *  full text. Storing the text here would duplicate the LaTeX and the two would
 *  drift the first time a sentence is reworded; a phrase is enough to find the
 *  bullet and cheap to keep true. */
export type BulletTarget = { id: string; match: string };

export type PositionTarget = {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  start: string;
  end?: string | null;
  summary?: string | null;
  bullets?: BulletTarget[];
};
export type EducationTarget = {
  id: string;
  school: string;
  degree?: string | null;
  field?: string | null;
  years?: string | null;
  /** Short forms of the school's name — "IIIT Delhi", "IIITD". The registered
   *  name appears in nobody's LinkedIn headline, so without these the alumnus
   *  route in `rankRoutes` never fires. */
  aliases?: string[];
};

export type ClaimsDoc = {
  version: number;
  profile: { name: string; headline: string };
  targets: { projects: ProjectTarget[]; positions: PositionTarget[]; educations: EducationTarget[] };
  claims: Claim[];
};

export type Check = { errors: string[]; warnings: string[]; doc: ClaimsDoc | null };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MONTH = /^\d{4}(-\d{2})?$/;
/** A proof sentence is pasted into a prompt and, through it, into a message a
 *  human reads. Anything longer than this is a paragraph, and a paragraph in a
 *  300-character LinkedIn note is a bug rather than detail. */
const MAX_PROOF = 200;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

export function validate(raw: unknown): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!isObj(raw)) return { errors: ['root: file must be a YAML mapping'], warnings, doc: null };
  if (raw.version !== 1) err('version', `must be 1, got ${JSON.stringify(raw.version)}`);

  const profile = isObj(raw.profile) ? raw.profile : {};
  if (typeof profile.name !== 'string' || !profile.name.trim()) err('profile.name', 'required, non-empty string');
  if (typeof profile.headline !== 'string' || !profile.headline.trim()) err('profile.headline', 'required, non-empty string');

  const targetsRaw = isObj(raw.targets) ? raw.targets : {};
  const seenTargets = new Set<string>();
  const targetIds = (kind: string, rows: unknown[], required: string[]): any[] =>
    rows.map((row, i) => {
      const p = `targets.${kind}s[${i}]`;
      if (!isObj(row)) { err(p, 'must be a mapping'); return null; }
      const id = row.id;
      if (typeof id !== 'string' || !SLUG.test(id)) err(`${p}.id`, `required, lowercase-kebab-case, got ${JSON.stringify(id)}`);
      else if (seenTargets.has(`${kind}:${id}`)) err(`${p}.id`, `duplicate id "${id}" in ${kind}s`);
      else seenTargets.add(`${kind}:${id}`);
      for (const f of required) {
        if (typeof row[f] !== 'string' || !String(row[f]).trim()) err(`${p}.${f}`, 'required, non-empty string');
      }
      return row;
    }).filter(Boolean);

  const projects = targetIds('project', asArray(targetsRaw.projects), ['title']);
  const positions = targetIds('position', asArray(targetsRaw.positions), ['title', 'company']);
  const educations = targetIds('education', asArray(targetsRaw.educations), ['school']);

  educations.forEach((e: any, i) => {
    asArray(e.aliases).forEach((a, j) => {
      if (typeof a !== 'string' || !a.trim()) err(`targets.educations[${i}].aliases[${j}]`, 'must be a non-empty string');
      else if (a.replace(/[^a-z0-9]/gi, '').length < 4) err(`targets.educations[${i}].aliases[${j}]`, `"${a}" is too short to match on; under four characters it matches half the connection list`);
    });
  });

  positions.forEach((p: any, i) => {
    const path = `targets.positions[${i}]`;
    const seenBullets = new Set<string>();
    asArray(p.bullets).forEach((b, j) => {
      const bp = `${path}.bullets[${j}]`;
      if (!isObj(b)) { err(bp, 'must be a mapping'); return; }
      if (typeof b.id !== 'string' || !SLUG.test(b.id)) err(`${bp}.id`, `required, lowercase-kebab-case, got ${JSON.stringify(b.id)}`);
      else if (seenBullets.has(b.id)) err(`${bp}.id`, `duplicate bullet id "${b.id}" in this position`);
      else { seenBullets.add(b.id); if (typeof p.id === 'string') seenTargets.add(`position:${p.id}/${b.id}`); }
      // A short phrase matches several bullets and silently reorders the wrong
      // one, which is the failure this whole mechanism exists to avoid.
      if (typeof b.match !== 'string' || b.match.trim().length < 8) {
        err(`${bp}.match`, `required, at least 8 characters of a distinctive phrase from the CV bullet, got ${JSON.stringify(b.match)}`);
      }
    });
    if (typeof p.start !== 'string' || !MONTH.test(p.start)) err(`${path}.start`, `required, YYYY or YYYY-MM, got ${JSON.stringify(p.start)}`);
    if (p.end !== undefined && p.end !== null && !MONTH.test(String(p.end))) err(`${path}.end`, `YYYY or YYYY-MM, or null for present, got ${JSON.stringify(p.end)}`);
    if (typeof p.start === 'string' && typeof p.end === 'string' && MONTH.test(p.start) && MONTH.test(p.end) && p.end < p.start) {
      err(`${path}.end`, `ends (${p.end}) before it starts (${p.start})`);
    }
  });

  const claimRows = asArray(raw.claims);
  if (!claimRows.length) err('claims', 'at least one claim is required');

  const slugs = new Set<string>();
  const claims: Claim[] = [];

  claimRows.forEach((row, i) => {
    const p = `claims[${i}]`;
    if (!isObj(row)) { err(p, 'must be a mapping'); return; }

    const slug = row.slug;
    const named = typeof slug === 'string' ? `claims[${slug}]` : p;
    if (typeof slug !== 'string' || !SLUG.test(slug)) { err(`${p}.slug`, `required, lowercase-kebab-case, got ${JSON.stringify(slug)}`); return; }
    if (slugs.has(slug)) { err(`${p}.slug`, `duplicate slug "${slug}"`); return; }
    slugs.add(slug);

    const kind = row.kind as ClaimKind;
    if (!CLAIM_KINDS.includes(kind)) err(`${named}.kind`, `must be one of ${CLAIM_KINDS.join(' | ')}, got ${JSON.stringify(row.kind)}`);
    if (typeof row.label !== 'string' || !row.label.trim()) err(`${named}.label`, 'required, non-empty string');

    const measured = kind === 'metric' || kind === 'credential';
    if (kind === 'metric') {
      if (typeof row.value !== 'number' || !isFinite(row.value)) err(`${named}.value`, 'a metric requires a numeric value');
      if (typeof row.scaleMax !== 'number' || row.scaleMax <= 0) err(`${named}.scaleMax`, 'a metric requires scaleMax, the top of its scale');
      if (typeof row.higherIsBetter !== 'boolean') err(`${named}.higherIsBetter`, 'a metric requires higherIsBetter — 8.43/10 and a German 1.8/5 are both good, and only this field says so');
      if (typeof row.value === 'number' && typeof row.scaleMax === 'number' && row.value > row.scaleMax) {
        err(`${named}.value`, `${row.value} exceeds scaleMax ${row.scaleMax}`);
      }
    } else if (!measured && (row.value !== undefined || row.scaleMax !== undefined)) {
      err(`${named}.value`, `only metric/credential claims carry a value; this one is kind=${kind}`);
    }

    const aliases = asArray(row.aliases).map((a, j) => {
      if (typeof a !== 'string' || !a.trim()) { err(`${named}.aliases[${j}]`, 'must be a non-empty string'); return ''; }
      return a.trim();
    }).filter(Boolean);

    const links = asArray(row.links).map((l, j) => {
      const lp = `${named}.links[${j}]`;
      if (!isObj(l)) { err(lp, 'must be a mapping'); return null; }
      if (typeof l.to !== 'string' || !SLUG.test(l.to)) err(`${lp}.to`, `required, a claim slug, got ${JSON.stringify(l.to)}`);
      else if (l.to === slug) err(`${lp}.to`, 'a claim cannot link to itself');
      if (!RELS.includes(l.rel as Rel)) err(`${lp}.rel`, `must be one of ${RELS.join(' | ')}, got ${JSON.stringify(l.rel)}`);
      const w = l.w === undefined ? 1 : l.w;
      if (typeof w !== 'number' || !(w > 0) || w > 1) err(`${lp}.w`, `must be a weight in (0, 1]; anything >= 1 on a non-identity edge lets every claim reach every other, got ${JSON.stringify(l.w)}`);
      return { to: String(l.to), rel: l.rel as Rel, w: Number(w) };
    }).filter(Boolean) as Link[];

    const evidence = asArray(row.evidence).map((e, j) => {
      const ep = `${named}.evidence[${j}]`;
      if (!isObj(e)) { err(ep, 'must be a mapping'); return null; }
      const target = String(e.target ?? '');
      const [tk, rest] = target.split(':');
      const bullet = (rest || '').includes('/');
      if (!TARGET_KINDS.includes(tk as any) || !rest) {
        err(`${ep}.target`, `must be "<${TARGET_KINDS.join('|')}>:<id>", optionally "position:<id>/<bullet>", got ${JSON.stringify(e.target)}`);
      } else if (bullet && tk !== 'position') {
        err(`${ep}.target`, `only a position has bullets; "${target}" addresses a ${tk}`);
      } else if (!seenTargets.has(target)) {
        err(`${ep}.target`, bullet ? `"${target}" names no bullet declared on that position` : `"${target}" is not declared under targets.${tk}s`);
      }
      const depth = (e.depth ?? 'used') as Depth;
      if (!DEPTHS.includes(depth)) err(`${ep}.depth`, `must be one of ${DEPTHS.join(' | ')}, got ${JSON.stringify(e.depth)}`);
      if (e.proof !== undefined) {
        if (typeof e.proof !== 'string' || !e.proof.trim()) err(`${ep}.proof`, 'if present, a non-empty sentence');
        else if (e.proof.length > MAX_PROOF) err(`${ep}.proof`, `${e.proof.length} chars, limit ${MAX_PROOF} — this is pasted into a 300-char outreach note`);
      }
      if (e.since !== undefined && !MONTH.test(String(e.since))) err(`${ep}.since`, `YYYY or YYYY-MM, got ${JSON.stringify(e.since)}`);
      return { target, depth, proof: e.proof ? String(e.proof) : undefined, since: e.since ? String(e.since) : undefined };
    }).filter(Boolean) as Evidence[];

    const seenSurfaces = new Set<string>();
    const mentions = asArray(row.mentions).map((m, j) => {
      const mp = `${named}.mentions[${j}]`;
      if (!isObj(m)) { err(mp, 'must be a mapping'); return null; }
      const surface = m.surface as Surface;
      if (!SURFACES.includes(surface)) err(`${mp}.surface`, `must be one of ${SURFACES.join(' | ')}, got ${JSON.stringify(m.surface)}`);
      else if (seenSurfaces.has(surface)) err(`${mp}.surface`, `"${surface}" listed twice for this claim`);
      else seenSurfaces.add(surface);
      if (m.url !== undefined && !/^https?:\/\//.test(String(m.url))) err(`${mp}.url`, `must be an http(s) URL, got ${JSON.stringify(m.url)}`);
      return { surface, url: m.url ? String(m.url) : undefined, listed: m.listed === undefined ? true : m.listed === true };
    }).filter(Boolean) as Mention[];

    if (evidence.length && !mentions.some((m) => m.listed)) {
      warnings.push(`${named}: evidenced but advertised nowhere — no surface carries it, so no recruiter search matches it`);
    }
    if (!evidence.length && mentions.some((m) => m.listed)) {
      warnings.push(`${named}: advertised on ${mentions.filter((m) => m.listed).map((m) => m.surface).join(', ')} but backed by no evidence — an interviewer will ask`);
    }
    if (evidence.some((e) => e.depth === 'built') && !evidence.some((e) => e.proof)) {
      warnings.push(`${named}: depth=built with no proof line — the outreach prompt has nothing concrete to quote`);
    }

    claims.push({
      slug,
      kind,
      label: String(row.label ?? slug),
      aliases,
      links,
      evidence,
      mentions,
      value: typeof row.value === 'number' ? row.value : undefined,
      scaleMax: typeof row.scaleMax === 'number' ? row.scaleMax : undefined,
      higherIsBetter: typeof row.higherIsBetter === 'boolean' ? row.higherIsBetter : undefined,
    });
  });

  // Link targets are checked after every slug is known, so that forward
  // references are legal and only genuine typos fail.
  for (const c of claims) {
    for (const [j, l] of c.links.entries()) {
      if (!slugs.has(l.to)) errors.push(`claims[${c.slug}].links[${j}].to: "${l.to}" is not a declared claim slug`);
    }
  }

  // An alias that collides with a canonical slug or with another claim's alias
  // makes resolution ambiguous, which is precisely what the canonical node
  // exists to prevent.
  const aliasOwner = new Map<string, string>();
  for (const c of claims) {
    for (const a of c.aliases) {
      const key = a.toLowerCase();
      if (slugs.has(key) && key !== c.slug) errors.push(`claims[${c.slug}].aliases: "${a}" is already the canonical slug of another claim`);
      const owner = aliasOwner.get(key);
      if (owner && owner !== c.slug) errors.push(`claims[${c.slug}].aliases: "${a}" is also an alias of "${owner}"`);
      aliasOwner.set(key, c.slug);
    }
  }

  const doc: ClaimsDoc | null = errors.length
    ? null
    : {
        version: 1,
        profile: { name: String(profile.name), headline: String(profile.headline) },
        targets: { projects: projects as ProjectTarget[], positions: positions as PositionTarget[], educations: educations as EducationTarget[] },
        claims,
      };

  return { errors, warnings, doc };
}

export function checkText(text: string): Check {
  try {
    return validate(parseYaml(text));
  } catch (e) {
    return { errors: [`yaml: ${(e as Error).message}`], warnings: [], doc: null };
  }
}

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

export type ResolvedProfile = ProfileSummary & { levels: string[]; currentEmployer: string; schools: string[]; interests: string[] };

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
  };
}

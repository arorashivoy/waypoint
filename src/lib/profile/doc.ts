import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/**
 * The profile document: its types, its checks and its YAML form.
 *
 * The database tables (store.ts) hold each profile, and claims.yml is its
 * import and export form. This module has no server imports, so the browser
 * runs the same checkDoc as the server while the user types. A rule that is in
 * one place only cannot disagree with itself.
 */

export const CLAIM_KINDS = ['skill', 'language', 'metric', 'credential', 'award'] as const;
export const DEPTHS = ['mentioned', 'used', 'built'] as const;
export const RELS = ['alias_of', 'broader', 'narrower', 'related'] as const;
export const TARGET_KINDS = ['project', 'position', 'education'] as const;
export const PROJECT_SOURCES = ['manual', 'github', 'resume', 'linkedin', 'yaml'] as const;

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

/** Upper limits. They keep one profile small enough for one transaction and one prompt. */
export const LIMITS = {
  positions: 100,
  educations: 50,
  projects: 200,
  claims: 500,
  positionBullets: 30,
  projectBullets: 8,
  aliases: 30,
  /** A summary, a description or the LaTeX of one entry. */
  text: 4000,
  /** A name, a title, a label or one bullet. */
  line: 400,
} as const;

export type ClaimKind = (typeof CLAIM_KINDS)[number];
export type Depth = (typeof DEPTHS)[number];
export type Rel = (typeof RELS)[number];
export type Surface = (typeof SURFACES)[number];
export type TargetKind = (typeof TARGET_KINDS)[number];
export type ProjectSource = (typeof PROJECT_SOURCES)[number];

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

export type ProjectTarget = {
  id: string;
  title: string;
  org?: string | null;
  description?: string | null;
  url?: string | null;
  /** The project's CV entry as LaTeX, one `\item` block in the CV's own macros.
   *  Only for an own .tex résumé: with it, a posting that fits this project
   *  better than one the CV carries gets it swapped in. */
  tex?: string | null;
  /** The bullet lines for the built-in résumé templates (part 5). */
  bullets?: string[];
  source?: ProjectSource;
  repoUrl?: string | null;
};
/** One bullet of a position, addressable as `position:<id>/<bullet id>`.
 *  `match` is a distinctive phrase that finds the bullet in an own .tex file.
 *  `text` is the full line, for the built-in templates. */
export type BulletTarget = { id: string; match: string; text?: string };

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
/** strict: an empty headline and zero claims are errors (check:claims,
 *  migrate:claims). In the app they are warnings, so a new user can start
 *  with one position. */
export type CheckOptions = { strict?: boolean };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MONTH = /^\d{4}(-\d{2})?$/;
const HTTP_URL = /^https?:\/\/\S+$/i;
const GITHUB_REPO = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
/** A proof sentence is pasted into a prompt and, through it, into a message a
 *  human reads. Anything longer than this is a paragraph, and a paragraph in a
 *  300-character LinkedIn note is a bug rather than detail. */
const MAX_PROOF = 200;

/** The fields that a target keeps. Any other field gets a warning and is not kept. */
const FIELDS: Record<TargetKind, readonly string[]> = {
  project: ['id', 'title', 'org', 'description', 'url', 'tex', 'bullets', 'source', 'repoUrl'],
  position: ['id', 'title', 'company', 'location', 'start', 'end', 'summary', 'bullets'],
  education: ['id', 'school', 'degree', 'field', 'years', 'aliases'],
};
/** Text fields. A number here becomes a string: YAML reads `years: 2023` as a number. */
const TEXT_FIELDS: Record<TargetKind, readonly string[]> = {
  project: ['title', 'org', 'description', 'url', 'tex', 'repoUrl'],
  position: ['title', 'company', 'location', 'start', 'end', 'summary'],
  education: ['school', 'degree', 'field', 'years'],
};
/** Fields that hold a name or a place, not a paragraph. They have the limit of one line. */
const LINE_FIELDS: ReadonlySet<string> = new Set(['title', 'company', 'school', 'org', 'location']);
const BULLET_FIELDS = ['id', 'match', 'text'];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

export function checkDoc(raw: unknown, opts: CheckOptions = {}): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);
  const strictRule = (path: string, msg: string) => (opts.strict ? err(path, msg) : warnings.push(`${path}: ${msg}`));
  const tooMany = (path: string, n: number, max: number) => {
    if (n > max) err(path, `${n} items, limit ${max}`);
  };

  if (!isObj(raw)) return { errors: ['root: the file must be a YAML mapping'], warnings, doc: null };
  if (raw.version !== 1) err('version', `must be 1, got ${JSON.stringify(raw.version)}`);

  const profile = isObj(raw.profile) ? raw.profile : {};
  if (typeof profile.name !== 'string' || !profile.name.trim()) err('profile.name', 'required, non-empty string');
  else if (profile.name.length > LIMITS.line) err('profile.name', `${profile.name.length} characters, limit ${LIMITS.line}`);
  const headline = profile.headline === undefined || profile.headline === null ? '' : profile.headline;
  if (typeof headline !== 'string') err('profile.headline', 'must be a string');
  else if (!headline.trim()) strictRule('profile.headline', 'required, non-empty string');
  else if (headline.length > LIMITS.line) err('profile.headline', `${headline.length} characters, limit ${LIMITS.line}`);

  /** Keeps the known fields of a target row, and makes numbers in text fields strings. */
  const cleanRow = (kind: TargetKind, row: Record<string, unknown>, p: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!FIELDS[kind].includes(k)) {
        warnings.push(`${p}: the field "${k}" is not known, so it is not kept`);
        continue;
      }
      if (v === null || v === undefined) continue;
      out[k] = typeof v === 'number' && TEXT_FIELDS[kind].includes(k) ? String(v) : v;
    }
    for (const k of TEXT_FIELDS[kind]) {
      const v = out[k];
      if (v === undefined) continue;
      const limit = LINE_FIELDS.has(k) ? LIMITS.line : LIMITS.text;
      if (typeof v !== 'string') err(`${p}.${k}`, 'must be a string');
      else if (v.length > limit) err(`${p}.${k}`, `${v.length} characters, limit ${limit}`);
    }
    return out;
  };

  const targetsRaw = isObj(raw.targets) ? raw.targets : {};
  const seenTargets = new Set<string>();
  const targetRows = (kind: TargetKind, rows: unknown[], required: string[], max: number): Record<string, unknown>[] => {
    tooMany(`targets.${kind}s`, rows.length, max);
    return rows
      .map((row, i) => {
        const p = `targets.${kind}s[${i}]`;
        if (!isObj(row)) {
          err(p, 'must be a mapping');
          return null;
        }
        const r = cleanRow(kind, row, p);
        const id = r.id;
        if (typeof id !== 'string' || !SLUG.test(id)) err(`${p}.id`, `required, lowercase-kebab-case, got ${JSON.stringify(id)}`);
        else if (id.length > 60) err(`${p}.id`, `${id.length} characters, limit 60`);
        else if (seenTargets.has(`${kind}:${id}`)) err(`${p}.id`, `duplicate id "${id}" in ${kind}s`);
        else seenTargets.add(`${kind}:${id}`);
        for (const f of required) {
          if (typeof r[f] !== 'string' || !String(r[f]).trim()) err(`${p}.${f}`, 'required, non-empty string');
        }
        return r;
      })
      .filter((r): r is Record<string, unknown> => r !== null);
  };

  const projects = targetRows('project', asArray(targetsRaw.projects), ['title'], LIMITS.projects);
  const positions = targetRows('position', asArray(targetsRaw.positions), ['title', 'company'], LIMITS.positions);
  const educations = targetRows('education', asArray(targetsRaw.educations), ['school'], LIMITS.educations);

  educations.forEach((e, i) => {
    const aliases = asArray(e.aliases);
    tooMany(`targets.educations[${i}].aliases`, aliases.length, LIMITS.aliases);
    aliases.forEach((a, j) => {
      if (typeof a !== 'string' || !a.trim()) err(`targets.educations[${i}].aliases[${j}]`, 'must be a non-empty string');
      else if (a.replace(/[^a-z0-9]/gi, '').length < 4) err(`targets.educations[${i}].aliases[${j}]`, `"${a}" is too short to match on; under four characters it matches half the connection list`);
    });
    if (e.aliases !== undefined) e.aliases = aliases.filter((a): a is string => typeof a === 'string').map((a) => a.trim());
  });

  projects.forEach((p, i) => {
    const path = `targets.projects[${i}]`;
    if (typeof p.url === 'string' && !HTTP_URL.test(p.url)) err(`${path}.url`, `must be an http(s) URL, got ${JSON.stringify(p.url)}`);
    if (p.source !== undefined && !PROJECT_SOURCES.includes(p.source as ProjectSource)) {
      err(`${path}.source`, `must be one of ${PROJECT_SOURCES.join(' | ')}, got ${JSON.stringify(p.source)}`);
    }
    if (typeof p.repoUrl === 'string' && !GITHUB_REPO.test(p.repoUrl)) err(`${path}.repoUrl`, `must be https://github.com/<owner>/<repo>, got ${JSON.stringify(p.repoUrl)}`);
    if (p.bullets !== undefined) {
      const bullets = asArray(p.bullets);
      tooMany(`${path}.bullets`, bullets.length, LIMITS.projectBullets);
      bullets.forEach((b, j) => {
        if (typeof b !== 'string' || !b.trim()) err(`${path}.bullets[${j}]`, 'must be a non-empty string');
        else if (b.length > LIMITS.line) err(`${path}.bullets[${j}]`, `${b.length} characters, limit ${LIMITS.line}`);
      });
      p.bullets = bullets.filter((b): b is string => typeof b === 'string').map((b) => b.trim());
    }
    if (p.tex === undefined) return;
    // Spliced into the projects section verbatim, beside entries the CV class
    // knows how to lay out. Anything but an `\item` block there breaks the
    // compile, or worse, compiles into a page with a stray paragraph on it.
    if (typeof p.tex !== 'string' || !/^\\item\b/.test(p.tex.trim())) {
      err(`${path}.tex`, 'if present, the LaTeX of one CV entry, starting with \\item');
    } else if (/\\item\b/.test(p.tex.trim().slice(5).replace(/\\begin\{itemize\}[\s\S]*?\\end\{itemize\}/g, ''))) {
      err(`${path}.tex`, 'holds more than one top-level \\item; one entry per project');
    }
  });

  positions.forEach((p, i) => {
    const path = `targets.positions[${i}]`;
    const seenBullets = new Set<string>();
    const rawBullets = asArray(p.bullets);
    tooMany(`${path}.bullets`, rawBullets.length, LIMITS.positionBullets);
    const bullets: BulletTarget[] = [];
    rawBullets.forEach((b, j) => {
      const bp = `${path}.bullets[${j}]`;
      if (!isObj(b)) {
        err(bp, 'must be a mapping');
        return;
      }
      for (const k of Object.keys(b)) if (!BULLET_FIELDS.includes(k)) warnings.push(`${bp}: the field "${k}" is not known, so it is not kept`);
      if (typeof b.id !== 'string' || !SLUG.test(b.id)) err(`${bp}.id`, `required, lowercase-kebab-case, got ${JSON.stringify(b.id)}`);
      else if (seenBullets.has(b.id)) err(`${bp}.id`, `duplicate bullet id "${b.id}" in this position`);
      else {
        seenBullets.add(b.id);
        if (typeof p.id === 'string') seenTargets.add(`position:${p.id}/${b.id}`);
      }
      // A short phrase matches several bullets and silently reorders the wrong
      // one, which is the failure this whole mechanism exists to avoid.
      if (typeof b.match !== 'string' || b.match.trim().length < 8) {
        err(`${bp}.match`, `required, at least 8 characters of a distinctive phrase from the CV bullet, got ${JSON.stringify(b.match)}`);
      } else if (b.match.length > LIMITS.line) err(`${bp}.match`, `${b.match.length} characters, limit ${LIMITS.line}`);
      if (b.text !== undefined && b.text !== null && (typeof b.text !== 'string' || !b.text.trim())) err(`${bp}.text`, 'if present, a non-empty string');
      else if (typeof b.text === 'string' && b.text.length > LIMITS.line) err(`${bp}.text`, `${b.text.length} characters, limit ${LIMITS.line}`);
      bullets.push({ id: String(b.id), match: String(b.match ?? ''), ...(typeof b.text === 'string' && b.text.trim() ? { text: b.text.trim() } : {}) });
    });
    if (p.bullets !== undefined) p.bullets = bullets;
    if (typeof p.start !== 'string' || !MONTH.test(p.start)) err(`${path}.start`, `required, YYYY or YYYY-MM, got ${JSON.stringify(p.start)}`);
    if (p.end !== undefined && !MONTH.test(String(p.end))) err(`${path}.end`, `YYYY or YYYY-MM, or null for present, got ${JSON.stringify(p.end)}`);
    if (typeof p.start === 'string' && typeof p.end === 'string' && MONTH.test(p.start) && MONTH.test(p.end) && p.end < p.start) {
      err(`${path}.end`, `ends (${p.end}) before it starts (${p.start})`);
    }
  });

  const claimRows = asArray(raw.claims);
  if (!claimRows.length) strictRule('claims', 'at least one claim is required');
  tooMany('claims', claimRows.length, LIMITS.claims);

  const slugs = new Set<string>();
  const claims: Claim[] = [];

  claimRows.forEach((row, i) => {
    const p = `claims[${i}]`;
    if (!isObj(row)) {
      err(p, 'must be a mapping');
      return;
    }

    const slug = row.slug;
    const named = typeof slug === 'string' ? `claims[${slug}]` : p;
    if (typeof slug !== 'string' || !SLUG.test(slug) || slug.length > 60) {
      err(`${p}.slug`, `required, lowercase-kebab-case, at most 60 characters, got ${JSON.stringify(slug)}`);
      return;
    }
    if (slugs.has(slug)) {
      err(`${p}.slug`, `duplicate slug "${slug}"`);
      return;
    }
    slugs.add(slug);

    const kind = row.kind as ClaimKind;
    if (!CLAIM_KINDS.includes(kind)) err(`${named}.kind`, `must be one of ${CLAIM_KINDS.join(' | ')}, got ${JSON.stringify(row.kind)}`);
    if (typeof row.label !== 'string' || !row.label.trim()) err(`${named}.label`, 'required, non-empty string');
    else if (row.label.length > LIMITS.line) err(`${named}.label`, `${row.label.length} characters, limit ${LIMITS.line}`);

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

    const rawAliases = asArray(row.aliases);
    tooMany(`${named}.aliases`, rawAliases.length, LIMITS.aliases);
    const aliases = rawAliases
      .map((a, j) => {
        if (typeof a !== 'string' || !a.trim()) {
          err(`${named}.aliases[${j}]`, 'must be a non-empty string');
          return '';
        }
        return a.trim();
      })
      .filter(Boolean);

    const links = asArray(row.links)
      .map((l, j) => {
        const lp = `${named}.links[${j}]`;
        if (!isObj(l)) {
          err(lp, 'must be a mapping');
          return null;
        }
        if (typeof l.to !== 'string' || !SLUG.test(l.to)) err(`${lp}.to`, `required, a claim slug, got ${JSON.stringify(l.to)}`);
        else if (l.to === slug) err(`${lp}.to`, 'a claim cannot link to itself');
        if (!RELS.includes(l.rel as Rel)) err(`${lp}.rel`, `must be one of ${RELS.join(' | ')}, got ${JSON.stringify(l.rel)}`);
        const w = l.w === undefined ? 1 : l.w;
        if (typeof w !== 'number' || !(w > 0) || w > 1) err(`${lp}.w`, `must be a weight in (0, 1]; anything >= 1 on a non-identity edge lets every claim reach every other, got ${JSON.stringify(l.w)}`);
        return { to: String(l.to), rel: l.rel as Rel, w: Number(w) };
      })
      .filter(Boolean) as Link[];

    const evidence = asArray(row.evidence)
      .map((e, j) => {
        const ep = `${named}.evidence[${j}]`;
        if (!isObj(e)) {
          err(ep, 'must be a mapping');
          return null;
        }
        const target = String(e.target ?? '');
        const [tk, rest] = target.split(':');
        const bullet = (rest || '').includes('/');
        if (!TARGET_KINDS.includes(tk as TargetKind) || !rest) {
          err(`${ep}.target`, `must be "<${TARGET_KINDS.join('|')}>:<id>", optionally "position:<id>/<bullet>", got ${JSON.stringify(e.target)}`);
        } else if (bullet && tk !== 'position') {
          err(`${ep}.target`, `only a position has bullets; "${target}" addresses a ${tk}`);
        } else if (!seenTargets.has(target)) {
          err(`${ep}.target`, bullet ? `"${target}" names no bullet declared on that position` : `"${target}" is not declared under targets.${tk}s`);
        }
        const depth = (e.depth ?? 'used') as Depth;
        if (!DEPTHS.includes(depth)) err(`${ep}.depth`, `must be one of ${DEPTHS.join(' | ')}, got ${JSON.stringify(e.depth)}`);
        if (e.proof !== undefined && e.proof !== null) {
          if (typeof e.proof !== 'string' || !e.proof.trim()) err(`${ep}.proof`, 'if present, a non-empty sentence');
          else if (e.proof.length > MAX_PROOF) err(`${ep}.proof`, `${e.proof.length} chars, limit ${MAX_PROOF} — this is pasted into a 300-char outreach note`);
        }
        if (e.since !== undefined && e.since !== null && !MONTH.test(String(e.since))) err(`${ep}.since`, `YYYY or YYYY-MM, got ${JSON.stringify(e.since)}`);
        return { target, depth, proof: e.proof ? String(e.proof) : undefined, since: e.since ? String(e.since) : undefined };
      })
      .filter(Boolean) as Evidence[];

    const seenSurfaces = new Set<string>();
    const mentions = asArray(row.mentions)
      .map((m, j) => {
        const mp = `${named}.mentions[${j}]`;
        if (!isObj(m)) {
          err(mp, 'must be a mapping');
          return null;
        }
        const surface = m.surface as Surface;
        if (!SURFACES.includes(surface)) err(`${mp}.surface`, `must be one of ${SURFACES.join(' | ')}, got ${JSON.stringify(m.surface)}`);
        else if (seenSurfaces.has(surface)) err(`${mp}.surface`, `"${surface}" listed twice for this claim`);
        else seenSurfaces.add(surface);
        if (m.url !== undefined && m.url !== null && !HTTP_URL.test(String(m.url))) err(`${mp}.url`, `must be an http(s) URL, got ${JSON.stringify(m.url)}`);
        return { surface, url: m.url ? String(m.url) : undefined, listed: m.listed === undefined || m.listed === null ? true : m.listed === true };
      })
      .filter(Boolean) as Mention[];

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
        profile: { name: String(profile.name).trim(), headline: typeof headline === 'string' ? headline.trim() : '' },
        targets: {
          projects: projects as unknown as ProjectTarget[],
          positions: positions as unknown as PositionTarget[],
          educations: educations as unknown as EducationTarget[],
        },
        claims,
      };

  return { errors, warnings, doc };
}

export function checkYaml(text: string, opts: CheckOptions = {}): Check {
  try {
    // maxAliasCount stops a small file that expands into a huge tree.
    return checkDoc(parseYaml(text, { maxAliasCount: 100 }), opts);
  } catch (e) {
    return { errors: [`yaml: ${(e as Error).message}`], warnings: [], doc: null };
  }
}

export function emptyDoc(name: string): ClaimsDoc {
  return { version: 1, profile: { name, headline: '' }, targets: { projects: [], positions: [], educations: [] }, claims: [] };
}

function prune(v: unknown): unknown {
  if (Array.isArray(v)) {
    const a = v.map(prune).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);
      if (p !== undefined) o[k] = p;
    }
    return Object.keys(o).length ? o : undefined;
  }
  if (v === null || v === undefined || v === '') return undefined;
  return v;
}

/** The document without null, empty text and empty lists. Two documents with
 *  the same data have the same canonical form, so it is the form to compare. */
export function canonicalDoc(doc: ClaimsDoc): Record<string, unknown> {
  return (prune(doc) ?? {}) as Record<string, unknown>;
}

export function toYaml(doc: ClaimsDoc): string {
  return `# Waypoint profile (claims.yml). Import it again in Settings → Data.\n${stringifyYaml(canonicalDoc(doc), { lineWidth: 0 })}`;
}

/** A lowercase-kebab-case slug of at most 48 characters. A used slug gets "-2", "-3" and so on. The result goes into `taken`. */
export function slugify(text: string, taken: Set<string>, fallback = 'item'): string {
  const base =
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || fallback;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

export type DiffLine = { kind: 'profile' | 'position' | 'education' | 'project' | 'claim'; key: string; label: string; change: 'added' | 'removed' | 'changed' };

/** What changes when `after` replaces `before`: one line for each item, in the order profile, positions, educations, projects, claims. */
export function diffDocs(before: ClaimsDoc | null, after: ClaimsDoc): DiffLine[] {
  const out: DiffLine[] = [];
  // The keys are sorted, so the same data in another key order is no change.
  const sorted = (_: string, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
  const same = (a: unknown, b: unknown) => JSON.stringify(prune(a), sorted) === JSON.stringify(prune(b), sorted);
  if (!before || !same(before.profile, after.profile)) out.push({ kind: 'profile', key: 'profile', label: 'Name and headline', change: before ? 'changed' : 'added' });
  const lists: [DiffLine['kind'], { key: string; label: string; v: unknown }[], { key: string; label: string; v: unknown }[]][] = [
    ['position', (before?.targets.positions ?? []).map((p) => ({ key: p.id, label: `${p.title} at ${p.company}`, v: p })), after.targets.positions.map((p) => ({ key: p.id, label: `${p.title} at ${p.company}`, v: p }))],
    ['education', (before?.targets.educations ?? []).map((e) => ({ key: e.id, label: e.school, v: e })), after.targets.educations.map((e) => ({ key: e.id, label: e.school, v: e }))],
    ['project', (before?.targets.projects ?? []).map((p) => ({ key: p.id, label: p.title, v: p })), after.targets.projects.map((p) => ({ key: p.id, label: p.title, v: p }))],
    ['claim', (before?.claims ?? []).map((c) => ({ key: c.slug, label: c.label, v: c })), after.claims.map((c) => ({ key: c.slug, label: c.label, v: c }))],
  ];
  for (const [kind, a, b] of lists) {
    const old = new Map(a.map((x) => [x.key, x]));
    const next = new Set(b.map((x) => x.key));
    for (const x of b) {
      const was = old.get(x.key);
      if (!was) out.push({ kind, key: x.key, label: x.label, change: 'added' });
      else if (!same(was.v, x.v)) out.push({ kind, key: x.key, label: x.label, change: 'changed' });
    }
    for (const x of a) if (!next.has(x.key)) out.push({ kind, key: x.key, label: x.label, change: 'removed' });
  }
  return out;
}

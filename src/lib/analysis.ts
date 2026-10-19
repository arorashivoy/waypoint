import type { Job } from '@prisma/client';
import { db } from './db';
import { credentialFor } from './claude';
import { askJsonCached } from './cache';
import { coerceText, jobCheckSchema, BLOCKER_TYPES, LEGITIMACY_FLAGS } from './schemas';
import { jobCheckPrompt, jobCheckSystem, PROMPT_VERSIONS } from './prompts';
import { claimsFor, profileSummary } from './user';
import { fieldFit, levelFit, rankRoutes, routeLabel } from './match';
import { checkEvidence, checkReply, citableClaims, fieldChoices, jobCheckProfileText, postedText, scoreCheck, type Blocker, type JobCheck, type Requirement, type ScorePart } from './jobcheck';
import { getSettings } from './settings';
import { CV_COUNTRY_RULES, FIELD_QUERIES } from './countries';
import { type ClaimsDoc } from './claims';
import { claimsInPosting, projectPicks, rankEvidence, type ProjectPick } from './resume';
import { fieldFromText, levelFromPosting, requiredYears } from './sources/geo';

/** What is stored: the checked reply, and who made it. The score is computed on every read. */
export type StoredAnalysis = JobCheck & { by: 'claude' | 'heuristic'; promptVersion: string };
export type Analysis = StoredAnalysis & { score: number; parts: ScorePart[] };

/** `promptVersion` of an analysis that was stored before the job check existed. */
const LEGACY_VERSION = 'analysis-v1';

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

function readRequirement(r: any): Requirement {
  // The old shape was { t, ok }. Old analyses are read, not migrated.
  if (r && typeof r === 'object' && 'text' in r) {
    return {
      text: coerceText(r.text),
      importance: r.importance === 'nice' ? 'nice' : 'must',
      status: r.status === 'met' || r.status === 'partial' ? r.status : 'missing',
      evidence: Array.isArray(r.evidence) ? r.evidence.filter((x: unknown): x is string => typeof x === 'string') : [],
    };
  }
  return { text: coerceText(r?.t ?? r), importance: 'must', status: r?.ok ? 'met' : 'missing', evidence: [] };
}

/** Reads a stored analysis of the old shape or the new shape. The model sometimes
 *  wrapped a string in an object, so every text goes through `coerceText`. */
function normalise(a: any, by: StoredAnalysis['by'] = a.by): StoredAnalysis {
  return {
    requirements: (a.requirements || []).map(readRequirement),
    blockers: (a.blockers || []).filter((b: any): b is Blocker => oneOf(BLOCKER_TYPES, b?.type) && typeof b?.quote === 'string'),
    legitimacy: (a.legitimacy || []).filter((x: unknown): x is JobCheck['legitimacy'][number] => oneOf(LEGITIMACY_FLAGS, x)),
    field: coerceText(a.field),
    mode: coerceText(a.mode),
    level: coerceText(a.level),
    sponsor: Boolean(a.sponsor),
    visa: coerceText(a.visa),
    summary: coerceText(a.summary),
    by,
    promptVersion: typeof a.promptVersion === 'string' ? a.promptVersion : LEGACY_VERSION,
  };
}

const parseAnalysis = (raw: string) => normalise(JSON.parse(raw));

/** The two fields claims.yml has the strongest job or project evidence for. Without
 *  a claims file, Backend: every software profile overlaps it. */
function strongFields(doc: ClaimsDoc | null): string[] {
  if (!doc) return ['Backend'];
  return FIELD_QUERIES.map((q) => ({ field: q.field, score: rankEvidence(doc, q.query).find((p) => p.kind === 'project' || p.kind === 'position')?.score || 0 }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((f) => f.field);
}

/** What claims.yml says about fit in each field. Scoring it runs the claim
 *  graph once per field, so it is built once per load and shared by every job
 *  in the list, not recomputed per job. */
type Fit = { claims: ClaimsDoc | null; strong: string[]; picks: ProjectPick[] };

function fitFromClaims(claims: ClaimsDoc | null): Fit {
  return { claims, strong: strongFields(claims), picks: projectPicks(claims) };
}

/** Keyword overlap, used when Claude is not reachable so the app still works. */
function heuristicAnalysis(job: Job, profile: Awaited<ReturnType<typeof profileSummary>>, fit: Fit): StoredAnalysis {
  const haystack = [
    ...profile.positions.map((p) => `${p.title} ${p.company} ${p.summary || ''}`),
    ...profile.projects.map((p) => `${p.title} ${p.description || ''}`),
    ...profile.skills,
  ].join(' ').toLowerCase();

  const field = fieldFromText(`${job.role}\n${job.description}`);

  // Deliberately narrow patterns. An earlier, looser set matched words that
  // appear in any corporate posting — "platform", "systems", "optimization" —
  // and handed a paid-search marketing role a 65% score. Used only when there
  // is no claims.yml; with one, the posting is read against the claim graph.
  const candidates = [
    ['Production systems at scale', /high[- ]throughput|low[- ]latency|production services|scalab(le|ility)|high availability/i],
    ['Java or Spring', /\bjava\b|spring boot|\bjvm\b/i],
    ['Python', /\bpython\b|\bdjango\b|\bfastapi\b/i],
    ['C++', /\bc\+\+\b|\bcpp\b/i],
    ['Distributed systems', /distributed systems|\bkafka\b|microservices|event[- ]driven/i],
    ['Machine learning', /\bbert\b|transformer|pytorch|tensorflow|machine learning engineer|deep learning/i],
    ['Strong algorithms and maths', /data structures and algorithms|numerical method|linear algebra|competitive programming/i],
  ] as const;

  const { claims } = fit;
  // Same shape as a check by Claude. The claims.yml path names the slug of the
  // claim as evidence. The keyword path has no slug, so a "met" there has an
  // empty evidence list; the score of a heuristic is capped at 65 (see `viewOf`).
  const found: { text: string; ok: boolean; slug?: string }[] =
    field === 'Other'
      ? [{ text: 'A software engineering role', ok: false }]
      : claims
      ? claimsInPosting(claims, `${job.role}\n${job.description}`).slice(0, 5).map((r) => ({ text: r.t, ok: r.ok, slug: r.slug }))
      : candidates
          .filter(([, re]) => re.test(job.description) || re.test(job.role))
          .slice(0, 5)
          .map(([text, re]) => ({ text, ok: re.test(haystack) }));

  // A posting that names none of these is outside the profile's vocabulary, so
  // nothing is credited until Claude has actually read it.
  if (found.length < 2) found.push({ text: 'Core skills named in the posting', ok: false });

  const requirements: Requirement[] = found.map((r) => ({
    text: r.text,
    importance: 'must',
    status: r.ok ? 'met' : 'missing',
    evidence: r.ok && r.slug ? [r.slug] : [],
  }));

  return {
    field,
    mode: job.mode,
    level: job.level,
    sponsor: job.sponsor,
    visa: job.visa,
    requirements,
    blockers: [],
    legitimacy: [],
    summary: '',
    by: 'heuristic',
    promptVersion: 'heuristic-1',
  };
}

/** The CV lines and the project order that the job screen shows. Code makes them
 *  from the profile and the country, not the model. */
function cvHints(job: Job, profile: Profile, fit: Fit) {
  const lead = fit.picks.find((p) => p.role === job.field)?.lead;
  const projects = profile.projects
    .map((p) => ({ n: p.title, why: p.title === lead ? 'Closest match to this posting' : 'Supporting evidence, one line' }))
    .sort((a, b) => (a.n === lead ? -1 : b.n === lead ? 1 : 0))
    .slice(0, 3);
  const must = [
    job.cc === 'IN'
      ? 'A notice period line'
      : `A work authorisation line: "Will require ${job.visa === 'Sponsorship not stated' ? 'sponsorship' : job.visa} sponsorship"`,
    ...(CV_COUNTRY_RULES[job.cc] || []).slice(0, 1),
  ].filter(Boolean);
  return { must, projects };
}

/** Adds the score. It depends on the profile, so it is computed on every read and not stored. */
function scored(stored: StoredAnalysis, profile: Profile, fit: Fit): Analysis {
  // The slugs are checked again against the claims that exist now, so a claim
  // that the user deleted stops giving credit. Old analyses and heuristics have no slugs to check.
  const checked =
    stored.by === 'claude' && stored.promptVersion !== LEGACY_VERSION
      ? { ...stored, requirements: checkEvidence(stored.requirements, new Set(citableClaims(fit.claims).map((c) => c.slug))) }
      : stored;
  return { ...checked, ...scoreCheck(checked, fieldFit(checked.field, fit.strong), levelFit(checked.level, profile.levels)) };
}

/** How many times a posting may fail analysis before it stops being queued. A
 *  posting whose description breaks the model every time would otherwise take a
 *  slot out of every refresh's budget forever. */
export const MAX_ANALYSIS_TRIES = 3;

/**
 * `analysedAt` — not the stored analysis — is the flag that means "Claude has
 * read this". Both live on the `JobAnalysis` row of the user. They differ
 * whenever a call failed: the heuristic is still written so the card
 * has something to show, but the job stays eligible for a retry instead of being
 * silently frozen at a keyword guess.
 *
 * The model call itself goes through `askJsonCached`, so a posting syndicated to
 * two boards under two externalIds costs one call, not two.
 */
export async function analyseJob(job: Job, userId: string, force = false): Promise<Analysis> {
  const row = await db.jobAnalysis.findUnique({ where: { userId_jobId: { userId, jobId: job.id } } });
  const [profile, claims] = await Promise.all([profileSummary(userId), claimsFor(userId)]);
  const fit = fitFromClaims(claims);
  if (row?.analysedAt && !force) return scored(parseAnalysis(row.analysis), profile, fit);

  let stored: StoredAnalysis;
  let read = false;

  if (!(await credentialFor(userId))) {
    stored = heuristicAnalysis(job, profile, fit);
  } else {
    try {
      const [settings, prefs] = await Promise.all([getSettings(userId), db.countryPref.findMany({ where: { userId, on: true }, orderBy: { rank: 'asc' } })]);
      const fields = fieldChoices(settings.fields);
      const out = await askJsonCached(
        'job-check',
        PROMPT_VERSIONS['job-check'],
        {
          system: jobCheckSystem(jobCheckProfileText(claims, { ...settings, fields }, prefs.map((p) => p.cc))),
          prompt: jobCheckPrompt(job),
          schema: jobCheckSchema(fields),
          effort: 'medium',
        },
        { userId, kind: 'analysis' },
      );
      // The quotes are checked against the text that the model saw: after `sanitise`, not the raw description.
      const posting = postedText(job);
      const check = checkReply(out, { slugs: new Set(citableClaims(claims).map((c) => c.slug)), posting, fields, fallback: { level: job.level, mode: job.mode } });
      stored = { ...check, by: 'claude', promptVersion: PROMPT_VERSIONS['job-check'] };
      read = true;
    } catch {
      stored = heuristicAnalysis(job, profile, fit);
    }
  }

  const analysis = scored(stored, profile, fit);
  await db.jobAnalysis.upsert({
    where: { userId_jobId: { userId, jobId: job.id } },
    create: { userId, jobId: job.id, analysis: JSON.stringify(analysis), analysedAt: read ? new Date() : null, tries: read ? 0 : 1 },
    update: { analysis: JSON.stringify(analysis), ...(read ? { analysedAt: new Date() } : { tries: { increment: 1 } }) },
  });
  return analysis;
}

type Profile = Awaited<ReturnType<typeof profileSummary>>;

/** Scanning every description on every page load costs ~300 ms on the Pi, so the
 *  result is kept until the description it came from changes. */
const statedLevels = new Map<string, { length: number; level: string | null }>();

/** Years the posting states beat any stored level: analyses written before the
 *  prompt defined levels by years carry the model's unanchored guess. */
function levelOf(job: Job, analysis: StoredAnalysis): string {
  let seen = statedLevels.get(job.id);
  if (!seen || seen.length !== job.description.length) {
    const level = requiredYears(job.description) === null ? null : levelFromPosting(job.role, job.description);
    seen = { length: job.description.length, level };
    statedLevels.set(job.id, seen);
  }
  return seen.level ?? analysis.level;
}

function viewOf(job: Job, profile: Profile, contacts: { company: string | null; position: string | null; firstName: string; lastName: string; profileUrl: string | null }[], stored: StoredAnalysis, fit: Fit) {
  const analysis = scored({ ...stored, level: levelOf(job, stored) }, profile, fit);
  const routes = rankRoutes(contacts as any, {
    company: job.company,
    field: analysis.field,
    currentEmployer: profile.currentEmployer,
    schools: profile.schools,
    interests: profile.interests,
  });

  const provisional = analysis.by !== 'claude';
  // A keyword guess is never allowed to outrank a posting Claude actually read.
  const match = provisional ? Math.min(analysis.score, 65) : analysis.score;

  return { analysis, routes, match, provisional, path: routeLabel(routes, job.company), hints: cvHints(job, profile, fit) };
}

/**
 * Scoring a list of jobs needs the profile and the connection list exactly once,
 * not once per job — with a few hundred listings that difference is hundreds of
 * queries per page load.
 */
export async function makeJobViewer(userId: string) {
  const [profile, claims, contacts, rows] = await Promise.all([
    profileSummary(userId),
    claimsFor(userId),
    db.contact.findMany({ where: { userId } }),
    db.jobAnalysis.findMany({ where: { userId } }),
  ]);
  const stored = new Map(rows.map((r) => [r.jobId, r.analysis]));
  const fit = fitFromClaims(claims);
  return (job: Job) => {
    const raw = stored.get(job.id);
    return viewOf(job, profile, contacts, raw ? parseAnalysis(raw) : heuristicAnalysis(job, profile, fit), fit);
  };
}

export async function jobView(job: Job, userId: string, opts: { analyse?: boolean } = {}) {
  const [profile, claims, contacts, row] = await Promise.all([
    profileSummary(userId),
    claimsFor(userId),
    db.contact.findMany({ where: { userId } }),
    db.jobAnalysis.findUnique({ where: { userId_jobId: { userId, jobId: job.id } } }),
  ]);

  const fit = fitFromClaims(claims);
  const analysis: StoredAnalysis = row
    ? parseAnalysis(row.analysis)
    : opts.analyse
      ? await analyseJob(job, userId)
      : heuristicAnalysis(job, profile, fit);

  return viewOf(job, profile, contacts, analysis, fit);
}


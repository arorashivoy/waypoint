import { BLOCKER_TYPES, LEGITIMACY_FLAGS, type JobCheckReplyT } from './schemas';
import { FIELD_CHOICES } from './settings';
import { matchScore } from './match';
import { sanitise } from './prompts';
import type { Claim, ClaimsDoc, Depth } from './claims';

/**
 * The job check. The model reads the posting and the profile. It gives
 * requirements with evidence slugs, blockers with quotes, and flags. The server
 * checks the slugs and the quotes, and code computes the score. The model never
 * gives a score.
 */

/** A checked reply: every value is inside its list. `level` and `mode` are plain text, because the heuristic and old analyses read them from job rows. */
export type JobCheck = {
  requirements: { text: string; importance: 'must' | 'nice'; status: 'met' | 'partial' | 'missing'; evidence: string[] }[];
  blockers: { type: (typeof BLOCKER_TYPES)[number]; quote: string }[];
  legitimacy: (typeof LEGITIMACY_FLAGS)[number][];
  level: string;
  mode: string;
  sponsor: boolean;
  visa: string;
  field: string;
  summary: string;
};
/** The reply as the model gives it, before `checkReply`. */
export type JobCheckReply = JobCheckReplyT;
export type Requirement = JobCheck['requirements'][number];
export type Blocker = JobCheck['blockers'][number];

export type ScorePart = { kind: 'requirement' | 'blocker' | 'field' | 'level' | 'limit'; label: string; points: number };

/** Points that one blocker takes from the score. */
export const BLOCKER_PENALTY = 25;
const IMPORTANCE_WEIGHT = { must: 3, nice: 1 } as const;
const STATUS_CREDIT = { met: 1, partial: 0.5, missing: 0 } as const;

/** The fields for the schema: the saved fields of the user, or the default list. 'Other' is always there. */
export function fieldChoices(saved: readonly string[]): string[] {
  return [...new Set([...(saved.length ? saved : FIELD_CHOICES), 'Other'])];
}

/** The claims that a reply may cite: a claim with evidence deeper than 'mentioned'. */
export function citableClaims(doc: ClaimsDoc | null): Claim[] {
  return (doc?.claims ?? []).filter((c) => c.evidence.some((e) => e.depth !== 'mentioned'));
}

const DEPTH_ORDER: Depth[] = ['mentioned', 'used', 'built'];

/** One line for a claim: slug · label · depth · proof. */
function claimLine(c: Claim): string {
  const top = c.evidence.reduce((best, e) => (DEPTH_ORDER.indexOf(e.depth) > DEPTH_ORDER.indexOf(best) ? e.depth : best), 'mentioned' as Depth);
  const proof = c.evidence.find((e) => e.depth === top && e.proof)?.proof ?? c.evidence.find((e) => e.proof)?.proof ?? '-';
  return [c.slug, c.label, top, proof].join(' · ').replace(/\s*\n\s*/g, ' ');
}

/** The text of the profile block of the system prompt. `profile()` fences it. */
export function jobCheckProfileText(doc: ClaimsDoc | null, settings: { fields: readonly string[]; visaStatus: string }, countries: readonly string[]): string {
  const lines = citableClaims(doc).map(claimLine);
  return [
    'Claims (slug · label · depth · proof):',
    ...(lines.length ? lines : ['none']),
    `Countries: ${countries.join(', ') || 'none'}`,
    `Fields (choose one for "field"): ${settings.fields.join(', ') || 'none'}`,
    `Visa status: ${settings.visaStatus || 'not stated'}`,
  ].join('\n');
}

/**
 * Text for a quote match. NFKC turns full-width characters into plain ones; the
 * prompt builder changes `<` and `>` to full-width, so the model quotes them
 * that way. Case and white space do not matter.
 */
export const normaliseQuote = (s: string): string =>
  s.normalize('NFKC').replace(/＜/g, '<').replace(/＞/g, '>').toLowerCase().replace(/\s+/g, ' ').trim();

/** The posting text that the model saw: after `sanitise`. `checkReply` matches the quotes of blockers against it. */
export function postedText(job: { role: string; company: string; city: string; description: string }): string {
  return [job.role, job.company, job.city].map((v) => sanitise(v, 400)).join('\n') + `\n${sanitise(job.description)}`;
}

const oneOf = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);
const words = (s: string, max: number) => s.trim().split(/\s+/).filter(Boolean).slice(0, max).join(' ');

/** The most requirements and blockers that a check keeps. */
export const MAX_REQUIREMENTS = 15;
export const MAX_BLOCKERS = 6;
/** A quote shorter than this is in almost every posting, so it proves nothing. */
const MIN_QUOTE_WORDS = 3;
const MIN_QUOTE_CHARS = 12;
const LEVELS = ['Entry', 'Mid', 'Senior'];
const MODES = ['Remote', 'Hybrid', 'On-site'];

/**
 * Checks the slugs of the requirements against the claims that exist. A "met" or
 * "partial" requirement with a slug that is not in `slugs`, or with no slug,
 * becomes "missing". Unknown slugs are removed. `analysis.ts` runs this again on
 * every read, so a claim that the user deleted stops giving credit.
 */
export function checkEvidence<R extends { status: string; evidence: string[] }>(reqs: R[], slugs: ReadonlySet<string>): R[] {
  return reqs.map((r) => {
    const evidence = r.evidence.filter((s) => slugs.has(s));
    const bad = evidence.length !== r.evidence.length || (r.status !== 'missing' && !evidence.length);
    return { ...r, evidence, status: (bad ? 'missing' : r.status) as R['status'] };
  });
}

/**
 * Turns a reply into a checked `JobCheck`. The reply is parsed leniently, so
 * this function coerces each value:
 * - an unknown `field` becomes "Other" (`ctx.fields` is the allowed list);
 * - an unknown `level` or `mode` becomes `ctx.fallback` (the value of the job
 *   row), or "Mid" and "On-site" without one;
 * - an unknown blocker `type` becomes "other"; an unknown legitimacy flag is dropped;
 * - `importance` outside the list becomes "nice", `status` becomes "missing";
 * - the lists are cut to 15 requirements and 6 blockers, and the summary to 25 words.
 * Then the slugs and the quotes are checked (see `checkEvidence`). A blocker
 * whose quote is not in the posting, or is shorter than 3 words or 12 characters, is removed.
 */
export function checkReply(
  reply: JobCheckReply,
  ctx: { slugs: ReadonlySet<string>; posting: string; fields?: readonly string[]; fallback?: { level?: string; mode?: string } },
): JobCheck {
  const posting = normaliseQuote(ctx.posting);
  const allowed = new Set([...(ctx.fields ?? FIELD_CHOICES), 'Other']);
  const requirements = reply.requirements.slice(0, MAX_REQUIREMENTS).map((r) => ({
    text: r.text,
    importance: r.importance === 'must' ? ('must' as const) : ('nice' as const),
    status: oneOf(['met', 'partial'] as const, r.status) ? r.status : ('missing' as const),
    evidence: r.evidence,
  }));
  return {
    requirements: checkEvidence(requirements, ctx.slugs),
    blockers: reply.blockers
      .map((b) => ({ type: oneOf(BLOCKER_TYPES, b.type) ? b.type : ('other' as const), quote: b.quote }))
      .filter((b) => {
        const q = normaliseQuote(b.quote);
        return q.length >= MIN_QUOTE_CHARS && q.split(' ').length >= MIN_QUOTE_WORDS && posting.includes(q);
      })
      .slice(0, MAX_BLOCKERS),
    legitimacy: [...new Set(reply.legitimacy.filter((f): f is (typeof LEGITIMACY_FLAGS)[number] => oneOf(LEGITIMACY_FLAGS, f)))],
    level: LEVELS.includes(reply.level) ? reply.level : ctx.fallback?.level || 'Mid',
    mode: MODES.includes(reply.mode) ? reply.mode : ctx.fallback?.mode || 'On-site',
    sponsor: reply.sponsor,
    visa: reply.visa,
    field: allowed.has(reply.field) ? reply.field : 'Other',
    summary: words(reply.summary, 25),
  };
}

/** The requirement ratio, from 0 to 1: sum of weight · credit over the sum of weight. No requirement gives 0. */
export function requirementRatio(reqs: readonly Pick<Requirement, 'importance' | 'status'>[]): number {
  const total = reqs.reduce((n, r) => n + IMPORTANCE_WEIGHT[r.importance], 0);
  if (!total) return 0;
  return reqs.reduce((n, r) => n + IMPORTANCE_WEIGHT[r.importance] * STATUS_CREDIT[r.status], 0) / total;
}

const tenth = (n: number) => Math.round(n * 10) / 10;

/**
 * score = clamp(0, 100, matchScore(ratio, fieldFit, levelFit) - 25 · blockers)
 *
 *   ratio      = Σ (weight · credit) / Σ weight
 *   weight     = 3 for "must", 1 for "nice"
 *   credit     = 1 for "met", 0.5 for "partial", 0 for "missing"
 *   matchScore = round(20 · ratio + 40 · fieldFit + 40 · levelFit)
 *
 * Example: 2 "must" met and 1 "nice" missing give ratio (3 + 3) / (3 + 3 + 1) = 0.857,
 * so 85.7 on a scale of 100 before the fits. With field fit 1 and level fit 1
 * the score is round(17.1 + 80) = 97, and one blocker makes it 72.
 *
 * `parts` lists the points of each requirement (they add up to 20 · ratio),
 * each blocker (-25) and the two fits (40 · fit), for the screen.
 */
export function scoreCheck(check: Pick<JobCheck, 'requirements' | 'blockers'>, fieldFit: number, levelFit: number): { score: number; parts: ScorePart[] } {
  const ratio = requirementRatio(check.requirements);
  const total = check.requirements.reduce((n, r) => n + IMPORTANCE_WEIGHT[r.importance], 0);
  const score = Math.max(0, Math.min(100, matchScore(ratio, fieldFit, levelFit) - BLOCKER_PENALTY * check.blockers.length));
  const parts: ScorePart[] = [
    ...check.requirements.map((r): ScorePart => ({
      kind: 'requirement',
      label: r.text,
      points: tenth((20 * IMPORTANCE_WEIGHT[r.importance] * STATUS_CREDIT[r.status]) / total),
    })),
    ...check.blockers.map((b): ScorePart => ({ kind: 'blocker', label: `${b.type}: ${b.quote}`, points: -BLOCKER_PENALTY })),
    { kind: 'field', label: 'Field fit', points: tenth(40 * fieldFit) },
    { kind: 'level', label: 'Level fit', points: tenth(40 * levelFit) },
  ];
  return { score, parts: limitedParts(parts, score, 'Lowest possible score') };
}

/**
 * The parts, plus one `limit` part when the final score is not their sum (the score stops at 0, or an
 * estimate without Claude stops at 65). So the list on the screen always adds up to the badge.
 * A gap under half a point is rounding and stays out.
 */
export function limitedParts(parts: readonly ScorePart[], final: number, label: string): ScorePart[] {
  const gap = final - parts.reduce((n, p) => n + p.points, 0);
  return Math.abs(gap) < 0.5 ? [...parts] : [...parts, { kind: 'limit', label, points: tenth(gap) }];
}

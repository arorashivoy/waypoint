import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Application, Job } from '@prisma/client';
import { db } from '../db';
import { HttpError } from '../auth/http';
import { askJsonCached } from '../cache';
import { claudeStatus } from '../claude';
import { checkForInjection } from '../injection';
import { PROMPT_VERSIONS, SUGGEST_SYSTEM, suggestPrompt } from '../prompts';
import type { ClaimsDoc } from '../claims';
import { CvError, readSteer } from '../cv';
import { bulletItems, resumeConfig, type Steer } from '../resume';
import { enqueueCv } from '../tasks/cv';
import { claimsFor } from '../user';
import { baseOrder } from './template';

/**
 * Wording suggestions and the keyword report (spec 6.1, 6.3).
 *
 * The model proposes new wording for a bullet. The server checks each proposal against the
 * bullet and the proofs of the claims that the proposal names. The user then accepts or rejects
 * each one. Nothing reaches the CV before the user accepts it, and an accepted text is escaped
 * again when it is rendered.
 */

export const MAX_SUGGESTIONS = 8;
/** The longest text of one suggestion. */
export const MAX_SUGGESTION_TEXT = 300;

export const SuggestReply = z.object({
  suggestions: z.array(z.object({ bulletId: z.string(), text: z.string(), claims: z.array(z.string()) })).max(MAX_SUGGESTIONS),
});
export type SuggestReplyT = z.infer<typeof SuggestReply>;
export type Suggestion = SuggestReplyT['suggestions'][number];

const Stored = z.object({
  bulletId: z.string(),
  text: z.string(),
  claims: z.array(z.string()),
  /** The claim labels, for the screen. */
  labels: z.array(z.string()),
  /** The text of the bullet when the server checked the suggestion. */
  old: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected']),
});
const StoredList = z.object({ items: z.array(Stored).max(MAX_SUGGESTIONS), dropped: z.number().int().min(0) });
export type StoredSuggestion = z.infer<typeof Stored>;
export type StoredSuggestions = z.infer<typeof StoredList>;

/** The suggestions of an application. A missing or a broken value gives an empty list. */
export function readSuggestions(app: Pick<Application, 'cvSuggestions'>): StoredSuggestions {
  try {
    const parsed = StoredList.safeParse(app.cvSuggestions ? JSON.parse(app.cvSuggestions) : null);
    if (parsed.success) return parsed.data;
  } catch {
    // A broken value is the same as no value.
  }
  return { items: [], dropped: 0 };
}

/** Technology terms that the check knows besides the skills of the user. Words that are also common English words are not here. */
export const TECH_TERMS = [
  'kubernetes', 'docker', 'terraform', 'ansible', 'jenkins', 'aws', 'gcp', 'azure', 'kafka', 'rabbitmq', 'redis', 'postgresql', 'postgres',
  'mysql', 'mongodb', 'sqlite', 'elasticsearch', 'graphql', 'grpc', 'react', 'angular', 'vue', 'next.js', 'node.js', 'django', 'flask',
  'fastapi', 'tensorflow', 'pytorch', 'spark', 'hadoop', 'airflow', 'python', 'java', 'javascript', 'typescript', 'kotlin', 'scala',
  'rust', 'c++', 'c#', 'php', 'linux', 'git', 'ci/cd', 'sql', 'nginx', 'prometheus', 'grafana', 'openai', 'llm',
];

const fold = (s: string) => s.normalize('NFKC').toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** True if `term` is in `hay` as a whole word. Both are folded. */
const has = (hay: string, term: string) => new RegExp(`(?<![\\p{L}\\p{N}+#])${escapeRe(term)}(?![\\p{L}\\p{N}+#])`, 'u').test(hay);

type Ctx = {
  /** The text of the bullet (and its earlier accepted wording). */
  sourceText: string;
  /** The proofs of the claims that the suggestion names. */
  proofs: string[];
  /** The skills of the user. */
  skills?: string[];
  /** The text that the bullet has now. A suggestion with the same text is no change. */
  current?: string;
  /** Set when the bullet id or a claim slug is not in the profile. */
  problem?: string;
};

export type Check = { ok: true } | { ok: false; why: string };

const NUMBER = /(\d+(?:[.,]\d+)*)\s?(%|percent|(?:hundred|thousand|million|billion|trillion)(?![\p{L}\p{N}])|[kmbx](?![\p{L}\p{N}]))?/giu;
const canon = (n: string, suffix?: string) => n.replace(/,(?=\d{3}(?!\d))/g, '') + (suffix ? (suffix === 'percent' ? '%' : suffix) : '');
const numbersOf = (text: string) => [...fold(text).matchAll(NUMBER)].map((m) => ({ run: canon(m[1]), form: canon(m[1], m[2]), shown: m[0].trim() }));

/** A word with a capital letter anywhere: a name, an acronym (GKE, SOC2) or a mixed form (iOS). */
const CAPITAL_WORD = /(?<![\p{L}\p{N}])[\p{L}\p{N}]*\p{Lu}[\p{L}\p{N}]*/gu;

/** Common résumé verbs. Only the first word of a suggestion may be a capitalised word outside the evidence, and only if it is here. */
export const RESUME_VERBS = new Set(
  `achieved added analysed analyzed architected authored automated built chaired collaborated configured contributed coordinated created
  cut debugged delivered deployed designed developed drove enabled engineered established evaluated extended fixed founded generated
  handled implemented improved increased integrated introduced launched led maintained managed migrated mentored modelled modeled
  monitored optimised optimized organised organized owned planned prototyped reduced refactored released replaced researched resolved
  reviewed scaled shipped simplified solved streamlined supported tested trained wrote ran parsed`.split(/\s+/),
);

/** Number words. Each one in a suggestion must be in the bullet or the proofs, as a digit run must. */
const NUMBER_WORD = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|percent|half|dozen|twice|(?:double|triple|quadruple)[d]?|\\p{L}*fold)(?![\\p{L}\\p{N}])`,
  'gu',
);

/**
 * Checks one suggestion. A suggestion passes if each number, name and technology in it is in the text of
 * the bullet or in the proofs of the claims that it names. The posting can give words, but it never gives
 * a number, a name or a technology: the check does not read the posting.
 * A "name" is any word with a capital letter, an acronym too. Only the first word of the suggestion may be
 * outside the evidence, and only if it is a common résumé verb. A number word counts as a number.
 */
export function checkSuggestion(s: Suggestion, ctx: Ctx): Check {
  if (ctx.problem) return { ok: false, why: ctx.problem };
  const text = s.text.trim();
  if (!text) return { ok: false, why: 'the text is empty' };
  if (text.length > MAX_SUGGESTION_TEXT) return { ok: false, why: `the text is longer than ${MAX_SUGGESTION_TEXT} characters` };
  if (/[\\{}]|https?:\/\/|www\.|\b[\w-]+\.(?:tex|pdf|sh|exe|bat|cls|sty)\b/i.test(text)) return { ok: false, why: 'the text has a command, a link or a file name' };
  if (fold(text) === fold(ctx.current ?? '')) return { ok: false, why: 'the text is the same as the text now' };
  const injection = checkForInjection(text);
  if (injection.suspicious) return { ok: false, why: `the text looks like an instruction to a model (${injection.why})` };

  const hay = fold([ctx.sourceText, ...ctx.proofs].join('\n'));

  const known = numbersOf(hay);
  const runs = new Set(known.map((n) => n.run));
  const forms = new Set(known.map((n) => n.form));
  for (const n of numbersOf(text)) {
    if (!runs.has(n.run) || (n.form !== n.run && !forms.has(n.form))) return { ok: false, why: `the number "${n.shown}" is not in the bullet or the proofs` };
  }

  const shown = fold(text);
  const terms = new Set([...TECH_TERMS, ...(ctx.skills ?? []).map(fold)].filter((t) => t.length >= 2));
  for (const t of terms) {
    if (has(shown, t) && !has(hay, t)) return { ok: false, why: `the technology "${t}" is not in the bullet or the proofs` };
  }

  // Number words. A digit token with its unit was checked above, so it is taken out first.
  const words = fold(text).replace(NUMBER, ' ');
  for (const m of words.matchAll(NUMBER_WORD)) {
    if (!has(hay, m[0])) return { ok: false, why: `the number word "${m[0]}" is not in the bullet or the proofs` };
  }

  for (const m of text.matchAll(CAPITAL_WORD)) {
    if (m.index === 0 && RESUME_VERBS.has(fold(m[0]))) continue;
    if (!has(hay, fold(m[0]))) return { ok: false, why: `the name "${m[0]}" is not in the bullet or the proofs` };
  }
  return { ok: true };
}

/** Where a bullet is: the text that the CV has for it, found by the id. */
type Bullet = { id: string; position: string; match: string; text?: string };
const bulletsOf = (doc: ClaimsDoc): Bullet[] =>
  doc.targets.positions.flatMap((p) => (p.bullets ?? []).map((b) => ({ id: `${p.id}/${b.id}`, position: `${p.title}, ${p.company}`, match: b.match, text: b.text })));

/**
 * What `checkSuggestion` needs for one suggestion, read from the profile. `source` is the line as it
 * is in the CV (an own .tex gives the line from the file); `wording` is the text that the user accepted before.
 */
export function suggestionContext(doc: ClaimsDoc, s: Suggestion, opts: { source?: string; wording?: string } = {}): Ctx {
  const skills = doc.claims.filter((c) => c.kind === 'skill' || c.kind === 'language').flatMap((c) => [c.label, ...c.aliases]);
  const bullet = bulletsOf(doc).find((b) => b.id === s.bulletId);
  const named = s.claims.map((slug) => doc.claims.find((c) => c.slug === slug));
  const base = { sourceText: '', proofs: [] as string[], skills };
  if (!bullet) return { ...base, problem: 'the bullet is not in your profile' };
  const source = opts.source ?? bullet.text ?? bullet.match;
  if (!s.claims.length) return { ...base, problem: 'the suggestion names no claim' };
  const missing = s.claims.filter((_, i) => !named[i]);
  if (missing.length) return { ...base, problem: `the claim "${missing[0]}" is not in your profile` };
  return {
    sourceText: [source, opts.wording].filter(Boolean).join('\n'),
    proofs: named.flatMap((c) => c!.evidence.flatMap((e) => (e.proof ? [e.proof] : []))),
    skills,
    current: opts.wording ?? source,
  };
}

/** LaTeX to the words a reader sees. */
const plainTex = (s: string) =>
  s.replace(/\\([#&%$_{}])/g, '$1').replace(/\\[a-zA-Z]+\*?/g, ' ').replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim();

/** The text of each bullet as the CV has it now. An own .tex gives the line of the file when the match phrase finds it. */
async function sourcesOf(userId: string, doc: ClaimsDoc): Promise<{ map: Map<string, string>; strict: boolean }> {
  const cfg = await resumeConfig(userId);
  // With a .tex source (an own file or RESUME_TEX), only a bullet that the match phrase finds in one item is on the CV.
  const strict = !!cfg.tex && existsSync(cfg.tex);
  const items = strict ? bulletItems(readFileSync(cfg.tex!, 'utf8'), doc) : new Map<string, string>();
  const map = new Map<string, string>();
  for (const b of bulletsOf(doc)) {
    if (items.has(b.id)) map.set(b.id, plainTex(items.get(b.id)!.replace(/^\\item\s*/, '')));
    else if (!strict) map.set(b.id, b.text || b.match);
  }
  return { map, strict };
}

const NOT_FOUND = 'Waypoint could not find this line in your résumé source.';

/** The text of the CV, for the keyword report. */
async function resumeTextOf(userId: string, doc: ClaimsDoc, steer: Steer): Promise<string> {
  const wording = steer.wording ?? {};
  const cfg = await resumeConfig(userId);
  if (cfg.tex && existsSync(cfg.tex)) return [plainTex(readFileSync(cfg.tex, 'utf8')), ...Object.values(wording)].join('\n');
  const order = baseOrder(doc);
  const projects = new Set([...order.projects, ...(steer.projects ?? [])]);
  const skills = new Set([...order.skills, ...(steer.skills ?? [])]);
  return [
    doc.profile.headline,
    ...doc.targets.positions.flatMap((p) => [p.title, p.company, p.summary ?? '', ...(p.bullets ?? []).map((b) => wording[`${p.id}/${b.id}`] ?? b.text ?? b.match)]),
    ...doc.targets.projects.filter((p) => projects.has(p.id)).flatMap((p) => [p.title, p.description ?? '', ...(p.bullets ?? [])]),
    ...doc.claims.filter((c) => skills.has(c.slug)).map((c) => c.label),
  ].join('\n');
}

/**
 * The claims of the profile that the posting names, in two lists of claim labels. A claim is in the
 * posting if its label or an alias is there as a whole word. `missingWithEvidence` holds the claims that
 * the CV does not show and that have evidence deeper than "mentioned". It is computed in code: no model call.
 */
export function keywordReport(postingText: string, resumeText: string, doc: ClaimsDoc): { inResume: string[]; missingWithEvidence: string[] } {
  const posting = fold(postingText);
  const resume = fold(resumeText);
  const inResume: string[] = [];
  const missingWithEvidence: string[] = [];
  for (const c of doc.claims) {
    const names = [c.label, ...c.aliases].map(fold).filter((n) => n.length >= 2);
    if (!names.some((n) => has(posting, n))) continue;
    if (names.some((n) => has(resume, n))) inResume.push(c.label);
    else if (c.evidence.some((e) => e.depth !== 'mentioned')) missingWithEvidence.push(c.label);
  }
  return { inResume, missingWithEvidence };
}

const postingOf = (job: Pick<Job, 'role' | 'description'>) => `${job.role}\n${job.description}`;

/** What the job screen shows: the stored suggestions and the keyword report. */
export async function wordingView(userId: string, job: Job) {
  const app = await db.application.findUnique({ where: { userId_jobId: { userId, jobId: job.id } } });
  const doc = await claimsFor(userId);
  // The report is an extra on the CV view. A fault in it must never fail a build that ended well.
  let keywords: ReturnType<typeof keywordReport> = { inResume: [], missingWithEvidence: [] };
  try {
    if (doc) keywords = keywordReport(postingOf(job), await resumeTextOf(userId, doc, app ? readSteer(app) : {}), doc);
  } catch {
    // Show the empty report.
  }
  const stored = app ? readSuggestions(app) : { items: [], dropped: 0 };
  return {
    suggestions: { dropped: stored.dropped, items: stored.items.map(({ bulletId, text, old, labels, status }) => ({ bulletId, text, old, labels, status })) },
    keywords,
  };
}

/**
 * Asks the model for new wording, checks each suggestion and stores the ones that pass. The worker calls it.
 * The posting is in an `untrusted` fence; the bullets and the proofs are in the `profile` fence.
 */
export async function suggestWording(app: Application, job: Job) {
  const userId = app.userId;
  const doc = await claimsFor(userId);
  if (!doc || !bulletsOf(doc).length) throw new CvError('Suggesting wording needs bullets. Add bullets to your positions on the Profile screen.');
  const { mode, detail } = await claudeStatus(userId);
  if (mode === 'none') throw new CvError(detail);

  const wording = readSteer(app).wording ?? {};
  const { map: sources } = await sourcesOf(userId, doc);
  const bullets = bulletsOf(doc).filter((b) => sources.has(b.id)).map((b) => ({ id: b.id, position: b.position, text: wording[b.id] ?? sources.get(b.id) ?? b.match }));
  if (!bullets.length) throw new CvError('Waypoint could not find any bullet of your profile in your résumé source. Check the match phrases on the Profile screen.');
  const claims = doc.claims
    .map((c) => ({ slug: c.slug, label: c.label, proofs: c.evidence.flatMap((e) => (e.proof ? [e.proof] : [])) }))
    .filter((c) => c.proofs.length)
    .slice(0, 80);

  const out = await askJsonCached(
    'resume-suggest',
    PROMPT_VERSIONS['resume-suggest'],
    { system: SUGGEST_SYSTEM, prompt: suggestPrompt(bullets, claims, job), schema: SuggestReply, effort: 'medium' },
    { userId, kind: 'resume-suggest' },
    { perUser: true },
  );

  const items: StoredSuggestion[] = [];
  let dropped = 0;
  for (const s of out.suggestions) {
    const ctx = suggestionContext(doc, s, { source: sources.get(s.bulletId), wording: wording[s.bulletId] });
    if (!sources.has(s.bulletId) || items.some((i) => i.bulletId === s.bulletId) || !checkSuggestion(s, ctx).ok) {
      dropped++;
      continue;
    }
    const labels = s.claims.map((slug) => doc.claims.find((c) => c.slug === slug)!.label);
    items.push({ bulletId: s.bulletId, text: s.text.trim(), claims: s.claims, labels, old: ctx.current ?? '', status: 'pending' });
  }
  await db.application.update({ where: { id: app.id }, data: { cvSuggestions: JSON.stringify({ items, dropped }) } });
  return wordingView(userId, job);
}

/**
 * The decision of the user on one suggestion. Reject only marks it. Accept checks it again against the
 * profile as it is now, writes the text into the steer as a wording for the bullet, and queues a build.
 * If the build task cannot be queued (another `cv` task is open), nothing changes.
 */
export async function decideSuggestion(userId: string, jobId: string, bulletId: string, action: 'accept' | 'reject') {
  const app = await db.application.findUnique({ where: { userId_jobId: { userId, jobId } } });
  if (!app) throw new HttpError(404, 'Not found.');
  const stored = readSuggestions(app);
  const found = stored.items.find((i) => i.bulletId === bulletId);
  if (!found) throw new HttpError(404, 'Not found.');
  if (found.status !== 'pending') throw new HttpError(409, 'You decided on this suggestion already.');
  const mark = (status: 'accepted' | 'rejected') =>
    JSON.stringify({ ...stored, items: stored.items.map((i) => (i.bulletId === bulletId ? { ...i, status } : i)) });

  if (action === 'reject') {
    await db.application.update({ where: { id: app.id }, data: { cvSuggestions: mark('rejected') } });
    return { taskId: null as string | null };
  }

  const doc = await claimsFor(userId);
  const steer = readSteer(app);
  const s = { bulletId, text: found.text, claims: found.claims };
  const { map: sources } = doc ? await sourcesOf(userId, doc) : { map: new Map<string, string>() };
  // The change must be possible now: with a .tex source the line must be there, or the card would say "Accepted" for nothing.
  if (doc && !sources.has(bulletId)) throw new HttpError(409, NOT_FOUND);
  const checked = doc && checkSuggestion(s, suggestionContext(doc, s, { source: sources.get(bulletId), wording: steer.wording?.[bulletId] }));
  if (!checked?.ok) throw new HttpError(409, 'Your profile changed, so this suggestion is no longer safe. Ask for new suggestions.');

  const next: Steer = { ...steer, wording: { ...steer.wording, [bulletId]: found.text } };
  await db.application.update({ where: { id: app.id }, data: { cvSteer: JSON.stringify(next), cvSuggestions: mark('accepted') } });
  try {
    return { taskId: await enqueueCv(userId, jobId, { action: 'generate' }) };
  } catch (e) {
    await db.application.update({ where: { id: app.id }, data: { cvSteer: app.cvSteer, cvSuggestions: app.cvSuggestions } });
    throw e;
  }
}

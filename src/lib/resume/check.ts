import { checkForInjection } from '../injection';

/**
 * The check of a new CV line against its evidence (spec 6.1). It is pure: it reads no file, no database
 * and no posting. `suggest.ts` (Suggest wording) and `written.ts` (the written CV) both use it.
 */

/** The longest text of one suggestion. */
export const MAX_SUGGESTION_TEXT = 300;

/** A proposed line: the bullet it is for, the text, and the claims that back it. */
export type Suggestion = { bulletId: string; text: string; claims: string[] };

/** Technology terms that the check knows besides the skills of the user. Words that are also common English words are not here. */
export const TECH_TERMS = [
  'kubernetes', 'docker', 'terraform', 'ansible', 'jenkins', 'aws', 'gcp', 'azure', 'kafka', 'rabbitmq', 'redis', 'postgresql', 'postgres',
  'mysql', 'mongodb', 'sqlite', 'elasticsearch', 'graphql', 'grpc', 'react', 'angular', 'vue', 'next.js', 'node.js', 'django', 'flask',
  'fastapi', 'tensorflow', 'pytorch', 'spark', 'hadoop', 'airflow', 'python', 'java', 'javascript', 'typescript', 'kotlin', 'scala',
  'rust', 'c++', 'c#', 'php', 'linux', 'git', 'ci/cd', 'sql', 'nginx', 'prometheus', 'grafana', 'openai', 'llm',
];

export const fold = (s: string) => s.normalize('NFKC').toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** True if `term` is in `hay` as a whole word. Both are folded. */
export const has = (hay: string, term: string) => new RegExp(`(?<![\\p{L}\\p{N}+#])${escapeRe(term)}(?![\\p{L}\\p{N}+#])`, 'u').test(hay);

export type Ctx = {
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

const NUMBER = /(\d+(?:[.,]\d+)*)\s?(%|percent|(?:hundred|thousand|million|billion|trillion)(?![\p{L}\p{N}])|[kmbx\u00d7](?![\p{L}\p{N}]))?/giu;
const canon = (n: string, suffix?: string) => n.replace(/,(?=\d{3}(?!\d))/g, '') + (suffix ? (suffix === 'percent' ? '%' : suffix) : '');
const numbersOf = (text: string) => [...fold(text).matchAll(NUMBER)].map((m) => ({ run: canon(m[1]), form: canon(m[1], m[2]), shown: m[0].trim() }));

/** A word with a capital letter anywhere: a name, an acronym (GKE, SOC2) or a mixed form (iOS). */
// A trailing + or # is part of the name (C++, C#), so the name is looked up whole.
const CAPITAL_WORD = /(?<![\p{L}\p{N}])[\p{L}\p{N}]*\p{Lu}[\p{L}\p{N}]*[+#]*/gu;

/** Common résumé verbs. Only the first word of a suggestion may be a capitalised word outside the evidence, and only if it is here. */
export const RESUME_VERBS = new Set(
  `achieved added analysed analyzed architected authored automated built chaired collaborated configured contributed coordinated created
  cut debugged delivered deployed designed developed drove enabled engineered established evaluated extended fixed founded generated
  handled implemented improved increased integrated introduced launched led maintained managed migrated mentored modelled modeled
  monitored optimised optimized organised organized owned planned prototyped reduced refactored released replaced researched resolved
  reviewed scaled shipped published also including includes featuring alongside plus with covers spanning simplified solved streamlined supported tested trained wrote ran parsed used applied worked`.split(/\s+/),
);

/** Number words. Each one in a suggestion must be in the bullet or the proofs, as a digit run must. */
const NUMBER_WORD = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|percent|half|dozen|twice|(?:double|triple|quadruple)[d]?|\\p{L}*fold|(?:(?:a|one|two|three|four|five|six|seven|eight|nine)\\s+)(?:third|quarter|fifth|sixth|eighth|tenth)s?(?!-))(?![\\p{L}\\p{N}])`,
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
    if (!runs.has(n.run) || !forms.has(n.form)) return { ok: false, why: `the number "${n.shown}" is not in the bullet or the proofs` };
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


import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { promisify } from 'util';
import type { Claim, ClaimsDoc } from './claims';
import { FIELD_QUERIES } from './countries';

const run = promisify(execFile);

/**
 * Per-job CVs.
 *
 * Two separate jobs live here, and keeping them separate is the point:
 *
 *   1. *Choosing* what to lead with, which is deterministic. The claim graph
 *      already records which project evidences what, so the posting's own words
 *      can be matched against claim labels, aliases and links without asking a
 *      model anything. Free, repeatable, and explainable — the API says which
 *      claims matched.
 *   2. *Producing* the document, which is best-effort. It needs a LaTeX source
 *      and an engine on the host. When either is missing the base PDF is served
 *      unchanged, so the referral flow never blocks on a toolchain.
 *
 * Nothing here is hardcoded to one person's filesystem: every path comes from
 * the environment, and with none of it set the whole feature turns itself off.
 */

/** `~/Programs/…` in a .env file is a literal tilde, not a home directory. */
const expand = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : resolve(p));
const env = (k: string) => {
  const v = (process.env[k] || '').trim();
  return v ? v : null;
};

export type ResumeConfig = {
  /** The CV as it stands. Served whenever tailoring is unavailable. */
  pdf: string | null;
  /** LaTeX source. Its absence means "no tailoring", not an error. */
  tex: string | null;
  /** A URL a recruiter can actually open. localhost is not one, which is why
   *  this is separate from `pdf` and why the message only claims a link when it
   *  is set. */
  publicUrl: string | null;
  outDir: string;
  maxProjects: number | null;
  timeoutMs: number;
};

export function resumeConfig(): ResumeConfig {
  const pdf = env('RESUME_PDF');
  const tex = env('RESUME_TEX');
  const max = Number(env('RESUME_MAX_PROJECTS'));
  return {
    pdf: pdf ? expand(pdf) : null,
    tex: tex ? expand(tex) : null,
    publicUrl: env('RESUME_PUBLIC_URL'),
    outDir: expand(env('RESUME_OUT_DIR') || 'data/resumes'),
    maxProjects: Number.isFinite(max) && max > 0 ? max : null,
    timeoutMs: Number(env('RESUME_TIMEOUT_MS')) || 180_000,
  };
}

/** Explicit engine wins; otherwise the first one on PATH. Tectonic is tried
 *  first because it fetches its own packages, so a fresh machine compiles
 *  without a full TeX distribution installed. */
const ENGINES = ['tectonic', 'pdflatex', 'xelatex', 'lualatex'];

async function findEngine(): Promise<string | null> {
  const forced = env('RESUME_ENGINE');
  if (forced) return forced;
  for (const e of ENGINES) {
    try {
      const { stdout } = await run('which', [e]);
      const hit = String(stdout).trim().split('\n')[0];
      if (hit) return hit;
    } catch {
      // not installed; try the next
    }
  }
  return null;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9+#. ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Word-boundary match over normalised text, so "ROS" does not fire on
 *  "across" and "C" does not fire on everything. */
function mentions(haystack: string, term: string): boolean {
  const t = norm(term);
  if (t.length < 2) return false;
  return new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(haystack);
}

const DEPTH_WEIGHT: Record<string, number> = { mentioned: 0.5, used: 0.8, built: 1 };

export type EvidencePick = {
  target: string;
  kind: 'project' | 'position' | 'education' | 'bullet';
  title: string;
  score: number;
  matched: string[];
};

/** How strongly one posting asks for each claim: 1 when it names the claim or
 *  an alias, a link's weight when it names a neighbour (see `rankEvidence`). */
export function claimWeights(doc: ClaimsDoc, postingText: string): Map<string, number> {
  const text = norm(postingText);
  const weight = new Map<string, number>();
  const bump = (slug: string, w: number) => weight.set(slug, Math.max(weight.get(slug) || 0, w));

  for (const c of doc.claims) {
    if ([c.label, ...c.aliases].some((t) => mentions(text, t))) bump(c.slug, 1);
  }

  const direct = new Set(weight.keys());
  for (const c of doc.claims) {
    for (const l of c.links) {
      if (direct.has(l.to)) bump(c.slug, l.w);
      if (direct.has(c.slug)) bump(l.to, l.w * l.w);
    }
  }
  return weight;
}

/**
 * Scores every project and position against one posting.
 *
 * A claim matched by name scores 1. A claim one link away from a matched claim
 * scores that link's weight — forwards, and `w²` backwards, because the
 * relations are directed: Kafka implies distributed systems far more strongly
 * than distributed systems implies Kafka. One hop only. Two hops on a graph
 * this dense reaches almost everything, and a CV reordered on a third-order
 * association is a CV reordered on noise.
 *
 * Each target then collects `claimWeight · depthWeight` over the claims it
 * evidences, so a posting asking for Kafka promotes the project he *built* on
 * Kafka over the job where he merely used it.
 */
export function rankEvidence(doc: ClaimsDoc, postingText: string): EvidencePick[] {
  const weight = claimWeights(doc, postingText);

  const titleOf = new Map<string, { kind: EvidencePick['kind']; title: string }>();
  for (const p of doc.targets.projects) titleOf.set(`project:${p.id}`, { kind: 'project', title: p.title });
  for (const p of doc.targets.positions) {
    titleOf.set(`position:${p.id}`, { kind: 'position', title: p.title });
    for (const b of p.bullets || []) titleOf.set(`position:${p.id}/${b.id}`, { kind: 'bullet', title: b.match });
  }
  for (const e of doc.targets.educations) titleOf.set(`education:${e.id}`, { kind: 'education', title: e.school });

  const picks = new Map<string, EvidencePick>();
  for (const c of doc.claims) {
    const w = weight.get(c.slug) || 0;
    if (!w) continue;
    for (const e of c.evidence) {
      const gain = w * (DEPTH_WEIGHT[e.depth] ?? 0.5);
      // A bullet's evidence is also evidence about the job it sits in, so it
      // scores in both places: the bullet decides the order inside EXPERIENCE,
      // the position decides how the job ranks against everything else.
      const targets = e.target.includes('/') ? [e.target, e.target.split('/')[0]] : [e.target];
      for (const t of targets) {
        const m = titleOf.get(t);
        if (!m) continue;
        const pick = picks.get(t) || { target: t, ...m, score: 0, matched: [] };
        pick.score += gain;
        if (w >= 0.5 && !pick.matched.includes(c.label)) pick.matched.push(c.label);
        picks.set(t, pick);
      }
    }
  }

  return [...picks.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

/** Skills and languages from claims.yml that a posting names, each with
 *  whether it has evidence behind it. A claim with none is listed on a surface
 *  but unproven, so it is shown as a gap rather than credited. */
export function claimsInPosting(doc: ClaimsDoc, postingText: string): { t: string; ok: boolean }[] {
  const text = norm(postingText);
  return doc.claims
    .filter((c) => (c.kind === 'skill' || c.kind === 'language') && [c.label, ...c.aliases].some((t) => mentions(text, t)))
    .map((c) => ({ t: c.label, ok: c.evidence.some((e) => e.depth !== 'mentioned') }));
}

export type ProjectPick = { role: string; lead: string; then: string };

/** Which claims.yml project leads the CV in each field, and which follows it.
 *  A field no project has evidence for is left out rather than padded. */
export function projectPicks(doc: ClaimsDoc | null): ProjectPick[] {
  if (!doc) return [];
  return FIELD_QUERIES.flatMap(({ field, query }) => {
    const [lead, then] = rankEvidence(doc, query).filter((p) => p.kind === 'project');
    return lead ? [{ role: field, lead: lead.title, then: then?.title || '—' }] : [];
  });
}

/** Job-board search terms: a general one, plus one for each field claims.yml
 *  has a project to lead with. */
export function searchQueries(doc: ClaimsDoc | null): string[] {
  const fields = new Set(projectPicks(doc).map((p) => p.role));
  const extra = FIELD_QUERIES.filter((q) => fields.has(q.field)).map((q) => q.search);
  return [...new Set(['software engineer', ...(extra.length ? extra : ['backend engineer'])])];
}

/** Overlap of significant words, used to tie a CV entry to a claims.yml
 *  project. The two are written by different hands — "ROS 2 Autonomous
 *  Navigation" on the CV against "ROS 2 SLAM navigation robot" in the file — so
 *  an exact title match would never fire. */
const STOP = new Set(['and', 'for', 'the', 'with', 'a', 'of', 'to', 'on', 'in', 'an']);
const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));

function overlap(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

/** Splits an `itemize` body into its top-level `\item` blocks. Brace depth is
 *  tracked so an `\item` inside a nested group is not treated as a new entry. */
function splitItems(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' ) {
      if (depth === 0 && body.startsWith('\\item', i)) {
        if (start >= 0) out.push(body.slice(start, i));
        start = i;
      }
      i++; // whatever follows a backslash is escaped, braces included
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (start >= 0) out.push(body.slice(start));
  return out;
}

const PROJECT_SECTION = /\\begin\{rSection\}\{[^}]*PROJECTS?[^}]*\}([\s\S]*?)\\end\{rSection\}/i;
const ITEMIZE = /([\s\S]*\\begin\{itemize\}[^\n]*\n)([\s\S]*?)(\\end\{itemize\}[\s\S]*)/i;

/**
 * Splits a projects section into the part that must stay put and the run of
 * `\item` blocks that may be reordered.
 *
 * Two shapes are in the wild and both are normal: entries wrapped in an
 * `itemize`, and entries sitting directly inside the section because the CV
 * class defines `\item` itself. Anything before the first entry — a `\vspace`,
 * a comment — is preamble and is preserved exactly where it was.
 */
function splitSection(inner: string): { prefix: string; body: string; suffix: string } | null {
  const wrapped = inner.match(ITEMIZE);
  if (wrapped) return { prefix: wrapped[1], body: wrapped[2], suffix: wrapped[3] };
  const first = inner.indexOf('\\item');
  if (first < 0) return null;
  return { prefix: inner.slice(0, first), body: inner.slice(first), suffix: '' };
}

/** Either a rewritten document, or the honest reason there isn't one. "Could
 *  not be mapped" and "nothing in this posting matches any project" are very
 *  different facts about a CV, and collapsing both into null told the user the
 *  wrong one. */
export type Tailoring = { tex: string; order: string[]; dropped: string[]; added: string[]; notes: string[] } | { why: string };

const headingOf = (raw: string) => raw.match(/\\textbf\{([^}]*)\}/)?.[1]?.trim() || '';

/**
 * Chooses which projects the CV carries for this posting, and in what order.
 *
 * The base CV is a starting point, not the menu. Every project in claims.yml
 * competes for the section's slots: the ones already on the CV, and any other
 * project that has its entry written out as `tex`. A posting about Kafka gets
 * the Kafka project even when the base CV left it out, and the weakest fit
 * makes room for it. With `RESUME_MAX_PROJECTS` unset the section keeps the
 * number of entries the base CV has, so a swap can never push it to a second
 * page.
 *
 * Only ever chooses between entries he wrote. A project with no `tex` that
 * would have earned a place is reported, not drafted — the wording of a CV
 * line is not something to generate behind his back.
 *
 * Refuses rather than guesses whenever the section cannot be mapped
 * confidently: an unrecognised entry, an ambiguous title, fewer than two items.
 * A CV is not a place to find out that a heuristic was 80% right, and the caller
 * falls back to the base PDF, which is always correct if not always optimal.
 */
export function tailorTex(tex: string, doc: ClaimsDoc, ranked: EvidencePick[], maxProjects: number | null): Tailoring {
  const m = tex.match(PROJECT_SECTION);
  if (!m) return { why: 'the CV has no projects section to reorder' };

  const parts = splitSection(m[1]);
  if (!parts) return { why: 'the projects section has no entries' };

  const items = splitItems(parts.body);
  if (items.length < 2) return { why: 'the projects section has fewer than two entries' };

  const scoreOf = new Map(ranked.filter((r) => r.kind === 'project').map((r) => [r.target, r.score]));
  const score = (id: string) => scoreOf.get(`project:${id}`) || 0;

  const mapped = items.map((raw) => {
    const heading = headingOf(raw) || raw.slice(0, 80);
    const matches = doc.targets.projects
      .map((p) => ({ p, o: overlap(heading, p.title) }))
      .filter((x) => x.o >= 0.34)
      .sort((a, b) => b.o - a.o);
    if (!matches.length) return null;
    // Two projects fitting one CV entry equally well means the mapping is a
    // coin flip, and a coin flip decides which project a recruiter reads first.
    if (matches.length > 1 && matches[1].o === matches[0].o) return null;
    const best = matches[0].p;
    // The CV's own heading, not the claims.yml title: this is the name the
    // referrer will see when they open the document, and the message quotes it.
    return { raw, id: best.id, title: heading || best.title, score: score(best.id), onCv: true };
  });

  if (mapped.some((s) => s === null)) return { why: 'a project on the CV could not be matched to claims.yml with confidence' };
  const rows = mapped as { raw: string; id: string; title: string; score: number; onCv: boolean }[];
  if (new Set(rows.map((r) => r.id)).size !== rows.length) {
    return { why: 'two projects on the CV map to the same claims.yml project' };
  }

  // Off-CV projects only compete when the posting actually asks for them; a
  // zero-score stranger replacing a zero-score entry he chose is churn.
  const onCv = new Set(rows.map((r) => r.id));
  const offCv = doc.targets.projects.filter((p) => !onCv.has(p.id) && score(p.id) > 0);
  const extras = offCv
    .filter((p) => p.tex)
    .map((p) => ({ raw: p.tex!.trim(), id: p.id, title: headingOf(p.tex!) || p.title, score: score(p.id), onCv: false }));

  const pool = [...rows, ...extras];
  if (!pool.some((r) => r.score > 0)) {
    // Common and not a failure: the posting's requirements are evidenced by his
    // jobs rather than his side projects, so no reordering of the projects
    // section would serve it better than the order already there.
    return { why: 'no project in claims.yml matches this posting, so the existing selection stands' };
  }

  // Ties go to what is already on the CV, in the order he put it there.
  const sorted = [...pool].sort((a, b) => b.score - a.score || Number(b.onCv) - Number(a.onCv));
  const kept = sorted.slice(0, maxProjects || rows.length);
  const floor = kept[kept.length - 1].score;
  const dropped = rows.filter((r) => !kept.includes(r)).map((r) => r.title);
  const added = kept.filter((r) => !r.onCv).map((r) => r.title);

  // The hint that turns a missed swap into a one-time fix in claims.yml.
  const notes = offCv
    .filter((p) => !p.tex && score(p.id) > floor)
    .map((p) => `${p.title} fits this posting better than what made the cut, but has no tex in claims.yml to put on the CV`);

  const unchanged = kept.length === rows.length && kept.every((r, i) => r.raw === rows[i].raw);
  if (unchanged) return { tex, order: kept.map((r) => r.title), dropped, added, notes };

  // Entries are re-emitted with one blank line between them, matching how they
  // were written; nothing outside the run of `\item` blocks is touched.
  const body = kept.map((r) => r.raw.replace(/\s+$/, '') + '\n\n').join('');
  const inner = parts.prefix + body + parts.suffix;
  return {
    tex: tex.slice(0, m.index!) + m[0].replace(m[1], () => inner) + tex.slice(m.index! + m[0].length),
    order: kept.map((r) => r.title),
    dropped,
    added,
    notes,
  };
}

const EXPERIENCE_SECTION = /\\begin\{rSection\}\{[^}]*EXPERIENCE[^}]*\}([\s\S]*?)\\end\{rSection\}/i;
const ITEMIZE_BLOCK = /(\\begin\{itemize\}[^\n]*\n)([\s\S]*?)(\\end\{itemize\})/gi;

/**
 * Reorders the bullets inside each job of the EXPERIENCE section.
 *
 * Which bullet leads matters more than which project does: a recruiter reads
 * the current role first and often stops there. For a Kafka posting the Java
 * and Spring Boot bullet should be the first line under Goldman Sachs, even
 * though the projects section has nothing to say about Kafka at all — which is
 * exactly the case that came back untailored before bullets existed.
 *
 * Each `itemize` inside the section is matched against the declared bullets by
 * their `match` phrase. A block is only rewritten when *every* item maps, all
 * of them to the same position, and no phrase matches two items. Anything else
 * leaves that block alone: a half-mapped block reordered on the mapped half
 * would move real bullets on the strength of a guess.
 */
export function tailorExperience(tex: string, doc: ClaimsDoc, ranked: EvidencePick[]): Tailoring {
  const m = tex.match(EXPERIENCE_SECTION);
  if (!m) return { why: 'the CV has no experience section' };

  const score = new Map(ranked.map((r) => [r.target, r.score]));
  let section = m[1];
  const order: string[] = [];
  let changed = false;

  section = section.replace(ITEMIZE_BLOCK, (whole, open: string, body: string, close: string) => {
    const items = splitItems(body);
    if (items.length < 2) return whole;

    const rows = items.map((raw) => {
      const text = norm(raw);
      const hits = doc.targets.positions.flatMap((p) =>
        (p.bullets || []).filter((b) => text.includes(norm(b.match))).map((b) => ({ p, b })),
      );
      return hits.length === 1 ? { raw, pos: hits[0].p.id, id: hits[0].b.id, label: hits[0].b.match } : null;
    });
    if (rows.some((r) => r === null)) return whole;

    const mapped = rows as { raw: string; pos: string; id: string; label: string }[];
    if (new Set(mapped.map((r) => r.pos)).size !== 1) return whole;
    // One phrase matching two items means the mapping is arbitrary.
    if (new Set(mapped.map((r) => r.id)).size !== mapped.length) return whole;

    const scored = mapped.map((r) => ({ ...r, s: score.get(`position:${r.pos}/${r.id}`) || 0 }));
    if (!scored.some((r) => r.s > 0)) return whole;

    // Stable by construction: equal scores keep the order he wrote them in.
    const sorted = [...scored].sort((a, b) => b.s - a.s);
    if (sorted.every((r, i) => r.raw === scored[i].raw)) {
      if (!order.length) order.push(...sorted.map((r) => r.label));
      return whole;
    }
    changed = true;
    if (!order.length) order.push(...sorted.map((r) => r.label));
    return open + sorted.map((r) => r.raw.replace(/\s+$/, '') + '\n').join('  ') + close;
  });

  if (!changed) return { why: 'no experience bullet outranks the order already on the CV for this posting' };
  return { tex: tex.slice(0, m.index!) + m[0].replace(m[1], () => section) + tex.slice(m.index! + m[0].length), order, dropped: [], added: [], notes: [] };
}

const SKILLS_SECTION = /\\begin\{rSection\}\{[^}]*SKILL[^}]*\}([\s\S]*?)\\end\{rSection\}/i;

/** LaTeX to the words a reader sees: `C\#` is C#, `\textbf{Go}` is Go. */
const plain = (s: string) =>
  s.replace(/\\([#&%$_{}])/g, '$1').replace(/\\[a-zA-Z]+\*?/g, ' ').replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim();
const latex = (s: string) => s.replace(/([#&%$_{}])/g, '\\$1');

/** Index of `ch` at brace depth 0, skipping escapes, or -1. */
function topLevel(s: string, ch: string, from = 0): number {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    else if (s[i] === ch && depth === 0) return i;
  }
  return -1;
}

function splitTop(s: string, ch: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = topLevel(s, ch); i >= 0; i = topLevel(s, ch, from)) {
    out.push(s.slice(from, i));
    from = i + 1;
  }
  out.push(s.slice(from));
  return out;
}

const depthOf = (s: string) => {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') d++;
    else if (s[i] === '}') d--;
  }
  return d;
};

type SkillLine = { prefix: string; items: string[]; suffix: string; category: string; sep: string };

/**
 * One line of a skills section as `category · items · rest`. The three shapes
 * CV templates use are all handled: a tabular row (`Languages & C++, Go \\`),
 * a bold label (`\textbf{Languages:} C++, Go \\`), and the label-then-group
 * form (`\textbf{Languages}{: C++, Go}`). Anything else is left alone.
 */
function parseSkillLine(line: string): SkillLine | null {
  if (!line.trim() || /^\s*(%|\\begin|\\end|\\hline|\\item\s*$)/.test(line)) return null;
  let start = -1;
  const amp = topLevel(line, '&');
  const bold = line.match(/^\s*(?:\\item\s*)?\\textbf\{[^}]*\}\s*(?:\{\s*:?|:)?/);
  if (amp >= 0) start = amp + 1;
  else if (bold) start = bold[0].length;
  else if (line.indexOf(':') >= 0) start = line.indexOf(':') + 1;
  if (start < 0) return null;

  const rest = line.slice(start);
  const lead = rest.match(/^\s*/)![0];
  const stop = rest.indexOf('\\\\');
  let body = rest.slice(lead.length, stop < 0 ? rest.length : stop);
  let tail = stop < 0 ? '' : rest.slice(stop);
  // A closing brace the list never opened belongs to the label's group.
  while (depthOf(body) < 0 || /\s$/.test(body)) {
    tail = body.slice(-1) + tail;
    body = body.slice(0, -1);
  }
  const items = splitTop(body, ',').map((x) => x.trim()).filter(Boolean);
  if (items.length < 2) return null;
  return {
    prefix: line.slice(0, start) + lead,
    items,
    suffix: tail,
    category: plain(line.slice(0, start)).replace(/[:&]/g, '').trim(),
    sep: body.includes(', ') ? ', ' : ',',
  };
}

/**
 * Chooses which skills the CV lists for this posting, and in what order.
 *
 * Inside each line of the skills section, the skills this posting asks for move
 * to the front. A skill claims.yml has real evidence for (`used` or `built`)
 * that the posting names outright, but the base CV does not list, takes the
 * place of the line's least relevant entry — so the line stays the length he
 * set it to, and the page does not reflow onto a second one. It joins the line
 * whose skills it is linked to in the claim graph, and a language only ever
 * joins a line labelled for languages; with no such line it is reported, not
 * guessed into place.
 */
export function tailorSkills(tex: string, doc: ClaimsDoc, weights: Map<string, number>): Tailoring {
  const m = tex.match(SKILLS_SECTION);
  if (!m) return { why: 'the CV has no skills section' };

  const skillClaims = doc.claims.filter((c) => c.kind === 'skill' || c.kind === 'language');
  const strength = (c: Claim) => Math.max(0, ...c.evidence.map((e) => DEPTH_WEIGHT[e.depth] ?? 0.5));
  const claimFor = (item: string): Claim | null => {
    const t = norm(plain(item));
    const terms = (c: Claim) => [c.label, ...c.aliases];
    return (
      skillClaims.find((c) => terms(c).some((x) => norm(x) === t)) ||
      skillClaims.find((c) => terms(c).some((x) => mentions(t, x))) ||
      null
    );
  };
  // On the CV already, so reordering it is safe even without evidence; it just
  // never outranks a skill that has some.
  const scoreOf = (c: Claim | null) => (c ? (weights.get(c.slug) || 0) * Math.max(strength(c), 0.5) : 0);

  const lines = m[1].split('\n');
  const parsed = lines.map(parseSkillLine);
  const rows = parsed.map((l) =>
    l ? l.items.map((raw) => { const c = claimFor(raw); return { raw, label: plain(raw), slug: c?.slug || null, score: scoreOf(c), added: false }; }) : null,
  );
  if (!rows.some(Boolean)) return { why: 'the skills section has no comma-separated lists to choose from' };

  const listed = norm(plain(m[1]));
  const missing = skillClaims
    .filter((c) => weights.get(c.slug) === 1 && c.evidence.some((e) => e.depth !== 'mentioned'))
    .filter((c) => ![c.label, ...c.aliases].some((t) => mentions(listed, t)))
    .sort((a, b) => scoreOf(b) - scoreOf(a));

  const added: string[] = [];
  const dropped: string[] = [];
  const notes: string[] = [];
  const hasLanguages = parsed.some((p) => p && /language/i.test(p.category));
  for (const c of missing) {
    const near = new Set([...c.links.map((l) => l.to), ...doc.claims.filter((o) => o.links.some((l) => l.to === c.slug)).map((o) => o.slug)]);
    let best = -1;
    let bestFit = 0;
    const eligible = rows.flatMap((row, i) => {
      if (!row) return [];
      const isLanguages = /language/i.test(parsed[i]!.category);
      return hasLanguages && isLanguages !== (c.kind === 'language') ? [] : [i];
    });
    for (const i of eligible) {
      const fit = rows[i]!.filter((r) => r.slug && near.has(r.slug)).length + (/language/i.test(parsed[i]!.category) ? 1 : 0);
      if (fit > bestFit) { best = i; bestFit = fit; }
    }
    // Nothing related on any line, but only one line it could go on.
    if (best < 0 && eligible.length === 1) best = eligible[0];
    const row = best >= 0 ? rows[best]! : null;
    // What makes room is the entry this posting needs least and claims.yml
    // backs least — a skill with no evidence before one he built with — and,
    // among equals, the last: the one he put at the end he valued least.
    const backing = (r: { slug: string | null }) => { const o = r.slug && skillClaims.find((x) => x.slug === r.slug); return o ? strength(o) : -1; };
    const victim = row
      ?.map((r, j) => ({ r, j }))
      .filter(({ r }) => r.score === 0 && !r.added)
      .sort((a, b) => backing(a.r) - backing(b.r) || b.j - a.j)[0]?.r;
    if (!row || !victim) {
      notes.push(`${c.label} is asked for and evidenced, but no line of the skills section ${row ? 'has room' : 'fits it'}`);
      continue;
    }
    row[row.indexOf(victim)] = { raw: latex(c.label), label: c.label, slug: c.slug, score: scoreOf(c), added: true };
    added.push(c.label);
    dropped.push(victim.label);
  }

  let changed = added.length > 0;
  const order: string[] = [];
  const out = lines.map((line, i) => {
    const row = rows[i];
    if (!row) return line;
    // Stable: equal scores keep the order he wrote them in.
    const sorted = [...row].sort((a, b) => b.score - a.score);
    order.push(...sorted.filter((r) => r.score > 0).map((r) => r.label));
    if (sorted.every((r, j) => r === row[j]) && !row.some((r) => r.added)) return line;
    changed = true;
    const p = parsed[i]!;
    return p.prefix + sorted.map((r) => r.raw).join(p.sep) + p.suffix;
  });

  if (!changed) return { why: notes[0] || 'no skill on the CV outranks the order already there for this posting' };
  const section = out.join('\n');
  return {
    tex: tex.slice(0, m.index!) + m[0].replace(m[1], () => section) + tex.slice(m.index! + m[0].length),
    order,
    dropped,
    added,
    notes,
  };
}

async function compile(source: string, texPath: string, outPdf: string, engine: string, timeoutMs: number) {
  // The document is compiled beside copies of its own class file and assets,
  // because a CV class lives next to the .tex rather than in a TeX tree.
  const work = join(tmpdir(), `waypoint-cv-${createHash('sha1').update(outPdf).digest('hex').slice(0, 12)}`);
  mkdirSync(work, { recursive: true });
  const srcDir = dirname(texPath);
  for (const f of readdirSync(srcDir)) {
    if (/\.(cls|sty|bst|png|jpg|jpeg|pdf|eps|ttf|otf)$/i.test(f)) {
      try { copyFileSync(join(srcDir, f), join(work, f)); } catch { /* unreadable asset, let LaTeX complain */ }
    }
  }
  const name = 'tailored';
  writeFileSync(join(work, `${name}.tex`), source);

  const isTectonic = /tectonic/.test(engine);
  const args = isTectonic
    ? ['-X', 'compile', '--outdir', work, '--keep-logs', `${name}.tex`]
    : ['-interaction=nonstopmode', '-halt-on-error', `-output-directory=${work}`, `${name}.tex`];

  // pdflatex needs a second pass for its own cross-references; tectonic loops
  // internally and does not.
  const passes = isTectonic ? 1 : 2;
  for (let i = 0; i < passes; i++) await run(engine, args, { cwd: work, timeout: timeoutMs });

  const built = join(work, `${name}.pdf`);
  if (!existsSync(built)) throw new Error('the engine produced no PDF');
  mkdirSync(dirname(outPdf), { recursive: true });
  copyFileSync(built, outPdf);
}

export type BuiltResume = {
  path: string;
  tailored: boolean;
  lead: string | null;
  order: string[];
  /** The reordered bullets of the lead job, most relevant first. */
  experience: string[];
  /** Projects not on the base CV that this posting earned a place for. */
  added: string[];
  dropped: string[];
  /** Skills swapped onto the CV for this posting, and what made room. */
  skillsAdded: string[];
  skillsDropped: string[];
  matched: string[];
  /** Transforms that did not apply, and why. Not failures — a posting that
   *  matches his jobs but none of his projects legitimately leaves the projects
   *  section alone. */
  skipped: string[];
  publicUrl: string | null;
  /** Why it is not tailored, when it is not. Shown to the user rather than
   *  swallowed, because a silently untailored CV looks identical to a tailored
   *  one until a recruiter reads it. */
  reason: string | null;
};

/**
 * The CV to send for one posting. Never throws: every failure downgrades to the
 * base PDF with a reason attached, because a missing LaTeX package must not
 * take down the referral flow.
 */
export async function buildResume(doc: ClaimsDoc | null, postingText: string, key: string): Promise<BuiltResume | null> {
  const cfg = resumeConfig();
  if (!cfg.pdf && !cfg.tex) return null;

  const base: BuiltResume = {
    path: cfg.pdf || '',
    tailored: false,
    lead: null,
    order: [],
    experience: [],
    added: [],
    dropped: [],
    skillsAdded: [],
    skillsDropped: [],
    matched: [],
    skipped: [],
    publicUrl: cfg.publicUrl,
    reason: null,
  };

  const bail = (reason: string, skipped: string[] = []) =>
    cfg.pdf && existsSync(cfg.pdf) ? { ...base, reason, skipped } : null;

  if (!doc) return bail('no claims.yml, so there is nothing to choose between');
  if (!cfg.tex) return bail('RESUME_TEX is not set, so there is no source to rewrite');
  if (!existsSync(cfg.tex)) return bail(`RESUME_TEX points at ${cfg.tex}, which does not exist`);

  const weights = claimWeights(doc, postingText);
  const ranked = rankEvidence(doc, postingText);

  // The template on disk is never written to. Every transform is a pure string
  // rewrite over a copy, and the build happens in a scratch directory — the
  // CV he maintains by hand stays exactly as he left it.
  const template = readFileSync(cfg.tex, 'utf8');

  const skipped: string[] = [];
  /** Runs one transform over the document so far, recording why it did not
   *  apply. A transform that ran and produced the same document is a different
   *  fact from one that refused to run, and the difference is the useful half:
   *  it means the CV already carried the right thing for this posting. */
  const step = (name: string, input: string, t: Tailoring): string => {
    if ('why' in t) { skipped.push(`${name}: ${t.why}`); return input; }
    skipped.push(...t.notes.map((n) => `${name}: ${n}`));
    if (t.tex === input) skipped.push(`${name}: already the best selection for this posting`);
    return t.tex;
  };

  const projects = tailorTex(template, doc, ranked, cfg.maxProjects);
  const afterProjects = step('projects', template, projects);
  const experience = tailorExperience(afterProjects, doc, ranked);
  const afterExperience = step('experience', afterProjects, experience);
  const skills = tailorSkills(afterExperience, doc, weights);
  const source = step('skills', afterExperience, skills);

  if (source === template) return bail('the CV already leads with the most relevant work for this posting', skipped);

  const engine = await findEngine();
  if (!engine) return bail('no LaTeX engine found — install tectonic, or set RESUME_ENGINE');

  // Keyed on the rendered source, so two postings that select the same order
  // share one PDF and an unchanged CV is never rebuilt.
  const hash = createHash('sha1').update(source).update(engine).digest('hex').slice(0, 16);
  const out = join(cfg.outDir, `${key}-${hash}.pdf`);

  const order = 'why' in projects ? [] : projects.order;
  const bullets = 'why' in experience ? [] : experience.order;
  const matched = ranked.filter((r) => r.score > 0).flatMap((r) => r.matched);
  const result: BuiltResume = {
    ...base,
    path: out,
    tailored: true,
    lead: order[0] || bullets[0] || null,
    order,
    experience: bullets,
    added: 'why' in projects ? [] : projects.added,
    dropped: 'why' in projects ? [] : projects.dropped,
    skillsAdded: 'why' in skills ? [] : skills.added,
    skillsDropped: 'why' in skills ? [] : skills.dropped,
    matched: [...new Set(matched)],
    skipped,
  };

  if (existsSync(out) && statSync(out).size > 0) return result;

  try {
    await compile(source, cfg.tex, out, engine, cfg.timeoutMs);
    return result;
  } catch (e) {
    return bail(`the CV did not compile: ${(e as Error).message.split('\n')[0]}`, skipped);
  }
}

/**
 * The clause the referral message uses to offer the CV.
 *
 * Only ever claims what is true. A link is offered when one exists that a
 * recruiter could open — a localhost path is not one — and the CV is described
 * as led by a project only when it actually was reordered to lead with it.
 * Saying "tailored to this role" over the untouched base PDF is the kind of
 * small lie a referrer notices when they open it.
 */
export function resumeOffer(r: BuiltResume | null): string {
  if (!r?.publicUrl) return 'happy to send my CV';
  if (r.tailored && r.lead) return `my CV is at ${r.publicUrl} — it leads with ${r.lead}, which is the closest fit here`;
  return `my CV is at ${r.publicUrl}`;
}

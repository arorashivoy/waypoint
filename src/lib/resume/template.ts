import { join } from 'node:path';
import type { Claim, ClaimsDoc } from '../claims';
import { profileVersion } from '../profile/store';
import { userDir } from '../user-files';
import type { EvidencePick, Steer } from '../resume';
import { DEPTH_WEIGHT } from './depth';
import type { Written } from './written';

/**
 * The built-in résumé template (spec 6.5).
 *
 * Every value that comes from the profile goes through `escapeLatex`. The
 * fixed text of the template is the only text that can hold a macro. So no
 * value can open a macro, read a file or change the layout.
 */

/** What a résumé shows: project IDs, `position/bullet` IDs and skill slugs, each in the order it prints. */
export type Order = { projects: string[]; bullets: string[]; skills: string[] };

export const DEFAULT_PROJECTS = 4;
export const MAX_SKILLS = 20;

const SPECIAL: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '%': '\\%',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
  '|': '\\textbar{}',
  // A "[" after \item would start an optional argument. A group stops that.
  '[': '{[}',
  ']': '{]}',
};

/** The code points that T1 with utf8 cannot print, although they are in the Latin range. Each has a plain form. */
const PLAIN: Record<string, string> = { 'Ħ': 'H', 'ħ': 'h', 'ĸ': 'k', 'Ŀ': 'L', 'ŀ': 'l', 'ŉ': 'n', 'Ŧ': 'T', 'ŧ': 't', 'ſ': 's' };

/** The characters that pdflatex prints with the T1 font and the utf8 input: ASCII, Latin-1 and Latin Extended-A (a real compile checks all of them), and common punctuation. */
const SAFE = /^[\x20-\x7e\u00a0-\u017f\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]$/;

/** A character the fonts cannot print becomes a safe form: the table, then the letter without its marks. Otherwise it goes. */
function printable(ch: string): string {
  if (SAFE.test(ch) && !(ch in PLAIN)) return ch;
  if (ch in PLAIN) return PLAIN[ch];
  const folded = ch.normalize('NFKD').replace(/\p{M}/gu, '');
  return folded && [...folded].every((c) => SAFE.test(c) && !(c in PLAIN)) ? folded : '';
}

/**
 * Makes a value safe to put in LaTeX text. A white space run becomes one space, so a newline
 * cannot start a new paragraph. A control character and a character that the fonts cannot
 * print are replaced or removed. Each LaTeX special character becomes its text form.
 */
export function escapeLatex(text: string): string {
  return [...String(text ?? '').replace(/\s+/g, ' ')]
    .map(printable)
    .join('')
    .replace(/[\\{}$&#%_^~<>|[\]]/g, (c) => SPECIAL[c])
    .trim();
}

const e = escapeLatex;

/** The folder that holds `resume.cls`. A compile copies this class file into its work folder. */
export const templateAssetsDir = () => join(process.cwd(), 'templates', 'resume', 'classic');

/** The base résumé of the current profile version. The file name changes with each profile save. */
export async function baseResumePath(userId: string): Promise<string> {
  return join(userDir(userId, 'resumes'), `base-${await profileVersion(userId)}.pdf`);
}

export const hasResumeContent = (doc: ClaimsDoc | null | undefined): doc is ClaimsDoc =>
  !!doc && (doc.targets.positions.length > 0 || doc.targets.projects.length > 0);

const strength = (c: Claim) => c.evidence.reduce((sum, ev) => sum + (DEPTH_WEIGHT[ev.depth] ?? 0.5), 0);
const isSkill = (c: Claim) => c.kind === 'skill' || c.kind === 'language';

/**
 * The best projects, with no posting to read. A project scores the weight of each claim that has
 * evidence for it (the deepest evidence of the claim counts). The newest `since` date of that
 * evidence breaks a tie, then the title.
 */
export function bestProjects(doc: ClaimsDoc, n = DEFAULT_PROJECTS): string[] {
  const rows = doc.targets.projects.map((p) => {
    let score = 0;
    let newest = '';
    for (const c of doc.claims) {
      const hits = c.evidence.filter((ev) => ev.target === `project:${p.id}`);
      if (!hits.length) continue;
      score += Math.max(...hits.map((ev) => DEPTH_WEIGHT[ev.depth] ?? 0.5));
      for (const ev of hits) if (ev.since && ev.since > newest) newest = ev.since;
    }
    return { id: p.id, title: p.title, score, newest };
  });
  rows.sort((a, b) => b.score - a.score || b.newest.localeCompare(a.newest) || a.title.localeCompare(b.title));
  return rows.slice(0, n).map((r) => r.id);
}

/** The skills that have the most evidence, first. */
function skillsByEvidence(doc: ClaimsDoc): Claim[] {
  return doc.claims.filter(isSkill).sort((a, b) => strength(b) - strength(a) || a.label.localeCompare(b.label));
}

/** The base résumé: the best projects, every position with its bullets, and the best skills. */
export function baseOrder(doc: ClaimsDoc): Order {
  return {
    projects: bestProjects(doc),
    bullets: doc.targets.positions.flatMap((p) => (p.bullets ?? []).map((b) => `${p.id}/${b.id}`)),
    skills: skillsByEvidence(doc).slice(0, MAX_SKILLS).map((c) => c.slug),
  };
}

/**
 * The order for one posting. The ranking of the posting (and of a refinement) picks the projects and
 * the order of the bullets inside each position. The best projects fill the places that the ranking leaves.
 * A refinement that lists projects sets the count too.
 */
export function tailorOrder(doc: ClaimsDoc, ranked: EvidencePick[], weights: Map<string, number>, steer: Steer, maxProjects: number | null): Order {
  const known = new Set(doc.targets.projects.map((p) => p.id));
  const count = steer.projects?.length || maxProjects || DEFAULT_PROJECTS;
  const picked = ranked
    .filter((r) => r.kind === 'project' && r.score > 0)
    .map((r) => r.target.slice('project:'.length))
    .filter((id) => known.has(id));
  const projects = [...new Set([...picked, ...bestProjects(doc, known.size)])].slice(0, count);

  const score = new Map(ranked.filter((r) => r.kind === 'bullet').map((r) => [r.target, r.score]));
  const bullets = doc.targets.positions.flatMap((p) =>
    (p.bullets ?? [])
      .map((b, i) => ({ id: `${p.id}/${b.id}`, s: score.get(`position:${p.id}/${b.id}`) || 0, i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.id),
  );

  const steered = new Map((steer.skills ?? []).map((slug, i) => [slug, i]));
  const skills = doc.claims
    .filter(isSkill)
    .sort(
      (a, b) =>
        (steered.get(a.slug) ?? Infinity) - (steered.get(b.slug) ?? Infinity) ||
        (weights.get(b.slug) || 0) - (weights.get(a.slug) || 0) ||
        strength(b) - strength(a) ||
        a.label.localeCompare(b.label),
    )
    .slice(0, MAX_SKILLS)
    .map((c) => c.slug);
  return { projects, bullets, skills };
}

const section = (title: string, body: string[]) => (body.length ? [`\\begin{rSection}{${title}}`, ...body, '\\end{rSection}', ''] : []);

/**
 * A full .tex for `resume.cls`. It shows only the IDs of `order`, in that order. An ID that the
 * profile does not have is left out. The steer is already part of `order`, except `wording`: the text
 * of an accepted suggestion replaces the text of its bullet.
 */
export function renderTemplate(doc: ClaimsDoc, steer: Steer, order: Order, written?: Written): string {
  const picked = new Map<string, string[]>();
  for (const id of order.bullets) {
    const [pos, bullet] = id.split('/');
    picked.set(pos, [...(picked.get(pos) ?? []), bullet]);
  }

  const experience = doc.targets.positions.flatMap((p) => {
    const lines = (picked.get(p.id) ?? [])
      .map((id) => steer.wording?.[`${p.id}/${id}`] ?? (p.bullets ?? []).find((b) => b.id === id)?.text)
      .filter((t): t is string => !!t?.trim());
    const dates = `${e(p.start)} -- ${e(p.end || 'Present')}`;
    if (!lines.length) {
      return [
        `{\\bf ${e(p.company)}} \\hfill ${dates} \\\\`,
        `{\\em ${e(p.title)}} \\hfill {\\em ${e(p.location ?? '')}}`,
        ...(p.summary?.trim() ? [`\\par ${e(p.summary)}`] : []),
        '\\par\\medskip',
        '',
      ];
    }
    return [
      `\\begin{rSubsection}{${e(p.company)}}{${dates}}{${e(p.title)}}{${e(p.location ?? '')}}`,
      ...lines.map((t) => `\\item ${e(t)}`),
      '\\end{rSubsection}',
      '',
    ];
  });

  const projects = order.projects.flatMap((id) => {
    const p = doc.targets.projects.find((x) => x.id === id);
    if (!p) return [];
    // Written lines (checked against their sources) take the place of the description and the bullets.
    const w = written?.projects[id];
    const bullets = w ? [] : (p.bullets ?? []).filter((b) => b.trim());
    const text = w ? w.lines.join(' ') : p.description;
    return [
      `{\\bf ${e(w?.heading || p.title)}}${p.org?.trim() ? ` \\hfill {\\em ${e(p.org)}}` : ''}`,
      ...(text?.trim() ? [`\\par ${e(text)}`] : []),
      ...(bullets.length ? ['\\begin{itemize}\\itemsep 0pt \\topsep 0pt', ...bullets.map((b) => `\\item ${e(b)}`), '\\end{itemize}'] : []),
      '\\par\\smallskip',
      '',
    ];
  });

  const claims = order.skills.flatMap((slug) => doc.claims.filter((c) => c.slug === slug && isSkill(c)));
  const line = (label: string, list: Claim[]) => (list.length ? [`{\\bf ${label}:} ${list.map((c) => e(c.label)).join(', ')} \\\\`] : []);
  const skills = [...line('Languages', claims.filter((c) => c.kind === 'language')), ...line('Skills', claims.filter((c) => c.kind === 'skill'))];

  const education = doc.targets.educations.flatMap((ed) => {
    const what = [ed.degree, ed.field].filter((x): x is string => !!x?.trim()).map(e).join(', ');
    return [`{\\bf ${e(ed.school)}} \\hfill ${e(ed.years ?? '')}`, ...(what ? [`\\par {\\em ${what}}`] : []), '\\par\\smallskip', ''];
  });

  return [
    '\\documentclass{resume}',
    '\\usepackage[T1]{fontenc}',
    // A scalable T1 font. Without it, pdflatex embeds bitmap fonts and the PDF text loses fi, ff and fl.
    '\\usepackage{lmodern}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[left=0.5in, top=0.4in, right=0.5in, bottom=0.4in]{geometry}',
    '\\def\\sectionlineskip{\\smallskip}',
    '\\def\\nameskip{\\smallskip}',
    '\\def\\sectionskip{\\smallskip}',
    '\\setlength{\\parskip}{0.2em}',
    `\\name{${e(doc.profile.name)}}`,
    ...(doc.profile.headline.trim() ? [`\\address{${e(doc.profile.headline)}}`] : []),
    '\\begin{document}',
    '\\small',
    '',
    ...section('EXPERIENCE', experience),
    ...section('PROJECTS', projects),
    ...section('SKILLS', skills),
    ...section('EDUCATION', education),
    '\\end{document}',
    '',
  ].join('\n');
}

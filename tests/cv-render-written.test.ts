import { describe, expect, it } from 'vitest';
import type { ClaimsDoc } from '@/lib/claims';
import { projectShape, renderEntry, tailorTex, wordingFor, type EvidencePick } from '@/lib/resume';
import { renderTemplate } from '@/lib/resume/template';
import type { Written } from '@/lib/resume/written';

const TEX = String.raw`\documentclass{resume}
\begin{document}
\begin{rSection}{PROJECTS}
\vspace{-1.25em}

\item \textbf{Bish, a Linux Shell in C} --- C, Linux \hfill 2022 \\
      Interactive Linux shell built on forks and threads.
      \href{https://github.com/arorashivoy/Bish}{github.com/arorashivoy/Bish}

\item \textbf{StrikeOut}, iOS task manager --- SwiftUI \hfill 2022 \\
      Shipped to the App Store.

\end{rSection}
\end{document}
`;

const doc: ClaimsDoc = {
  version: 2,
  profile: { name: 'Test Person', headline: 'Engineer' },
  targets: {
    positions: [],
    projects: [
      { id: 'bish', title: 'Bish, a Linux shell in C', description: 'Interactive Linux shell built on forks and threads.' },
      { id: 'strikeout', title: 'StrikeOut iOS task manager', description: 'Shipped to the App Store.' },
      { id: 'claude-skills', title: 'Claude Code engineering skills', description: 'Wrote Claude Code skills that capture release test evidence.' },
    ],
    educations: [],
  },
  claims: [],
};

const pick = (id: string, score: number): EvidencePick => ({ target: `project:${id}`, kind: 'project', title: id, score, matched: [] });
const none: Written = { bullets: {}, projects: {}, dropped: [] };
const items = (tex: string) => (tex.match(/\\item\b/g) ?? []).length;

describe('the shape of a project entry', () => {
  it('reads the shape of the first project entry', () => {
    expect(projectShape(TEX)).toMatchObject({ tech: true, year: true });
  });

  it('falls back to a plain shape when the first entry has no bold heading', () => {
    const tex = TEX.replace(String.raw`\item \textbf{Bish, a Linux Shell in C} --- C, Linux \hfill 2022 \\`, String.raw`\item {\bf Bish} shell \\`);
    expect(projectShape(tex)).toMatchObject({ tech: false, year: false });
  });

  it('escapes every value', () => {
    const out = renderEntry(projectShape(TEX), { heading: 'a $x$ \\input{/etc/passwd} 100%', tech: 'C#', year: '2026', body: 'Uses 50% & more_stuff' });
    expect(out).toContain('\\$x\\$');
    expect(out).toContain('\\textbackslash{}input');
    expect(out).not.toContain('\\input{');
    expect(out).toContain('100\\%');
    expect(out).toContain('C\\#');
    expect(out).toContain('50\\% \\& more\\_stuff');
    expect(out).toMatch(/^\\item \\textbf\{.*\} --- C\\# \\hfill 2026 \\\\\n {6}Uses/);
  });
});

describe('tailorTex with written lines', () => {
  it('puts a project with no tex on an own .tex CV, and keeps the number of entries', () => {
    const t = tailorTex(TEX, doc, [pick('claude-skills', 3), pick('bish', 1)], null, none);
    if ('why' in t) throw new Error(t.why);
    expect(t.tex).toContain('\\textbf{Claude Code engineering skills}');
    expect(t.tex).toContain('Wrote Claude Code skills that capture release test evidence.');
    expect(t.tex).not.toContain('StrikeOut');
    expect(items(t.tex)).toBe(2);
    expect(t.added).toEqual(['Claude Code engineering skills']);
  });

  it('replaces an on-CV entry with its written form', () => {
    const w: Written = { ...none, projects: { bish: { heading: 'Bish, a Linux shell in C', tech: 'C', year: '2022', lines: ['Linux shell built on forks and threads.'], old: '', sources: [] } } };
    const t = tailorTex(TEX, doc, [pick('bish', 1)], null, w);
    if ('why' in t) throw new Error(t.why);
    expect(t.tex).toContain('Linux shell built on forks and threads.');
    expect(t.tex).not.toContain('Interactive Linux shell');
    expect(items(t.tex)).toBe(2);
  });

  it('keeps the year, the tools and the links of his own entry when the written form has none', () => {
    const w: Written = { ...none, projects: { bish: { heading: 'Bish, a Linux shell in C', tech: '', year: '', lines: ['Linux shell built on forks and threads.'], old: '', sources: [] } } };
    const t = tailorTex(TEX, doc, [pick('bish', 1)], null, w);
    if ('why' in t) throw new Error(t.why);
    expect(t.tex).toContain('\\textbf{Bish, a Linux shell in C} --- C, Linux \\hfill 2022 \\\\');
    expect(t.tex).toContain('\\href{https://github.com/arorashivoy/Bish}{github.com/arorashivoy/Bish}');
  });

  it('rewrites an on-CV entry also when no project matches the posting', () => {
    const w: Written = { ...none, projects: { bish: { heading: 'Bish', tech: '', year: '', lines: ['Linux shell built on forks and threads.'], old: '', sources: [] } } };
    const t = tailorTex(TEX, doc, [], null, w);
    if ('why' in t) throw new Error(t.why);
    expect(t.tex).toContain('Linux shell built on forks and threads.');
  });

  it('keeps the entry as written when there is no written form', () => {
    const t = tailorTex(TEX, doc, [pick('bish', 2), pick('strikeout', 1)], null, none);
    if ('why' in t) throw new Error(t.why);
    expect(t.tex).toBe(TEX);
  });
});

describe('the template with written lines', () => {
  it('prints the written heading and lines', () => {
    const w: Written = { ...none, projects: { 'claude-skills': { heading: 'Claude Code skills', tech: '', year: '', lines: ['Wrote skills that capture release test evidence.'], old: '', sources: [] } } };
    const out = renderTemplate(doc, {}, { projects: ['claude-skills'], bullets: [], skills: [] }, w);
    expect(out).toContain('{\\bf Claude Code skills}');
    expect(out).toContain('Wrote skills that capture release test evidence.');
    expect(out).not.toContain('Claude Code engineering skills');
  });
});

describe('wordingFor', () => {
  it('lets an accepted suggestion win over a written bullet', () => {
    const w: Written = { ...none, bullets: { 'a/b': { text: 'written', old: 'old', sources: [] }, 'a/c': { text: 'written c', old: 'old', sources: [] } } };
    expect(wordingFor(w, { 'a/b': 'accepted' })).toEqual({ 'a/b': 'accepted', 'a/c': 'written c' });
  });
});

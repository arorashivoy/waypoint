import { describe, expect, it } from 'vitest';
import type { ClaimsDoc } from '@/lib/claims';
import { hrefOf, tailorTex, type EvidencePick } from '@/lib/resume';
import { checkWritten, effectiveWritten } from '@/lib/resume/written';

const TEX = [
  '\\begin{rSection}{PROJECTS}',
  '\\begin{itemize}',
  '\\item \\textbf{Fast parser} --- C \\hfill 2024 \\\\',
  '      text one',
  '',
  '\\item \\textbf{Ledger service} --- Java \\hfill 2023 \\\\',
  '      text two',
  '\\end{itemize}',
  '\\end{rSection}',
].join('\n');

const doc = {
  version: 1,
  profile: { name: 'N', headline: '' },
  targets: {
    projects: [
      { id: 'parser', title: 'Fast parser' },
      { id: 'ledger', title: 'Ledger service' },
      { id: 'strikeout', title: 'StrikeOut', url: 'https://github.com/a/StrikeOut', description: 'A task manager for iOS, released in 2022.' },
    ],
    positions: [],
    educations: [],
  },
  claims: [],
} as unknown as ClaimsDoc;

const ranked: EvidencePick[] = [{ target: 'project:strikeout', kind: 'project', title: 'StrikeOut', score: 5, matched: [] }];

const reply = { projects: [{ id: 'strikeout', heading: 'StrikeOut', tech: '', year: '', lines: [], link: 'https://github.com/a/StrikeOut', sources: ['project:strikeout'] }], bullets: [], reply: '' };

describe('hrefOf', () => {
  it('writes a link for a GitHub address', () => {
    expect(hrefOf('https://github.com/a/b_c')).toBe('\\href{https://github.com/a/b_c}{github.com/a/b\\_c}');
  });
  it.each(['https://github.com/a/b}\\input{x', 'https://github.com/a/b%20c', 'https://github.com/a/b#x', 'https://github.com/a/~b', 'http://github.com/a/b', 'https://github.com.evil.test/a', 'https://github.com/a/b c', 'https://github.com/a/b\n'])(
    'refuses %j',
    (url) => expect(hrefOf(url)).toBeNull(),
  );
});

describe('tailorTex with a project that has only a description', () => {
  it('adds the project in the shape of the CV, with the written link', () => {
    const written = effectiveWritten(checkWritten(reply, doc), doc, []);
    const r = tailorTex(TEX, doc, ranked, 2, written);
    expect('why' in r).toBe(false);
    if (!('tex' in r)) return;
    expect(r.added).toEqual(['StrikeOut']);
    expect(r.tex).toContain('\\item \\textbf{StrikeOut}');
    expect(r.tex).toContain('A task manager for iOS, released in 2022.');
    expect(r.tex).toContain('\\href{https://github.com/a/StrikeOut}{github.com/a/StrikeOut}');
  });

  it('keeps the link when the stored lines are checked again', () => {
    const w = checkWritten(reply, doc);
    expect(effectiveWritten(w, doc, []).projects.strikeout.link).toBe('https://github.com/a/StrikeOut');
  });
});

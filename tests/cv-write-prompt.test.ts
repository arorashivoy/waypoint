import { describe, expect, it } from 'vitest';
import { PROMPT_VERSIONS, WRITE_SYSTEM, writePrompt } from '@/lib/prompts';

const input = {
  projects: [{ id: 'p1', title: 'EVIL_TITLE', description: 'EVIL_DESC', bullets: ['EVIL_BULLET'], claims: [{ slug: 'c1', label: 'EVIL_LABEL', proofs: ['EVIL_PROOF'] }] }],
  positions: [{ id: 'pos', title: 'EVIL_POSTITLE', company: 'EVIL_CO', bullets: [{ id: 'pos/b', text: 'EVIL_LINE' }] }],
  style: ['EVIL_STYLE'],
  job: { role: 'EVIL_ROLE', company: 'EVIL_JOBCO', description: 'EVIL_POSTING' },
};

const between = (text: string, open: string, close: string) => {
  const a = text.indexOf(open);
  const b = text.indexOf(close, a);
  return a >= 0 && b > a ? text.slice(a, b) : '';
};

describe('the cv-write prompt', () => {
  it('fences the profile and the style lines as profile, and the posting as untrusted', () => {
    const p = writePrompt(input);
    const prof = between(p, '<profile>', '</profile>');
    for (const t of ['EVIL_TITLE', 'EVIL_DESC', 'EVIL_BULLET', 'EVIL_LABEL', 'EVIL_PROOF', 'EVIL_POSTITLE', 'EVIL_LINE', 'EVIL_STYLE']) expect(prof).toContain(t);
    expect(prof).not.toContain('EVIL_POSTING');
    const outside = p.replace(/<profile>[\s\S]*?<\/profile>/g, '').replace(/<untrusted[\s\S]*?<\/untrusted>/g, '');
    for (const t of ['EVIL_POSTING', 'EVIL_ROLE', 'EVIL_JOBCO']) expect(outside).not.toContain(t);
    expect(p).toContain('EVIL_POSTING');
  });

  it('puts a request in its own request fence', () => {
    const p = writePrompt({ ...input, request: 'EVIL_REQUEST' });
    expect(between(p, '<request>', '</request>')).toContain('EVIL_REQUEST');
    expect(writePrompt(input)).not.toContain('<request>');
  });

  it('tells the model to add no fact, to write plain text and to name the sources', () => {
    expect(WRITE_SYSTEM).toMatch(/never add a fact/i);
    expect(WRITE_SYSTEM).toMatch(/plain text/i);
    expect(WRITE_SYSTEM).toMatch(/no LaTeX/);
    expect(writePrompt(input)).toMatch(/"sources"/);
  });

  it('has a version', () => {
    expect(PROMPT_VERSIONS['cv-write']).toBe('cv-write-1');
  });
});

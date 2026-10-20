import { describe, expect, it } from 'vitest';
import type { ClaimsDoc } from '@/lib/claims';
import { tailorTex, type EvidencePick } from '@/lib/resume';

const TEX = [
  '\\begin{rSection}{PROJECTS}',
  '\\begin{itemize}',
  '\\item \\textbf{Fast parser} text one',
  '',
  '\\item \\textbf{Ledger service} text two',
  '\\end{itemize}',
  '\\end{rSection}',
].join('\n');

const doc = (extraTex: string): ClaimsDoc =>
  ({
    version: 1,
    profile: { name: 'N', headline: '' },
    targets: {
      projects: [
        { id: 'parser', title: 'Fast parser' },
        { id: 'ledger', title: 'Ledger service' },
        { id: 'kafka', title: 'Kafka streams', tex: extraTex },
      ],
      positions: [],
      educations: [],
    },
    claims: [],
  }) as unknown as ClaimsDoc;

const ranked: EvidencePick[] = [{ target: 'project:kafka', kind: 'project', title: 'Kafka streams', score: 5, matched: ['kafka'] }];

describe('tailorTex with the project tex of the profile', () => {
  it('adds a project whose tex passes the own-tex check', () => {
    const r = tailorTex(TEX, doc('\\item \\textbf{Kafka streams} safe text'), ranked, 2);
    expect('why' in r).toBe(false);
    if ('added' in r) expect(r.added).toEqual(['Kafka streams']);
  });

  it('does not add a project whose old tex row has a command that the own-tex check refuses', () => {
    const r = tailorTex(TEX, doc('\\item \\textbf{Kafka streams} \\immediate\\write18{id}'), ranked, 2);
    if ('added' in r) expect(r.added).toEqual([]);
    expect(JSON.stringify(r)).not.toContain('write18');
  });
});

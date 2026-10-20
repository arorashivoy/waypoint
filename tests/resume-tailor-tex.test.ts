import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClaimsDoc } from '@/lib/claims';
import { resumeMenu, tailorTex, type EvidencePick } from '@/lib/resume';
import { makeUser } from './helpers/http';

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

describe('the Refine menu', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('offers a project off the CV only when its tex passes the own-tex check', async () => {
    const admin = await makeUser('admin');
    const file = join(mkdtempSync(join(tmpdir(), 'menu-')), 'cv.tex');
    writeFileSync(file, TEX);
    vi.stubEnv('RESUME_TEX', file);
    const menu = async (tex: string) => (await resumeMenu(doc(tex), admin.user.id))!.projects.find((p) => p.id === 'kafka')!.usable;
    expect(await menu('\\item \\textbf{Kafka streams} safe text')).toBe(true);
    expect(await menu('\\item \\textbf{Kafka streams} \\immediate\\write18{id}')).toBe(false);
  });
});

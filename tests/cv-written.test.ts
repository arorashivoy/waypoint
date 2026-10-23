import { describe, expect, it } from 'vitest';
import type { ClaimsDoc } from '@/lib/claims';
import { checkWritten, effectiveWritten, type WriteReplyT } from '@/lib/resume/written';

const doc: ClaimsDoc = {
  version: 2,
  profile: { name: 'Test Person', headline: 'Engineer' },
  targets: {
    positions: [
      {
        id: 'goldman',
        title: 'Analyst',
        company: 'Goldman Sachs',
        start: '2024',
        bullets: [{ id: 'validator', match: 'Python validator', text: 'Built a Python validator for remediation updates' }],
      },
    ],
    projects: [
      {
        id: 'claude-code-skills',
        title: 'Claude Code engineering skills',
        description: 'Wrote Claude Code skills that capture release test evidence and check production configuration drift.',
      },
    ],
    educations: [],
  },
  claims: [
    {
      slug: 'test-evidence-automation',
      kind: 'skill',
      label: 'Release test evidence automation',
      aliases: [],
      links: [],
      mentions: [],
      evidence: [{ target: 'position:goldman/validator', depth: 'built', proof: 'automated release test evidence capture' }],
    },
    { slug: 'python', kind: 'language', label: 'Python', aliases: [], links: [], mentions: [], evidence: [{ target: 'position:goldman/validator', depth: 'built', proof: 'Python validator' }] },
  ],
};

const reply = (over: Partial<WriteReplyT>): WriteReplyT => ({ projects: [], bullets: [], reply: '', ...over });

describe('checkWritten', () => {
  it('keeps a bullet whose words come from its sources', () => {
    const w = checkWritten(reply({ bullets: [{ id: 'goldman/validator', text: 'Built a Python validator that automated release test evidence capture', sources: ['test-evidence-automation'] }] }), doc);
    expect(w.bullets['goldman/validator']).toEqual({ text: 'Built a Python validator that automated release test evidence capture', old: 'Built a Python validator for remediation updates', sources: ['test-evidence-automation'] });
    expect(w.dropped).toEqual([]);
  });

  it('drops a line with a tool that no source has, also when the posting asks for it', () => {
    const w = checkWritten(reply({ bullets: [{ id: 'goldman/validator', text: 'Built a Python validator on Kubernetes', sources: ['python'] }] }), doc);
    expect(w.bullets['goldman/validator']).toBeUndefined();
    expect(w.dropped).toEqual([{ id: 'goldman/validator', why: expect.stringMatching(/kubernetes/i) }]);
  });

  it('drops a line that names an unknown source', () => {
    const w = checkWritten(reply({ bullets: [{ id: 'goldman/validator', text: 'Built a Python validator', sources: ['nope'] }] }), doc);
    expect(w.dropped).toEqual([{ id: 'goldman/validator', why: 'unknown source nope' }]);
  });

  it('drops a line for a bullet or a project that is not in the profile', () => {
    const w = checkWritten(reply({ bullets: [{ id: 'goldman/other', text: 'Built a Python validator', sources: [] }] }), doc);
    expect(w.dropped).toEqual([{ id: 'goldman/other', why: 'not in your profile' }]);
  });

  it('uses the line of the CV as the old text when a map gives it', () => {
    const w = checkWritten(
      reply({ bullets: [{ id: 'goldman/validator', text: 'Built a Python validator for remediation updates to Java services', sources: [] }] }),
      doc,
      { bulletText: new Map([['goldman/validator', 'Built a Python validator for remediation updates to Java services and more']]) },
    );
    expect(w.bullets['goldman/validator'].old).toBe('Built a Python validator for remediation updates to Java services and more');
  });

  it('writes a project with no tex from its description and claims', () => {
    const w = checkWritten(
      reply({ projects: [{ id: 'claude-code-skills', heading: 'Claude Code engineering skills', tech: '', year: '', lines: ['Wrote Claude Code skills that capture release test evidence.'], sources: ['project:claude-code-skills'] }] }),
      doc,
    );
    expect(w.projects['claude-code-skills']).toEqual({
      heading: 'Claude Code engineering skills',
      tech: '',
      year: '',
      lines: ['Wrote Claude Code skills that capture release test evidence.'],
      old: 'Wrote Claude Code skills that capture release test evidence and check production configuration drift.',
      sources: ['project:claude-code-skills'],
    });
  });

  it('drops a project line with a number that is not in its sources, and the project when no line is left', () => {
    const w = checkWritten(
      reply({ projects: [{ id: 'claude-code-skills', heading: 'Claude Code engineering skills', tech: '', year: '', lines: ['Cut review time by 40% with Claude Code skills.'], sources: ['project:claude-code-skills'] }] }),
      doc,
    );
    expect(w.projects['claude-code-skills']).toBeUndefined();
    expect(w.dropped[0]).toEqual({ id: 'claude-code-skills', why: expect.stringMatching(/40%/) });
  });

  it('drops the year and the tech when they fail, and keeps the lines', () => {
    const w = checkWritten(
      reply({ projects: [{ id: 'claude-code-skills', heading: 'Claude Code engineering skills', tech: 'Rust', year: '2025', lines: ['Wrote Claude Code skills that check production configuration drift.'], sources: ['project:claude-code-skills'] }] }),
      doc,
    );
    expect(w.projects['claude-code-skills']).toMatchObject({ tech: '', year: '' });
    expect(w.projects['claude-code-skills'].lines).toHaveLength(1);
  });

  it('keeps the profile title when the heading fails', () => {
    const w = checkWritten(
      reply({ projects: [{ id: 'claude-code-skills', heading: 'Kubernetes platform', tech: '', year: '', lines: ['Wrote Claude Code skills that check production configuration drift.'], sources: ['project:claude-code-skills'] }] }),
      doc,
    );
    expect(w.projects['claude-code-skills'].heading).toBe('Claude Code engineering skills');
  });
});

describe('effectiveWritten', () => {
  const w = checkWritten(
    reply({
      bullets: [{ id: 'goldman/validator', text: 'Built a Python validator that automated release test evidence capture', sources: ['test-evidence-automation'] }],
      projects: [{ id: 'claude-code-skills', heading: 'Claude Code engineering skills', tech: '', year: '', lines: ['Wrote Claude Code skills that capture release test evidence.'], sources: ['project:claude-code-skills'] }],
    }),
    doc,
  );

  it('leaves out the ids that the user keeps as original', () => {
    const e = effectiveWritten(w, doc, ['goldman/validator']);
    expect(e.bullets['goldman/validator']).toBeUndefined();
    expect(e.projects['claude-code-skills']).toBeDefined();
  });

  it('leaves out a line that the profile no longer proves', () => {
    const smaller: ClaimsDoc = { ...doc, claims: doc.claims.filter((c) => c.slug !== 'test-evidence-automation') };
    const e = effectiveWritten(w, smaller, []);
    expect(e.bullets['goldman/validator']).toBeUndefined();
  });

  it('gives an empty result for no stored lines', () => {
    expect(effectiveWritten(undefined, doc, [])).toEqual({ bullets: {}, projects: {}, dropped: [] });
  });
});

describe('the line check and language names', () => {
  const cpp: ClaimsDoc = {
    ...doc,
    targets: { ...doc.targets, projects: [{ id: 'tick', title: 'Tick engine', description: 'Order book engine in C++ and a C# client.' }] },
  };
  const line = (lines: string[]) =>
    checkWritten({ projects: [{ id: 'tick', heading: 'Tick engine', tech: 'C++, C#', year: '', lines, sources: ['project:tick'] }], bullets: [], reply: '' }, cpp);

  it('keeps a line that names C++ or C# when the sources do', () => {
    const w = line(['Order book engine in C++ with a C# client.']);
    expect(w.dropped).toEqual([]);
    expect(w.projects.tick.tech).toBe('C++, C#');
  });

  it('keeps a line that starts with the verb Used', () => {
    expect(line(['Used C++ for an order book engine.']).dropped).toEqual([]);
  });

  it('still refuses C when the sources have only C++', () => {
    expect(line(['Order book engine in C.']).dropped[0]?.why).toMatch(/"C"/);
  });
});

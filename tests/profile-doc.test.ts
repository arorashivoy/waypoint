import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalDoc, checkDoc, checkYaml, diffDocs, emptyDoc, LIMITS, slugify, toYaml, type ClaimsDoc } from '@/lib/profile/doc';
import { checkText, validate } from '@/lib/claims';

const SAMPLE = readFileSync('tests/fixtures/claims-sample.yml', 'utf8');
const sample = (): ClaimsDoc => {
  const c = checkYaml(SAMPLE);
  if (!c.doc) throw new Error(c.errors.join('\n'));
  return c.doc;
};

describe('checkDoc', () => {
  it('accepts the sample and keeps the current rules', () => {
    const c = checkYaml(SAMPLE, { strict: true });
    expect(c.errors).toEqual([]);
    expect(c.doc?.claims.map((x) => x.slug)).toEqual(['java', 'spring', 'gpa']);
  });

  it('coerces numbers in text fields to strings', () => {
    const d = sample();
    expect(d.targets.positions[0].start).toBe('2024');
    expect(d.targets.educations[0].years).toBe('2023');
  });

  it('applies the defaults: depth "used", listed true, weight 1', () => {
    const d = sample();
    const spring = d.claims.find((c) => c.slug === 'spring')!;
    expect(spring.evidence[0].depth).toBe('used');
    expect(d.claims[0].mentions[0].listed).toBe(true);
    expect(d.claims[0].links[0].w).toBe(1);
  });

  it('drops an unknown field and warns', () => {
    const c = checkYaml(SAMPLE.replace('org: Personal', 'org: Personal\n      colour: blue'));
    expect(c.errors).toEqual([]);
    expect(c.warnings.join('\n')).toMatch(/targets\.projects\[0\]: the field "colour" is not known/);
    expect(c.doc?.targets.projects[0]).not.toHaveProperty('colour');
  });

  it('makes zero claims and an empty headline warnings, and strict makes them errors', () => {
    const raw = { version: 1, profile: { name: 'A', headline: '' }, targets: {}, claims: [] };
    const loose = checkDoc(raw);
    expect(loose.errors).toEqual([]);
    expect(loose.warnings.length).toBe(2);
    expect(checkDoc(raw, { strict: true }).errors.length).toBe(2);
    expect(validate(raw).errors.length).toBe(2);
  });

  it('refuses a project URL that is not http(s)', () => {
    const c = checkYaml(SAMPLE.replace('https://example.test/parser', 'javascript:alert(1)'));
    expect(c.errors.join('\n')).toMatch(/targets\.projects\[0\]\.url/);
  });

  it('checks the new project fields: source, repoUrl and bullets', () => {
    const base = sample();
    const p = { ...base.targets.projects[0], source: 'github', repoUrl: 'https://github.com/a-b/c.d', bullets: ['Wrote the tokenizer.'] };
    expect(checkDoc({ ...base, targets: { ...base.targets, projects: [p] } }).errors).toEqual([]);
    const bad = { ...p, source: 'fax', repoUrl: 'https://evil.test/x', bullets: [''] };
    const errs = checkDoc({ ...base, targets: { ...base.targets, projects: [bad] } }).errors.join('\n');
    expect(errs).toMatch(/\.source/);
    expect(errs).toMatch(/\.repoUrl/);
    expect(errs).toMatch(/\.bullets\[0\]/);
  });

  it('keeps an optional bullet text on a position bullet', () => {
    const c = checkYaml(SAMPLE.replace('match: rebuilt the ledger service', 'match: rebuilt the ledger service\n          text: Rebuilt the ledger service in Java.'));
    expect(c.doc?.targets.positions[0].bullets?.[0]).toEqual({ id: 'ledger', match: 'rebuilt the ledger service', text: 'Rebuilt the ledger service in Java.' });
  });

  it('refuses more items than the limit', () => {
    const claims = Array.from({ length: LIMITS.claims + 1 }, (_, i) => ({ slug: `c${i}`, kind: 'skill', label: `C${i}` }));
    const c = checkDoc({ version: 1, profile: { name: 'A', headline: 'B' }, targets: {}, claims });
    expect(c.errors.join('\n')).toMatch(/^claims: 501 items, limit 500/m);
  });

  it('refuses a text field over the limit', () => {
    const long = 'x'.repeat(LIMITS.text + 1);
    const c = checkYaml(SAMPLE.replace('A streaming JSON parser.', long));
    expect(c.errors.join('\n')).toMatch(/targets\.projects\[0\]\.description: 4001 characters, limit 4000/);
  });

  it('gives a name-like field (org, location) the limit of one line', () => {
    const doc = checkYaml(SAMPLE).doc!;
    const long = 'x'.repeat(LIMITS.line + 1);
    const withOrg = { ...doc, targets: { ...doc.targets, projects: [{ ...doc.targets.projects[0], org: long }, ...doc.targets.projects.slice(1)] } };
    expect(checkDoc(withOrg).errors.join('\n')).toMatch(/targets\.projects\[0\]\.org: 401 characters, limit 400/);
    const withPlace = { ...doc, targets: { ...doc.targets, positions: [{ ...doc.targets.positions[0], location: long }, ...doc.targets.positions.slice(1)] } };
    expect(checkDoc(withPlace).errors.join('\n')).toMatch(/targets\.positions\[0\]\.location: 401 characters, limit 400/);
  });

  it('reports YAML syntax errors as errors, not throws', () => {
    expect(checkYaml('version: [1').errors[0]).toMatch(/^yaml:/);
    expect(checkText('version: [1').errors[0]).toMatch(/^yaml:/);
  });
});

describe('round trip', () => {
  it('gives the same canonical data back from toYaml', () => {
    const d = sample();
    const again = checkYaml(toYaml(d));
    expect(again.errors).toEqual([]);
    expect(canonicalDoc(again.doc!)).toEqual(canonicalDoc(d));
  });

  it('drops null, empty text and empty lists from the canonical form', () => {
    const c = canonicalDoc({ ...emptyDoc('A'), profile: { name: 'A', headline: '' } });
    expect(c).toEqual({ version: 1, profile: { name: 'A' } });
  });
});

describe('slugify', () => {
  it('makes a kebab-case slug and adds a number for a used one', () => {
    const taken = new Set<string>();
    expect(slugify('Senior Engineer @ Acme GmbH', taken)).toBe('senior-engineer-acme-gmbh');
    expect(slugify('Senior engineer, Acme GmbH', taken)).toBe('senior-engineer-acme-gmbh-2');
    expect(slugify('Über Café', taken)).toBe('uber-cafe');
    expect(slugify('!!!', taken, 'skill')).toBe('skill');
  });
});

describe('diffDocs', () => {
  it('lists added, removed and changed items by key', () => {
    const before = sample();
    const after: ClaimsDoc = {
      ...before,
      profile: { ...before.profile, headline: 'New headline' },
      claims: [...before.claims.filter((c) => c.slug !== 'gpa').map((c) => (c.slug === 'java' ? { ...c, label: 'Java 21' } : c)), { slug: 'go', kind: 'language', label: 'Go', aliases: [], links: [], evidence: [], mentions: [] }],
    };
    expect(diffDocs(before, after)).toEqual([
      { kind: 'profile', key: 'profile', label: 'Name and headline', change: 'changed' },
      { kind: 'claim', key: 'java', label: 'Java 21', change: 'changed' },
      { kind: 'claim', key: 'go', label: 'Go', change: 'added' },
      { kind: 'claim', key: 'gpa', label: 'GPA', change: 'removed' },
    ]);
  });

  it('sees no change when only the order of the keys differs', () => {
    const before = sample();
    const flip = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(flip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, flip(x)])) : v;
    const after = flip(before) as ClaimsDoc;
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
    expect(diffDocs(before, after)).toEqual([]);
  });

  it('lists every item as added when there is no profile yet', () => {
    expect(diffDocs(null, sample()).filter((d) => d.change === 'added').length).toBe(1 + 1 + 1 + 3 + 1);
  });
});

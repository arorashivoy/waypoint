import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkDoc, checkYaml, type Claim, type ClaimsDoc } from '@/lib/profile/doc';
import { applyDrafts, mergeItem, removeItem, upsertItem } from '@/lib/profile/apply';

const sample = (): ClaimsDoc => checkYaml(readFileSync('tests/fixtures/claims-sample.yml', 'utf8')).doc!;
const claim = (slug: string, extra: Partial<Claim> = {}): Claim => ({ slug, kind: 'skill', label: slug, aliases: [], links: [], evidence: [], mentions: [], ...extra });

describe('upsertItem and removeItem', () => {
  it('renames the evidence targets when a project gets a new ID', () => {
    const d = sample();
    const next = upsertItem(d, 'project', 'parser', { ...d.targets.projects[0], id: 'json-parser' });
    expect(next.claims.find((c) => c.slug === 'spring')!.evidence[0].target).toBe('project:json-parser');
    expect(checkDoc(next).errors).toEqual([]);
    expect(d.targets.projects[0].id).toBe('parser');
  });

  it('renames bullet targets when a position gets a new ID', () => {
    const d = sample();
    const next = upsertItem(d, 'position', 'acme-dev', { ...d.targets.positions[0], id: 'acme-engineer' });
    expect(next.claims[0].evidence[0].target).toBe('position:acme-engineer/ledger');
    expect(checkDoc(next).errors).toEqual([]);
  });

  it('renames links when a claim gets a new slug', () => {
    const d = sample();
    const next = upsertItem(d, 'claim', 'spring', { ...d.claims[1], slug: 'spring-boot' });
    expect(next.claims[0].links[0].to).toBe('spring-boot');
    expect(checkDoc(next).errors).toEqual([]);
  });

  it('removes the evidence and links that name a removed item', () => {
    const d = sample();
    const noProject = removeItem(d, 'project', 'parser');
    expect(noProject.claims.find((c) => c.slug === 'spring')!.evidence).toEqual([]);
    const noSpring = removeItem(d, 'claim', 'spring');
    expect(noSpring.claims[0].links).toEqual([]);
    expect(checkDoc(noProject).errors).toEqual([]);
    expect(checkDoc(noSpring).errors).toEqual([]);
  });

  it('adds an item at the end when the key is null', () => {
    const next = upsertItem(sample(), 'claim', null, claim('go'));
    expect(next.claims.map((c) => c.slug)).toEqual(['java', 'spring', 'gpa', 'go']);
  });
});

describe('mergeItem', () => {
  it('keeps the existing values, fills empty fields and unites the lists', () => {
    const existing = claim('java', { label: 'Java', aliases: ['jdk'], evidence: [{ target: 'project:a', depth: 'built' }], mentions: [{ surface: 'resume', listed: true }] });
    const incoming = claim('java-2', { label: 'JAVA', aliases: ['jdk', 'java se'], evidence: [{ target: 'project:a', depth: 'used' }, { target: 'project:b', depth: 'used' }], mentions: [{ surface: 'linkedin-skills', listed: true }] });
    expect(mergeItem('claim', existing, incoming)).toEqual({
      ...existing,
      aliases: ['jdk', 'java se'],
      evidence: [{ target: 'project:a', depth: 'built' }, { target: 'project:b', depth: 'used' }],
      mentions: [{ surface: 'resume', listed: true }, { surface: 'linkedin-skills', listed: true }],
    });
  });

  it('fills a missing location and adds new bullets of a position', () => {
    const d = sample();
    const p = d.targets.positions[0];
    const merged = mergeItem('position', { ...p, location: null }, { ...p, id: 'x', location: 'Munich', bullets: [{ id: 'new', match: 'shipped the new API', text: 'Shipped the new API.' }] });
    expect(merged).toMatchObject({ id: 'acme-dev', location: 'Munich', bullets: [{ id: 'ledger' }, { id: 'new' }] });
  });
});

describe('applyDrafts', () => {
  it('applies a project draft before the claim draft that points at it', () => {
    const d = sample();
    const next = applyDrafts(d, [
      { type: 'claim', data: claim('rust', { evidence: [{ target: 'project:cli-tool', depth: 'built', proof: 'Wrote it in Rust.' }] }), matches: null },
      { type: 'project', data: { id: 'cli-tool', title: 'CLI tool', source: 'github' }, matches: null },
    ]);
    expect(checkDoc(next).errors).toEqual([]);
    expect(next.targets.projects.map((p) => p.id)).toEqual(['parser', 'cli-tool']);
  });

  it('keeps the existing key of a matched item, and points the claim drafts of the batch at it', () => {
    const d = sample();
    const next = applyDrafts(d, [
      { type: 'project', data: { id: 'fast-parser', title: 'Fast parser', description: 'Now with SIMD.' }, matches: 'parser' },
      { type: 'claim', data: claim('simd', { evidence: [{ target: 'project:fast-parser', depth: 'used' }] }), matches: null },
    ]);
    expect(next.targets.projects.map((p) => p.id)).toEqual(['parser']);
    expect(next.targets.projects[0].description).toBe('A streaming JSON parser.');
    expect(next.claims.find((c) => c.slug === 'simd')!.evidence[0].target).toBe('project:parser');
    expect(checkDoc(next).errors).toEqual([]);
  });

  it('replaces the full document for a profile draft', () => {
    const other = { ...sample(), profile: { name: 'Other', headline: 'Other' } };
    expect(applyDrafts(sample(), [{ type: 'profile', data: other, matches: null }]).profile.name).toBe('Other');
  });

  it('sets the headline and keeps the name for a meta draft', () => {
    const next = applyDrafts(sample(), [{ type: 'meta', data: { name: 'Ignored', headline: 'New headline' }, matches: null }]);
    expect(next.profile).toEqual({ name: 'Test Person', headline: 'New headline' });
  });
});

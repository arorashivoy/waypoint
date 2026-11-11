import { describe, expect, it } from 'vitest';
import type { ClaimsDoc } from '@/lib/claims';
import { claimsInJob, claimsInPosting, claimsKey } from '@/lib/resume';

type Claim = ClaimsDoc['claims'][number];

const claim = (slug: string, label: string, aliases: string[] = [], over: Partial<Claim> = {}): Claim => ({
  slug,
  kind: 'skill',
  label,
  aliases,
  links: [],
  mentions: [],
  evidence: [{ target: 'project:p', depth: 'built', proof: 'x' }],
  ...over,
});

const doc = (claims: Claim[]): ClaimsDoc => ({
  version: 2,
  profile: { name: 'Test Person', headline: 'Engineer' },
  targets: { positions: [], projects: [{ id: 'p', title: 'P', description: 'A project.' }], educations: [] },
  claims,
});

const base = () =>
  doc([
    claim('ros', 'ROS', ['ROS 2']),
    claim('c', 'C'),
    claim('cpp', 'C++', ['cpp']),
    claim('node', 'Node.js'),
    claim('kafka', 'Apache Kafka', ['Kafka'], { evidence: [{ target: 'project:p', depth: 'mentioned', proof: 'x' }] }),
    claim('python', 'Python', [], { kind: 'language' }),
    claim('lead', 'Team lead', [], { kind: 'trait' as Claim['kind'] }),
  ]);

const slugs = (text: string) => claimsInPosting(base(), text).map((r) => r.slug);

describe('claimsInPosting', () => {
  it('matches a term only as a full word', () => {
    expect(slugs('We work across teams in microservices.')).toEqual([]);
    expect(slugs('You know ROS and Python.')).toEqual(['ros', 'python']);
    expect(slugs('Experience with ROS 2 is a plus')).toEqual(['ros']);
  });

  it('never matches a term of 1 letter, and matches a term with a sign', () => {
    expect(slugs('Vitamin C for all.')).toEqual([]);
    expect(slugs('Modern C++ (17 or newer), Node.js services')).toEqual(['cpp', 'node']);
    expect(slugs('CPP, node js')).toEqual(['cpp']);
  });

  it('matches an alias and ignores the case', () => {
    expect(slugs('KAFKA streams')).toEqual(['kafka']);
  });

  it('takes only skills and languages', () => {
    expect(slugs('A team lead who writes Python')).toEqual(['python']);
  });

  it('marks a claim with no evidence deeper than a mention as not proven', () => {
    expect(claimsInPosting(base(), 'Kafka and Python')).toEqual([
      { slug: 'kafka', t: 'Apache Kafka', ok: false },
      { slug: 'python', t: 'Python', ok: true },
    ]);
  });
});

describe('claimsKey', () => {
  it('is the same for 2 copies of the same claims', () => {
    expect(claimsKey(base())).toBe(claimsKey(base()));
  });

  it('changes when a term or the proof of a claim changes', () => {
    const k = claimsKey(base());
    const alias = base();
    alias.claims[0].aliases.push('Robot Operating System');
    expect(claimsKey(alias)).not.toBe(k);
    const proof = base();
    proof.claims[4].evidence[0].depth = 'built';
    expect(claimsKey(proof)).not.toBe(k);
  });

  it('does not change for a claim that the match does not use', () => {
    const other = base();
    other.claims[6].label = 'Mentor';
    expect(claimsKey(other)).toBe(claimsKey(base()));
  });
});

describe('claimsInJob', () => {
  const job = (id: string, description: string, role = 'Engineer') => ({ id, role, description });

  it('gives the result of claimsInPosting for the role and the description', () => {
    const d = base();
    const j = job('j1', 'Kafka and C++', 'Python Engineer');
    expect(claimsInJob(d, claimsKey(d), j)).toEqual(claimsInPosting(d, 'Python Engineer\nKafka and C++'));
  });

  it('keeps the result for the same job and the same claims', () => {
    const j = job('j2', 'Kafka and Python');
    const first = claimsInJob(base(), claimsKey(base()), j);
    // A new copy of the same claims, as each request loads one.
    expect(claimsInJob(base(), claimsKey(base()), { ...j })).toBe(first);
  });

  it('matches again when the description or the role changes', () => {
    const d = base();
    const k = claimsKey(d);
    expect(claimsInJob(d, k, job('j3', 'Kafka and Python')).map((r) => r.slug)).toEqual(['kafka', 'python']);
    expect(claimsInJob(d, k, job('j3', 'ROS 2 and Python')).map((r) => r.slug)).toEqual(['ros', 'python']);
    expect(claimsInJob(d, k, job('j3', 'ROS 2 and Python', 'Kafka Engineer')).map((r) => r.slug)).toEqual(['ros', 'kafka', 'python']);
  });

  it('keeps the results of 2 profiles apart', () => {
    const a = base();
    const b = doc([claim('go', 'Go', ['Golang'])]);
    const j = job('j4', 'Golang or Python');
    expect(claimsInJob(a, claimsKey(a), j).map((r) => r.slug)).toEqual(['python']);
    expect(claimsInJob(b, claimsKey(b), j).map((r) => r.slug)).toEqual(['go']);
    expect(claimsInJob(a, claimsKey(a), j).map((r) => r.slug)).toEqual(['python']);
  });

  it('matches again after the claims change', () => {
    const j = job('j5', 'Golang or Python');
    const before = base();
    expect(claimsInJob(before, claimsKey(before), j).map((r) => r.slug)).toEqual(['python']);
    const after = base();
    after.claims.push(claim('go', 'Go', ['Golang']));
    expect(claimsInJob(after, claimsKey(after), j).map((r) => r.slug)).toEqual(['python', 'go']);
  });
});

import { describe, expect, it } from 'vitest';
import { JobCheckReply, RefineReply, coerceText, jobCheckSchema } from '@/lib/schemas';

describe('jobCheckSchema', () => {
  const base = {
    requirements: [{ text: 'Java', importance: 'must', status: 'met', evidence: ['java'] }],
    blockers: [{ type: 'language', quote: 'fluent German' }],
    legitimacy: ['reposted'],
    level: 'Mid',
    mode: 'Remote',
    sponsor: false,
    visa: 'Sponsorship not stated',
    field: 'Backend',
    summary: 'Good fit.',
  };
  it('accepts the documented shape', () => {
    expect(jobCheckSchema(['Backend']).parse(base)).toEqual(base);
  });
  it('allows only the given fields and Other', () => {
    expect(jobCheckSchema(['Trading']).safeParse(base).success).toBe(false);
    expect(jobCheckSchema(['Trading']).safeParse({ ...base, field: 'Other' }).success).toBe(true);
  });
  it('refuses more than 15 requirements and more than 6 blockers', () => {
    expect(JobCheckReply.safeParse({ ...base, field: 'Other', requirements: Array(16).fill(base.requirements[0]) }).success).toBe(false);
    expect(JobCheckReply.safeParse({ ...base, field: 'Other', blockers: Array(7).fill(base.blockers[0]) }).success).toBe(false);
  });
  it('accepts a string wrapped in an object, as old replies did', () => {
    expect(coerceText({ t: 'Notice period line' })).toBe('Notice period line');
  });
  it('refuses a missing key', () => {
    const { visa, ...rest } = base;
    expect(JobCheckReply.safeParse({ ...rest, field: 'Other' }).success).toBe(false);
  });
});

describe('RefineReply', () => {
  it('accepts null for a list that stays the same', () => {
    expect(RefineReply.parse({ projects: null, bullets: null, skills: ['java'], reply: 'Done' }).skills).toEqual(['java']);
  });
});

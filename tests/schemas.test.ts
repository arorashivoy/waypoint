import { describe, expect, it } from 'vitest';
import { AnalysisReply, RefineReply, coerceText } from '@/lib/schemas';

const base = { field: 'Backend', mode: 'Remote', level: 'Mid', sponsor: false, visa: 'Sponsorship not stated', requirements: [{ t: 'Java', ok: true }], must: ['x'], projects: [{ n: 'Waypoint', why: 'fits' }] };

describe('AnalysisReply', () => {
  it('accepts the documented shape', () => {
    expect(AnalysisReply.parse(base)).toEqual(base);
  });
  it('accepts a string wrapped in an object, as old replies did', () => {
    expect(coerceText({ t: 'Notice period line' })).toBe('Notice period line');
  });
  it('refuses a missing key', () => {
    const { visa, ...rest } = base;
    expect(AnalysisReply.safeParse(rest).success).toBe(false);
  });
});

describe('RefineReply', () => {
  it('accepts null for a list that stays the same', () => {
    expect(RefineReply.parse({ projects: null, bullets: null, skills: ['java'], reply: 'Done' }).skills).toEqual(['java']);
  });
});

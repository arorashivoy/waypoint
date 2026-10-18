import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ask = vi.hoisted(() => ({ reply: null as unknown, calls: [] as any[] }));

vi.mock('@/lib/claude/credential', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude/credential')>()),
  credentialFor: vi.fn(async () => ({ kind: 'api', key: 'k', source: 'own' })),
}));
vi.mock('@/lib/cache', async (orig) => ({
  ...(await orig<typeof import('@/lib/cache')>()),
  askJsonCached: vi.fn(async (kind: string, version: string, req: any) => {
    ask.calls.push({ kind, version, req });
    return req.schema.parse(ask.reply);
  }),
}));

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { db } from '@/lib/db';
import { credentialFor } from '@/lib/claude';
import { analyseJob, jobView } from '@/lib/analysis';
import { checkReply, fieldChoices, jobCheckProfileText, normaliseQuote, requirementRatio, scoreCheck, type JobCheck } from '@/lib/jobcheck';
import { jobCheckSchema } from '@/lib/schemas';
import { FIELD_CHOICES, saveSearchSettings } from '@/lib/settings';
import { PROMPT_VERSIONS } from '@/lib/prompts';
import { checkYaml } from '@/lib/profile/doc';
import { saveProfile } from '@/lib/profile/store';
import { claimsFor } from '@/lib/user';
import { makeUser } from './helpers/http';

const req = (importance: 'must' | 'nice', status: 'met' | 'partial' | 'missing', evidence: string[] = []) => ({ text: 'R', importance, status, evidence });
const reply = (over: Partial<JobCheck> = {}): JobCheck => ({
  requirements: [],
  blockers: [],
  legitimacy: [],
  level: 'Mid',
  mode: 'Remote',
  sponsor: false,
  visa: 'Sponsorship not stated',
  field: 'Backend',
  summary: 'Fits.',
  ...over,
});

describe('checkReply', () => {
  const ctx = { slugs: new Set(['java']), posting: 'We need   Java.\nFluent GERMAN is required. Use <b>bold</b>.' };

  it('turns a met or partial requirement with an unknown slug into missing and removes the slug', () => {
    const out = checkReply(reply({ requirements: [req('must', 'met', ['java', 'ghost']), req('nice', 'partial', ['ghost']), req('must', 'met', ['java'])] }), ctx);
    expect(out.requirements.map((r) => r.status)).toEqual(['missing', 'missing', 'met']);
    expect(out.requirements[0].evidence).toEqual(['java']);
    expect(out.requirements[1].evidence).toEqual([]);
  });

  it('does not credit a met requirement with no evidence', () => {
    expect(checkReply(reply({ requirements: [req('must', 'met', [])] }), ctx).requirements[0].status).toBe('missing');
  });

  it('removes a blocker whose quote is not in the posting and keeps a real one', () => {
    const out = checkReply(
      reply({ blockers: [{ type: 'language', quote: 'fluent german is   required' }, { type: 'clearance', quote: 'Top Secret clearance' }, { type: 'other', quote: '  ' }] }),
      ctx,
    );
    expect(out.blockers).toEqual([{ type: 'language', quote: 'fluent german is   required' }]);
  });

  it('matches a quote with full-width angle brackets, as the fence writes them', () => {
    const out = checkReply(reply({ blockers: [{ type: 'other', quote: 'Use ＜b＞bold＜/b＞' }] }), ctx);
    expect(out.blockers).toHaveLength(1);
    expect(normaliseQuote('＜A＞')).toBe('<a>');
  });

  it('cuts the summary to 25 words', () => {
    const out = checkReply(reply({ summary: Array(40).fill('word').join(' ') }), ctx);
    expect(out.summary.split(' ')).toHaveLength(25);
  });
});

describe('scoreCheck', () => {
  const two = [req('must', 'met', ['a']), req('must', 'met', ['b']), req('nice', 'missing')];

  it('weighs 2 musts met and 1 nice missing as (3+3)/(3+3+1)', () => {
    expect(requirementRatio(two) * 100).toBeCloseTo(85.7, 1);
    // Fits 0: round(20 · 0.857) = 17.
    expect(scoreCheck({ requirements: two, blockers: [] }, 0, 0).score).toBe(17);
  });

  it('credits a partial as half and weighs a nice as 1', () => {
    expect(requirementRatio([req('must', 'partial'), req('nice', 'met')])).toBeCloseTo((1.5 + 1) / 4);
    expect(requirementRatio([])).toBe(0);
  });

  it('combines the ratio with the fits and takes 25 for each blocker', () => {
    const blocker = { type: 'language' as const, quote: 'German' };
    const free = scoreCheck({ requirements: two, blockers: [] }, 1, 1);
    expect(free.score).toBe(97); // round(20 · 0.857 + 40 + 40)
    const blocked = scoreCheck({ requirements: two, blockers: [blocker] }, 1, 1);
    expect(blocked.score).toBe(72);
    expect(blocked.parts).toContainEqual({ kind: 'blocker', label: 'language: German', points: -25 });
    expect(blocked.parts.filter((p) => p.kind === 'requirement').map((p) => p.points)).toEqual([8.6, 8.6, 0]);
    expect(blocked.parts.filter((p) => p.kind === 'field' || p.kind === 'level').map((p) => p.points)).toEqual([40, 40]);
  });

  it('never goes below 0 or above 100', () => {
    const blockers = Array(6).fill({ type: 'other' as const, quote: 'x' });
    expect(scoreCheck({ requirements: two, blockers }, 0, 0).score).toBe(0);
    expect(scoreCheck({ requirements: [req('must', 'met')], blockers: [] }, 1, 1).score).toBe(100);
  });
});

describe('fields', () => {
  it('uses the saved fields, or the default list, and always Other', () => {
    expect(fieldChoices(['Trading'])).toEqual(['Trading', 'Other']);
    expect(fieldChoices([])).toEqual([...FIELD_CHOICES]);
  });

  it('sends the enum in the structured output format', () => {
    const { schema } = zodOutputFormat(jobCheckSchema(fieldChoices(['Trading'])) as never) as any;
    // This SDK version writes an enum into the description of the property.
    expect(schema.properties.field.description).toContain('["Trading","Other"]');
  });
});

const job = (description = 'Java services. Fluent German is required.') =>
  db.job.create({ data: { externalId: `jc-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Backend Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test', description } });

describe('analyseJob', () => {
  beforeEach(() => {
    ask.calls = [];
    vi.mocked(credentialFor).mockResolvedValue({ kind: 'api', key: 'k', source: 'own' } as never);
  });

  async function userWithProfile() {
    const u = await makeUser();
    const doc = checkYaml(readFileSync('tests/fixtures/claims-sample.yml', 'utf8')).doc!;
    await saveProfile(u.user.id, doc, 'test');
    await db.countryPref.create({ data: { userId: u.user.id, cc: 'XJ', rank: 0, on: true } });
    return u.user.id;
  }

  it('puts the profile in the system prompt, the posting in the user prompt, and passes the version', async () => {
    const userId = await userWithProfile();
    await saveSearchSettings(userId, { fields: ['Backend'], visaStatus: 'Needs sponsorship' });
    const j = await job();
    ask.reply = { ...reply({ requirements: [req('must', 'met', ['java'])] }) };
    await analyseJob(j, userId);
    const [{ kind, version, req: r }] = ask.calls;
    expect(PROMPT_VERSIONS['job-check']).toBe('job-check-1');
    expect(version).toBe('job-check-1');
    expect(kind).toBe('job-check');
    expect(r.effort).toBe('medium');
    const rules = r.system.indexOf('Return JSON with exactly these keys');
    expect(rules).toBeGreaterThan(-1);
    expect(r.system.lastIndexOf('<profile>')).toBeGreaterThan(rules);
    expect(r.system).toContain('java · Java · built · Rebuilt the ledger in Java.');
    expect(r.system).not.toContain('gpa ·');
    expect(r.system).toMatch(/Countries: .*\bXJ\b/);
    expect(r.system).toContain('Fields: Backend');
    expect(r.system).toContain('Visa status: Needs sponsorship');
    expect(r.prompt).toContain('Java services.');
    expect(r.prompt).not.toContain('<profile>');
  });

  it('checks the reply, scores it in code and stores it', async () => {
    const userId = await userWithProfile();
    const j = await job();
    ask.reply = reply({
      requirements: [req('must', 'met', ['java']), req('must', 'met', ['ghost'])],
      blockers: [{ type: 'language', quote: 'Fluent German is required' }, { type: 'clearance', quote: 'Secret clearance' }],
    });
    const a = await analyseJob(j, userId);
    expect(a.requirements.map((r) => r.status)).toEqual(['met', 'missing']);
    expect(a.blockers).toHaveLength(1);
    expect(a.by).toBe('claude');
    expect(a.promptVersion).toBe('job-check-1');
    // The model gave no score: code computes 20 · ratio (0.5 here) + the two fits - 25 for the one blocker.
    const fits = a.parts.filter((p) => p.kind === 'field' || p.kind === 'level').reduce((n, p) => n + p.points, 0);
    expect(a.score).toBe(Math.max(0, Math.round(10 + fits) - 25));
    const row = await db.jobAnalysis.findUniqueOrThrow({ where: { userId_jobId: { userId, jobId: j.id } } });
    expect(row.analysedAt).not.toBeNull();
    expect(JSON.parse(row.analysis).blockers).toHaveLength(1);
  });

  it('allows the default fields when the user saved none', async () => {
    const userId = await userWithProfile();
    ask.reply = reply({ field: 'Robotics' });
    await analyseJob(await job(), userId);
    expect(ask.calls[0].req.schema.safeParse(ask.reply).success).toBe(true);
  });

  it('allows only the saved fields and Other when the user saved some', async () => {
    const userId = await userWithProfile();
    await saveSearchSettings(userId, { fields: ['Trading'], visaStatus: '' });
    ask.reply = reply({ field: 'Other' });
    await analyseJob(await job(), userId);
    const schema = ask.calls[0].req.schema;
    expect(schema.safeParse(reply({ field: 'Other' })).success).toBe(true);
    expect(schema.safeParse(reply({ field: 'Trading' })).success).toBe(true);
    expect(schema.safeParse(reply({ field: 'Backend' })).success).toBe(false);
  });

  it('gives the heuristic the same shape when no credential exists', async () => {
    vi.mocked(credentialFor).mockResolvedValue(null);
    const userId = await userWithProfile();
    const a = await analyseJob(await job('We use Java and Spring Boot.'), userId);
    expect(a.by).toBe('heuristic');
    expect(a.blockers).toEqual([]);
    expect(a.legitimacy).toEqual([]);
    expect(a.requirements.length).toBeGreaterThan(0);
    expect(a.requirements[0]).toEqual(expect.objectContaining({ text: expect.any(String), importance: 'must', evidence: expect.any(Array) }));
    expect(typeof a.score).toBe('number');
    expect(Array.isArray(a.parts)).toBe(true);
    expect(ask.calls).toHaveLength(0);
    // Evidence slugs from the claims are named.
    expect(a.requirements.find((r) => r.status === 'met')?.evidence[0]).toMatch(/^[a-z0-9-]+$/);
  });

  it('reads a stored analysis of the old shape without a migration', async () => {
    const userId = await userWithProfile();
    const j = await job();
    const old = { field: 'Backend', mode: 'Remote', level: 'Mid', sponsor: true, visa: 'Blue Card', requirements: [{ t: 'Java', ok: true }, { t: { t: 'Kafka' }, ok: false }], must: ['x'], projects: [{ n: 'P', why: 'w' }], by: 'claude' };
    await db.jobAnalysis.create({ data: { userId, jobId: j.id, analysis: JSON.stringify(old), analysedAt: new Date() } });
    const view = await jobView(j, userId);
    expect(view.analysis.requirements).toEqual([
      { text: 'Java', importance: 'must', status: 'met', evidence: [] },
      { text: 'Kafka', importance: 'must', status: 'missing', evidence: [] },
    ]);
    expect(view.analysis.blockers).toEqual([]);
    expect(view.analysis.promptVersion).toBe('analysis-v1');
    expect(view.provisional).toBe(false);
    expect(view.match).toBe(view.analysis.score);
    const row = await db.jobAnalysis.findUniqueOrThrow({ where: { userId_jobId: { userId, jobId: j.id } } });
    expect(JSON.parse(row.analysis)).toEqual(old);
    // The same row reads back through the cached path of analyseJob.
    expect((await analyseJob(j, userId)).requirements[0].text).toBe('Java');
    expect(ask.calls).toHaveLength(0);
  });
});

describe('jobCheckProfileText', () => {
  it('lists only claims with evidence deeper than mentioned', async () => {
    const doc = checkYaml(readFileSync('tests/fixtures/claims-sample.yml', 'utf8')).doc!;
    const text = jobCheckProfileText(doc, { fields: [], visaStatus: '' }, []);
    expect(text).toContain('java · Java · built');
    expect(text).not.toMatch(/^gpa ·/m);
    expect(text).toContain('Countries: none');
    expect(await claimsFor('none-' + randomBytes(4).toString('hex'))).toBeNull();
    expect(jobCheckProfileText(null, { fields: [], visaStatus: '' }, ['DE'])).toContain('none');
  });
});

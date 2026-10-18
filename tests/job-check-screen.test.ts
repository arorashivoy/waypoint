import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

vi.mock('@/lib/claude/credential', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude/credential')>()),
  credentialFor: vi.fn(async () => null),
}));

import { db } from '@/lib/db';
import { buildState } from '@/lib/state';
import { checkYaml } from '@/lib/profile/doc';
import { saveProfile } from '@/lib/profile/store';
import { legitimacyLine } from '@/lib/jobcheck-text';
import * as jobDetail from '@/app/api/jobs/[id]/route';
import { ctx, makeUser, request } from './helpers/http';

const QUOTE = 'Applicants must hold a security clearance';

async function setup() {
  const a = await makeUser();
  const b = await makeUser();
  const cc = `X${'ABCDEFGHJKLMNPQRSTUVWXYZ'[randomBytes(1)[0] % 24]}`;
  const job = await db.job.create({
    data: { externalId: `screen-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc, url: 'https://x.test', description: QUOTE },
  });
  for (const u of [a, b]) await db.countryPref.create({ data: { userId: u.user.id, cc, rank: 1, on: true } });
  const doc = checkYaml(readFileSync('tests/fixtures/claims-sample.yml', 'utf8')).doc!;
  await saveProfile(a.user.id, doc, 'A writes');
  const check = {
    requirements: [{ text: 'Java services', importance: 'must', status: 'met', evidence: ['java'] }],
    blockers: [{ type: 'clearance', quote: QUOTE }],
    legitimacy: ['pay-to-apply'],
    level: 'Mid', mode: 'Remote', sponsor: false, visa: 'Sponsorship not stated', field: 'Backend',
    summary: 'A backend role with a clearance rule.',
    by: 'claude', promptVersion: 'job-check-v1',
  };
  await db.jobAnalysis.create({ data: { userId: a.user.id, jobId: job.id, analysis: JSON.stringify(check), analysedAt: new Date() } });
  return { a, b, job };
}

describe('the job check on the screens', () => {
  it('sends the full check, with claim labels as evidence, to the owner of the analysis', async () => {
    const { a, job } = await setup();
    const res = await jobDetail.GET(request(`/api/jobs/${job.id}`, { cookie: a.cookie }), ctx({ id: job.id }));
    const body = await res.json();
    expect(body.summary).toBe('A backend role with a clearance rule.');
    expect(body.blockers).toEqual([{ type: 'clearance', quote: QUOTE }]);
    expect(body.legitimacy).toEqual(['pay-to-apply']);
    expect(body.parts.some((p: any) => p.kind === 'blocker' && p.points === -25)).toBe(true);
    expect(body.requirements[0].evidence).toEqual(['Java']);
    expect(body.reqs).toBeUndefined();
  });

  it('shows nothing from the analysis of another user', async () => {
    const { b, job } = await setup();
    const body = await (await jobDetail.GET(request(`/api/jobs/${job.id}`, { cookie: b.cookie }), ctx({ id: job.id }))).json();
    expect(body.blockers).toEqual([]);
    expect(body.summary).toBe('');
    expect(body.legitimacy).toEqual([]);
    expect(body.by).toBe('heuristic');
  });

  it('puts only hasBlocker, not the check, in the state', async () => {
    const { a, b, job } = await setup();
    const card = (await buildState(a.user.id)).jobs.find((j: any) => j.id === job.id) as any;
    expect(card?.hasBlocker).toBe(true);
    expect(card).not.toHaveProperty('blockers');
    expect(card).not.toHaveProperty('parts');
    const other = (await buildState(b.user.id)).jobs.find((j: any) => j.id === job.id) as any;
    expect(other?.hasBlocker ?? false).toBe(false);
  });

  it('writes the flags as one warning line in plain words', () => {
    expect(legitimacyLine(['pay-to-apply'])).toContain('asks you to pay to apply');
    expect(legitimacyLine([])).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { buildJobs } from '@/lib/state';
import { makeUser } from './helpers/http';

/** A user with one country on. The code is unique to each call, so no job of another file enters the list. */
async function userIn(cc: string) {
  const u = await makeUser();
  await db.countryPref.updateMany({ where: { userId: u.user.id }, data: { on: false } });
  await db.countryPref.create({ data: { userId: u.user.id, cc, rank: 0, on: true } });
  return u.user;
}

describe('the job card fields of the list', () => {
  it('gives the blocker line and the referral only to the user who has them', async () => {
    const id = randomBytes(4).toString('hex');
    const cc = `XJ${id}`;
    const company = `Acme ${id}`;
    const [a, b] = [await userIn(cc), await userIn(cc)];
    const job = await db.job.create({
      data: { externalId: `t:${id}`, source: 'test', role: 'Backend Engineer', company, city: 'Berlin', cc, url: 'https://example.com/j', postedAt: new Date('2026-10-10T08:00:00Z') },
    });
    // Only user A has a contact at the company, and only user A has a read job with a blocker.
    await db.contact.create({ data: { userId: a.id, firstName: 'Anna', lastName: 'Weber', company, position: 'Engineering Manager' } });
    const analysis = {
      requirements: [], blockers: [{ type: 'citizenship', quote: 'US citizens only' }], legitimacy: [],
      field: 'Backend', mode: 'Hybrid', level: 'Mid', sponsor: false, visa: '', summary: '', by: 'claude', promptVersion: 'test',
    };
    await db.jobAnalysis.create({ data: { userId: a.id, jobId: job.id, analysis: JSON.stringify(analysis), analysedAt: new Date() } });

    const cardA = (await buildJobs(a.id)).jobs.find((j) => j.id === job.id)!;
    expect(cardA.referrers).toBe(1);
    expect(cardA.referrer).toBe('Anna Weber');
    expect(cardA.blocker).toBe('Needs a work permit: “US citizens only”');

    const cardB = (await buildJobs(b.id)).jobs.find((j) => j.id === job.id)!;
    expect(cardB.referrers).toBe(0);
    expect(cardB.referrer).toBeNull();
    expect(cardB.blocker).toBeNull();
  });
});

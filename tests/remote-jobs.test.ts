import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { resolvePlace } from '@/lib/sources/geo';
import { keepInCountries, type RawJob } from '@/lib/sources';
import * as jobsList from '@/app/api/jobs/list/route';
import { ctx, makeUser, request } from './helpers/http';

describe('a remote job', () => {
  it('is remote only when its location says so', () => {
    expect(resolvePlace('Remote').remote).toBe(true);
    expect(resolvePlace('Remote - EU').remote).toBe(true);
    expect(resolvePlace('Bengaluru; Remote').remote).toBe(true);
    expect(resolvePlace('Berlin, Germany').remote).toBe(false);
    expect(resolvePlace('Remote').cc).toBe('');
  });

  it('stays after a refresh when its country is off or unknown', () => {
    const job = (cc: string, remote: boolean) => ({ cc, remote }) as RawJob;
    const kept = keepInCountries([job('IN', false), job('US', false), job('', true), job('DE', true)], ['IN']);
    expect(kept.map((j) => `${j.cc}:${j.remote}`)).toEqual(['IN:false', ':true', 'DE:true']);
  });

  it('shows in the job list in any country, and an office job of a country that is off does not', async () => {
    const u = await makeUser();
    const cc = `XT${randomBytes(2).toString('hex').toUpperCase()}`;
    const make = (remote: boolean) =>
      db.job.create({
        data: {
          externalId: `test:remote:${randomBytes(6).toString('hex')}`, source: 'Test', role: remote ? 'Remote Engineer' : 'Office Engineer',
          company: 'Remote Test Co', city: remote ? 'Remote' : 'Somewhere', cc, url: 'https://example.com/job', remote, mode: remote ? 'Remote' : 'On-site',
        },
      });
    const remoteJob = await make(true);
    const officeJob = await make(false);
    const res = await jobsList.GET(request('/api/jobs/list', { cookie: u.cookie }), ctx());
    const ids = ((await res.json()).jobs as { id: string; remote: boolean }[]).map((j) => j.id);
    expect(ids).toContain(remoteJob.id);
    expect(ids).not.toContain(officeJob.id);
  });
});

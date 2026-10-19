import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { jobView } from '@/lib/analysis';
import { fieldFit } from '@/lib/match';
import { saveSearchSettings } from '@/lib/settings';
import { makeUser } from './helpers/http';

async function robotJob() {
  return db.job.create({
    data: { externalId: `fit-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Robotics Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test', description: 'Motion planning and lidar.' },
  });
}

async function job(role: string, cc: string) {
  const row = await db.job.create({
    data: { externalId: `fit-${randomBytes(6).toString('hex')}`, source: 'Test', role: `${role} Engineer`, company: 'Acme', city: 'Berlin', cc, url: 'https://x.test', description: 'Build services.' },
  });
  return row;
}

describe('the field fit and the job hints use the settings of the user', () => {
  it('gives a neutral fit to a user with no settings and no claims', async () => {
    const { user } = await makeUser();
    const j = await job('Backend', 'DE');
    const view = await jobView(j, user.id);
    expect(view.analysis.parts.find((p) => p.kind === 'field')?.points).toBe(Math.round(40 * fieldFit('Backend', [])));
    expect(fieldFit('Backend', [])).toBe(0.3);
  });

  it('gives full fit to a field that the user saved', async () => {
    const { user } = await makeUser();
    await saveSearchSettings(user.id, { fields: ['Robotics'], visaStatus: '' });
    const view = await jobView(await robotJob(), user.id);
    expect(view.analysis.parts.find((p) => p.kind === 'field')?.points).toBe(40);
    const other = await jobView(await job('Backend', 'DE'), user.id);
    expect(other.analysis.parts.find((p) => p.kind === 'field')?.points).toBe(12);
  });

  it('adds no work authorisation or notice line for a user with no visa status', async () => {
    const { user } = await makeUser();
    for (const cc of ['DE', 'IN']) {
      const view = await jobView(await job('Backend', cc), user.id);
      expect(view.hints.must.join(' ')).not.toMatch(/authorisation|sponsorship|notice period/);
    }
  });

  it('uses the visa status of the user in the hint', async () => {
    const { user } = await makeUser();
    await saveSearchSettings(user.id, { fields: [], visaStatus: 'EU citizen' });
    const view = await jobView(await job('Backend', 'IN'), user.id);
    expect(view.hints.must).toContain('A work authorisation line: "EU citizen"');
    expect(view.hints.must.join(' ')).not.toContain('notice period');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

// The test must never call Claude. No credential, and a call fails.
vi.mock('@/lib/claude', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude')>()),
  credentialFor: vi.fn(async () => null),
  askJson: vi.fn(async () => { throw new Error('The test called Claude.'); }),
}));
// The request must never compile. The test records how the CV build is called.
vi.mock('@/lib/resume', async (orig) => ({
  ...(await orig<typeof import('@/lib/resume')>()),
  buildResume: vi.fn(async () => null),
}));
vi.mock('@/lib/cache', async (orig) => ({
  ...(await orig<typeof import('@/lib/cache')>()),
  askJsonCached: vi.fn(async () => { throw new Error('The test called Claude.'); }),
}));

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '@/lib/db';
import { buildResume } from '@/lib/resume';
import { BASE_CV_REASON } from '@/lib/cv';
import { POST as outreach } from '@/app/api/outreach/route';
import { ctx, makeUser, request } from './helpers/http';

async function alumniWithoutSchool(role: 'admin' | 'member') {
  const job = await db.job.create({
    data: { externalId: `out-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test' },
  });
  const { cookie } = await makeUser(role);
  const res = await outreach(request('/api/outreach', { method: 'POST', cookie, body: { jobId: job.id, action: 'alumni' } }), ctx());
  return { status: res.status, error: (await res.json()).error as string };
}

describe('POST /api/outreach alumni without a school', () => {
  it('tells a member to add an education in the profile', async () => {
    const res = await alumniWithoutSchool('member');
    expect(res.status).toBe(400);
    expect(res.error).toBe('No school on your profile. Add an education in your profile.');
  });

  it('gives the admin the same text', async () => {
    const res = await alumniWithoutSchool('admin');
    expect(res.status).toBe(400);
    expect(res.error).toBe('No school on your profile. Add an education in your profile.');
  });
});

describe('POST /api/outreach referral', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does not compile, and links the base PDF when the tailored PDF is not built', async () => {
    const tag = randomBytes(6).toString('hex');
    const company = `Referco ${tag}`;
    const job = await db.job.create({
      data: { externalId: `out-${tag}`, source: 'Test', role: 'Engineer', company, city: 'Berlin', cc: 'DE', url: 'https://x.test' },
    });
    const { user, cookie } = await makeUser('admin');
    await db.contact.create({ data: { userId: user.id, firstName: 'Ana', lastName: 'Ref', company, position: 'Engineer' } });
    const base = join(mkdtempSync(join(tmpdir(), 'refbase-')), 'base.pdf');
    writeFileSync(base, '%PDF-base');
    vi.stubEnv('RESUME_PDF', base);
    vi.mocked(buildResume).mockClear();
    vi.mocked(buildResume).mockResolvedValueOnce({ path: join(tmpdir(), `missing-${tag}.pdf`), tailored: true, lead: 'x', publicUrl: null, reason: null } as never);

    const res = await outreach(request('/api/outreach', { method: 'POST', cookie, body: { jobId: job.id, action: 'referral' } }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(buildResume).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildResume).mock.calls[0][4]).toMatchObject({ compile: false });
    expect(body.resume).toMatchObject({ path: base, tailored: false, reason: BASE_CV_REASON });
    const app = await db.application.findFirstOrThrow({ where: { userId: user.id, jobId: job.id } });
    expect(app.cvPath).toBe(base);
  });
});

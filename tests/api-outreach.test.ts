import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

// No claims.yml for any user (the admin too), so the profile comes from the
// database only. lib/user calls loadClaims inside its own module, so the mock
// must replace loadClaims in lib/claims.
vi.mock('@/lib/claims', async (orig) => ({
  ...(await orig<typeof import('@/lib/claims')>()),
  loadClaims: vi.fn(() => null),
}));
// The test must never call Claude. No credential, and a call fails.
vi.mock('@/lib/claude', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude')>()),
  credentialFor: vi.fn(async () => null),
  askJson: vi.fn(async () => { throw new Error('The test called Claude.'); }),
}));
vi.mock('@/lib/cache', async (orig) => ({
  ...(await orig<typeof import('@/lib/cache')>()),
  askJsonCached: vi.fn(async () => { throw new Error('The test called Claude.'); }),
}));

import { db } from '@/lib/db';
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

  it('keeps the claims.yml text for the admin', async () => {
    const res = await alumniWithoutSchool('admin');
    expect(res.status).toBe(400);
    expect(res.error).toBe('No school on your profile. Add an education to claims.yml or import your LinkedIn export.');
  });
});

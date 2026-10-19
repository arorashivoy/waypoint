import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/claude', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude')>()),
  credentialFor: vi.fn(async () => ({ kind: 'api', key: 'k', source: 'own' }) as never),
}));
vi.mock('@/lib/sources', async (orig) => ({ ...(await orig<typeof import('@/lib/sources')>()), fetchAll: vi.fn() }));

import { db } from '@/lib/db';
import { fetchAll } from '@/lib/sources';
import { queueAnalysis } from '@/lib/queue';
import { enqueue } from '@/lib/tasks/queue';
import { runOnce } from '@/lib/tasks/worker';
import '@/lib/tasks/handlers';
import * as pasteRoute from '@/app/api/jobs/paste/route';
import * as jobRoute from '@/app/api/jobs/[id]/route';
import * as jobResume from '@/app/api/jobs/[id]/resume/route';
import * as stateRoute from '@/app/api/state/route';
import * as outreachRoute from '@/app/api/outreach/route';
import { DELETE as deleteAccount } from '@/app/api/account/route';
import { ctx, makeUser, request, TEST_PASSWORD } from './helpers/http';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '18.205.1.1', family: 4 }] as never);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type U = Awaited<ReturnType<typeof makeUser>>;

/** User A pastes a Greenhouse job in Germany. Returns the job row. */
async function pasteAs(u: U) {
  const company = `zz${randomBytes(5).toString('hex')}`;
  const id = 5_000_000 + Math.floor(Math.random() * 1e6);
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ id, title: 'Backend Engineer', absolute_url: 'https://boards.greenhouse.io/x/jobs/1', location: { name: 'Berlin, Germany' }, content: 'Build Java services.', company_name: 'Acme Test' })),
  );
  const res = await pasteRoute.POST(request('/api/jobs/paste', { method: 'POST', cookie: u.cookie, body: { url: `https://boards.greenhouse.io/${company}/jobs/${id}` } }), ctx());
  await runOnce(new Date(), { userId: u.user.id });
  const job = await db.job.findUniqueOrThrow({ where: { externalId: `greenhouse:${company}:${id}` } });
  expect(res.status).toBe(200);
  return job;
}

const listed = async (u: U) => ((await (await stateRoute.GET(request('/api/state', { cookie: u.cookie }), ctx())).json()).jobs as { id: string }[]).map((j) => j.id);

describe('a pasted job belongs to the user who pasted it', () => {
  it('shows it only to that user and queues no analysis for another user', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const job = await pasteAs(a);
    expect(job.pastedBy).toBe(a.user.id);

    expect(await listed(a)).toContain(job.id);
    expect(await listed(b)).not.toContain(job.id);

    const detail = (u: U) => jobRoute.GET(request(`/api/jobs/${job.id}`, { cookie: u.cookie }), ctx({ id: job.id }));
    expect((await detail(a)).status).toBe(200);
    expect((await detail(b)).status).toBe(404);
    expect((await jobRoute.POST(request(`/api/jobs/${job.id}`, { method: 'POST', cookie: b.cookie, body: { reanalyse: true } }), ctx({ id: job.id }))).status).toBe(404);
    expect((await jobRoute.PATCH(request(`/api/jobs/${job.id}`, { method: 'PATCH', cookie: b.cookie, body: { applied: true } }), ctx({ id: job.id }))).status).toBe(404);
    expect((await jobResume.POST(request(`/api/jobs/${job.id}/resume`, { method: 'POST', cookie: b.cookie, body: {} }), ctx({ id: job.id }))).status).toBe(404);
    expect((await outreachRoute.POST(request('/api/outreach', { method: 'POST', cookie: b.cookie, body: { jobId: job.id, action: 'referral' } }), ctx())).status).toBe(404);
    expect(await db.application.count({ where: { userId: b.user.id, jobId: job.id } })).toBe(0);

    // A task for another user's pasted job does nothing.
    const { id } = await enqueue({ kind: 'analysis', userId: b.user.id, payload: { jobId: job.id } });
    await runOnce(new Date(), { userId: b.user.id });
    expect(JSON.parse((await db.task.findUniqueOrThrow({ where: { id } })).result!)).toEqual({ skipped: 'gone' });

    await queueAnalysis(b.user.id);
    expect(await db.task.count({ where: { userId: b.user.id, dedupeKey: `analysis:${b.user.id}:${job.id}` } })).toBe(0);
    await queueAnalysis(a.user.id);
    expect(await db.task.count({ where: { userId: a.user.id, dedupeKey: `analysis:${a.user.id}:${job.id}` } })).toBe(1);

  });

  it('keeps the owner when another user pastes the same job', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const job = await pasteAs(a);
    const [, company, id] = job.externalId.split(':');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: Number(id), title: 'Backend Engineer', absolute_url: 'https://boards.greenhouse.io/x/jobs/1', location: { name: 'Berlin, Germany' }, content: 'x' })));
    await pasteRoute.POST(request('/api/jobs/paste', { method: 'POST', cookie: b.cookie, body: { url: `https://boards.greenhouse.io/${company}/jobs/${id}` } }), ctx());
    await runOnce(new Date(), { userId: b.user.id });
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).pastedBy).toBe(a.user.id);
  });

  it('becomes a feed job when a refresh brings the same job', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const job = await pasteAs(a);
    vi.mocked(fetchAll).mockResolvedValueOnce({
      jobs: [{ externalId: job.externalId, source: 'Greenhouse', role: job.role, company: job.company, city: job.city, cc: job.cc, url: job.url, mode: job.mode, field: job.field, level: job.level, sponsor: job.sponsor, visa: job.visa, description: job.description, postedAt: new Date(), priority: false }],
      report: [],
      commit: async () => {},
    } as never);
    await enqueue({ kind: 'refresh', userId: b.user.id, payload: { force: true } });
    await runOnce(new Date(), { userId: b.user.id });
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).pastedBy).toBeNull();
    expect(await listed(b)).toContain(job.id);
    expect(await listed(a)).toContain(job.id);
  });
});

describe('account delete and pasted jobs', () => {
  const del = (u: U) => deleteAccount(request('/api/account', { method: 'DELETE', cookie: u.cookie, body: { password: TEST_PASSWORD } }), ctx());

  it('deletes a pasted job that nobody else uses', async () => {
    const a = await makeUser();
    const job = await pasteAs(a);
    expect((await del(a)).status).toBe(200);
    expect(await db.job.count({ where: { id: job.id } })).toBe(0);
  });

  it('keeps a pasted job that another user has an application for, as a feed job', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const job = await pasteAs(a);
    await db.application.create({ data: { userId: b.user.id, jobId: job.id } });
    expect((await del(a)).status).toBe(200);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).pastedBy).toBeNull();
  });
});

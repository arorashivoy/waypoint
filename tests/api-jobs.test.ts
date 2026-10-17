import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

vi.mock('@/lib/cv', async (orig) => {
  const real = await orig<typeof import('@/lib/cv')>();
  return { ...real, publishCv: vi.fn(real.publishCv), refineCv: vi.fn(real.refineCv) };
});

vi.mock('@/lib/claude', async (orig) => {
  const real = await orig<typeof import('@/lib/claude')>();
  return { ...real, credentialFor: vi.fn(real.credentialFor) };
});

vi.mock('@/lib/analysis', async (orig) => {
  const real = await orig<typeof import('@/lib/analysis')>();
  return { ...real, analyseJob: vi.fn(async () => ({}) as never) };
});

import { db } from '@/lib/db';
import { analyseJob } from '@/lib/analysis';
import { CvError, publishCv, refineCv } from '@/lib/cv';
import { NoCredentialError, credentialFor } from '@/lib/claude';
import * as jobDetail from '@/app/api/jobs/[id]/route';
import * as jobResume from '@/app/api/jobs/[id]/resume/route';
import * as refreshRoute from '@/app/api/jobs/refresh/route';
import { runOnce } from '@/lib/tasks/worker';
import '@/lib/tasks/handlers';
import * as refine from '@/app/api/jobs/[id]/resume/refine/route';
import { ctx, makeUser, request } from './helpers/http';

async function newJob() {
  return db.job.create({
    data: { externalId: `jobs-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('job routes with an unknown job ID', () => {
  const id = 'no-such-job';

  it('GET /api/jobs/[id] is 404', async () => {
    const { cookie } = await makeUser();
    const res = await jobDetail.GET(request(`/api/jobs/${id}`, { cookie }), ctx({ id }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found.' });
  });

  it('PATCH /api/jobs/[id] is 404', async () => {
    const { cookie } = await makeUser();
    const res = await jobDetail.PATCH(request(`/api/jobs/${id}`, { method: 'PATCH', cookie, body: { applied: true } }), ctx({ id }));
    expect(res.status).toBe(404);
  });

  it('POST /api/jobs/[id]/resume is 404', async () => {
    const { cookie } = await makeUser();
    const res = await jobResume.POST(request(`/api/jobs/${id}/resume`, { method: 'POST', cookie }), ctx({ id }));
    expect(res.status).toBe(404);
  });

  it('POST and DELETE /api/jobs/[id]/resume/refine are 404', async () => {
    const { cookie } = await makeUser();
    expect((await refine.POST(request(`/api/jobs/${id}/resume/refine`, { method: 'POST', cookie, body: { message: 'x' } }), ctx({ id }))).status).toBe(404);
    expect((await refine.DELETE(request(`/api/jobs/${id}/resume/refine`, { method: 'DELETE', cookie }), ctx({ id }))).status).toBe(404);
  });
});

describe('the cv task sends user errors and retries faults', () => {
  async function runRefine() {
    const job = await newJob();
    const { cookie, user } = await makeUser();
    const res = await refine.POST(request(`/api/jobs/${job.id}/resume/refine`, { method: 'POST', cookie, body: { message: 'x' } }), ctx({ id: job.id }));
    const { taskId } = await res.json();
    await runOnce(undefined, { userId: user.id });
    return db.task.findUniqueOrThrow({ where: { id: taskId } });
  }

  it('a CvError fails the task at once with its own message', async () => {
    vi.mocked(refineCv).mockRejectedValueOnce(new CvError('Write what to change.'));
    expect(await runRefine()).toMatchObject({ status: 'failed', lastError: '[user] Write what to change.' });
  });

  it('no Claude credential fails the task at once with the Settings message', async () => {
    vi.mocked(refineCv).mockRejectedValueOnce(new NoCredentialError());
    expect(await runRefine()).toMatchObject({ status: 'failed', lastError: '[user] Add an API key in Settings to use Claude.' });
  });

  it('a fault in refine is retried', async () => {
    vi.mocked(refineCv).mockRejectedValueOnce(new Error('ENOENT /home/shivoy/secret.tex'));
    expect((await runRefine()).status).toBe('queued');
  });

  it('a fault in the CV build is retried', async () => {
    const job = await newJob();
    const { cookie, user } = await makeUser();
    vi.mocked(publishCv).mockRejectedValueOnce(new Error('latexmk failed in /home/shivoy/build'));
    const { taskId } = await (await jobResume.POST(request(`/api/jobs/${job.id}/resume`, { method: 'POST', cookie }), ctx({ id: job.id }))).json();
    await runOnce(undefined, { userId: user.id });
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('queued');
  });
});

describe('a new analysis needs a POST', () => {
  /** A job that user `userId` already has an analysis for. */
  async function analysedJob(userId: string) {
    const job = await newJob();
    await db.jobAnalysis.create({ data: { userId, jobId: job.id, analysis: '{}', analysedAt: new Date() } });
    return job;
  }

  it('GET ignores ?reanalyse=1, so a link from another site cannot spend Claude credit', async () => {
    const { user, cookie } = await makeUser();
    const job = await analysedJob(user.id);
    vi.mocked(analyseJob).mockClear();
    const res = await jobDetail.GET(request(`/api/jobs/${job.id}?reanalyse=1`, { cookie }), ctx({ id: job.id }));
    expect(res.status).toBe(200);
    expect(analyseJob).not.toHaveBeenCalled();
  });

  it('POST { reanalyse: true } queues a forced analysis task; the worker runs it, not the request', async () => {
    const { user, cookie } = await makeUser();
    const job = await analysedJob(user.id);
    vi.mocked(analyseJob).mockClear();
    const res = await jobDetail.POST(request(`/api/jobs/${job.id}`, { method: 'POST', cookie, body: { reanalyse: true } }), ctx({ id: job.id }));
    expect(res.status).toBe(200);
    const { taskId } = await res.json();
    expect(analyseJob).not.toHaveBeenCalled();
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row).toMatchObject({ kind: 'analysis', userId: user.id, dedupeKey: `analysis:${user.id}:${job.id}` });
    expect(JSON.parse(row.payload)).toEqual({ jobId: job.id, force: true });
    vi.mocked(credentialFor).mockResolvedValueOnce({ kind: 'api', key: 'k', source: 'own' });
    await runOnce(undefined, { userId: user.id });
    expect(analyseJob).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }), user.id, true);
  });

  it('GET of a job with no analysis queues one task and never calls Claude', async () => {
    const { user, cookie } = await makeUser();
    const job = await newJob();
    vi.mocked(analyseJob).mockClear();
    const open = async () => {
      vi.mocked(credentialFor).mockResolvedValueOnce({ kind: 'api', key: 'k', source: 'own' });
      const res = await jobDetail.GET(request(`/api/jobs/${job.id}`, { cookie }), ctx({ id: job.id }));
      expect(res.status).toBe(200);
      return (await res.json()).analysing as string;
    };
    const taskId = await open();
    expect(typeof taskId).toBe('string');
    expect(await open()).toBe(taskId);
    expect(analyseJob).not.toHaveBeenCalled();
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row).toMatchObject({ kind: 'analysis', userId: user.id, dedupeKey: `analysis:${user.id}:${job.id}` });
    expect(JSON.parse(row.payload)).toEqual({ jobId: job.id });
  });

  it('GET of an analysed job, or with no credential, queues nothing', async () => {
    const { user, cookie } = await makeUser();
    const done = await analysedJob(user.id);
    const res = await jobDetail.GET(request(`/api/jobs/${done.id}`, { cookie }), ctx({ id: done.id }));
    expect((await res.json()).analysing).toBeNull();
    const fresh = await newJob();
    vi.mocked(credentialFor).mockResolvedValueOnce(null);
    const res2 = await jobDetail.GET(request(`/api/jobs/${fresh.id}`, { cookie }), ctx({ id: fresh.id }));
    expect((await res2.json()).analysing).toBeNull();
    expect(await db.task.count({ where: { userId: user.id, kind: 'analysis' } })).toBe(0);
  });

  it('POST without { reanalyse: true } is 400', async () => {
    const { user, cookie } = await makeUser();
    const job = await analysedJob(user.id);
    const res = await jobDetail.POST(request(`/api/jobs/${job.id}`, { method: 'POST', cookie, body: {} }), ctx({ id: job.id }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/jobs/refresh', () => {
  it('returns a taskId, and a second POST returns the same taskId', async () => {
    const { cookie, user } = await makeUser();
    const first = await refreshRoute.POST(request('/api/jobs/refresh', { method: 'POST', cookie, body: { force: true } }), ctx());
    expect(first.status).toBe(200);
    const { taskId } = await first.json();
    expect(typeof taskId).toBe('string');
    const second = await refreshRoute.POST(request('/api/jobs/refresh', { method: 'POST', cookie }), ctx());
    expect((await second.json()).taskId).toBe(taskId);
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row).toMatchObject({ kind: 'refresh', userId: user.id, dedupeKey: `refresh:${user.id}` });
    expect(JSON.parse(row.payload)).toEqual({ force: true });
  });

  it('the worker runs the refresh and returns the result', async () => {
    const { cookie, user } = await makeUser();
    // The refresh covers the countries of all users, so a stub keeps the test off the network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404, statusText: 'Not Found' })));
    const res = await refreshRoute.POST(request('/api/jobs/refresh', { method: 'POST', cookie }), ctx());
    const { taskId } = await res.json();
    await runOnce(undefined, { userId: user.id });
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.status).toBe('done');
    expect(JSON.parse(row.result!)).toHaveProperty('report');
  });

  it('a user with every country off gets the paused note and no fetch', async () => {
    await makeUser(); // another user, with the default countries on
    const { cookie, user } = await makeUser();
    await db.countryPref.updateMany({ where: { userId: user.id }, data: { on: false } });
    const fetchMock = vi.fn(async () => new Response('no', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const { taskId } = await (await refreshRoute.POST(request('/api/jobs/refresh', { method: 'POST', cookie }), ctx())).json();
    await runOnce(undefined, { userId: user.id });
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.status).toBe('done');
    expect(JSON.parse(row.result!)).toMatchObject({ added: 0, total: 0, report: [], note: 'Every country is paused.' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.task.count({ where: { userId: user.id, kind: 'analysis' } })).toBe(0);
  });

  it('refuses a force value that is not a boolean', async () => {
    const { cookie } = await makeUser();
    const res = await refreshRoute.POST(request('/api/jobs/refresh', { method: 'POST', cookie, body: { force: 'yes' } }), ctx());
    expect(res.status).toBe(400);
  });
});

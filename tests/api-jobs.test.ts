import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

vi.mock('@/lib/cv', async (orig) => {
  const real = await orig<typeof import('@/lib/cv')>();
  return { ...real, publishCv: vi.fn(real.publishCv), refineCv: vi.fn(real.refineCv) };
});

vi.mock('@/lib/analysis', async (orig) => {
  const real = await orig<typeof import('@/lib/analysis')>();
  return { ...real, analyseJob: vi.fn(async () => ({}) as never) };
});

import { db } from '@/lib/db';
import { analyseJob } from '@/lib/analysis';
import { CvError, publishCv, refineCv } from '@/lib/cv';
import { NoCredentialError } from '@/lib/claude';
import * as jobDetail from '@/app/api/jobs/[id]/route';
import * as jobResume from '@/app/api/jobs/[id]/resume/route';
import * as refine from '@/app/api/jobs/[id]/resume/refine/route';
import { ctx, makeUser, request } from './helpers/http';

const GENERIC = { error: 'Something went wrong. The server log has the details.' };

async function newJob() {
  return db.job.create({
    data: { externalId: `jobs-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test' },
  });
}

afterEach(() => vi.restoreAllMocks());

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

describe('job routes send user errors and hide faults', () => {
  it('a CvError is 400 with its own message', async () => {
    const job = await newJob();
    const { cookie } = await makeUser();
    vi.mocked(refineCv).mockRejectedValueOnce(new CvError('Write what to change.'));
    const res = await refine.POST(request(`/api/jobs/${job.id}/resume/refine`, { method: 'POST', cookie, body: { message: '' } }), ctx({ id: job.id }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Write what to change.' });
  });

  it('no Claude credential is 409 with the Settings message', async () => {
    const job = await newJob();
    const { cookie } = await makeUser();
    vi.mocked(refineCv).mockRejectedValueOnce(new NoCredentialError());
    const res = await refine.POST(request(`/api/jobs/${job.id}/resume/refine`, { method: 'POST', cookie, body: { message: 'x' } }), ctx({ id: job.id }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Add an API key in Settings to use Claude.' });
  });

  it('a fault in refine is a 500 without the raw text', async () => {
    const job = await newJob();
    const { cookie } = await makeUser();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(refineCv).mockRejectedValueOnce(new Error('ENOENT /home/shivoy/secret.tex'));
    const res = await refine.POST(request(`/api/jobs/${job.id}/resume/refine`, { method: 'POST', cookie, body: { message: 'x' } }), ctx({ id: job.id }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(GENERIC);
  });

  it('a fault in the CV build is a 500 without the raw text', async () => {
    const job = await newJob();
    const { cookie } = await makeUser();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(publishCv).mockRejectedValueOnce(new Error('latexmk failed in /home/shivoy/build'));
    const res = await jobResume.POST(request(`/api/jobs/${job.id}/resume`, { method: 'POST', cookie }), ctx({ id: job.id }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(GENERIC);
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

  it('POST { reanalyse: true } runs a new analysis and sends the job', async () => {
    const { user, cookie } = await makeUser();
    const job = await analysedJob(user.id);
    vi.mocked(analyseJob).mockClear();
    const res = await jobDetail.POST(request(`/api/jobs/${job.id}`, { method: 'POST', cookie, body: { reanalyse: true } }), ctx({ id: job.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(job.id);
    expect(analyseJob).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }), user.id, true);
  });

  it('POST without { reanalyse: true } is 400', async () => {
    const { user, cookie } = await makeUser();
    const job = await analysedJob(user.id);
    const res = await jobDetail.POST(request(`/api/jobs/${job.id}`, { method: 'POST', cookie, body: {} }), ctx({ id: job.id }));
    expect(res.status).toBe(400);
  });
});

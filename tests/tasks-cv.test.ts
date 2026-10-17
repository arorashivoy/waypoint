import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

vi.mock('@/lib/cv', async (orig) => {
  const real = await orig<typeof import('@/lib/cv')>();
  return { ...real, publishCv: vi.fn(), refineCv: vi.fn(real.refineCv) };
});
vi.mock('@/lib/resume', async (orig) => {
  const real = await orig<typeof import('@/lib/resume')>();
  return { ...real, buildResume: vi.fn(async () => null) };
});

import { db } from '@/lib/db';
import { NO_RESUME, buildCv, publishCv, refineCv, CvError } from '@/lib/cv';
import { buildResume } from '@/lib/resume';
import { usersRoot } from '@/lib/user-files';
import { runOnce } from '@/lib/tasks/worker';
import '@/lib/tasks/handlers';
import * as jobResume from '@/app/api/jobs/[id]/resume/route';
import * as refine from '@/app/api/jobs/[id]/resume/refine/route';
import * as resumeFile from '@/app/api/resume/[id]/route';
import { ctx, makeUser, request } from './helpers/http';

async function newJob() {
  return db.job.create({
    data: { externalId: `cv-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test' },
  });
}
const taskOf = (id: string) => db.task.findUniqueOrThrow({ where: { id } });

beforeEach(() => {
  vi.mocked(publishCv).mockReset();
  vi.mocked(buildResume).mockClear();
});

describe('POST /api/jobs/[id]/resume', () => {
  it('returns a taskId; a second POST returns the same one', async () => {
    const { cookie, user } = await makeUser();
    const job = await newJob();
    const go = () => jobResume.POST(request(`/api/jobs/${job.id}/resume`, { method: 'POST', cookie }), ctx({ id: job.id }));
    const { taskId } = await (await go()).json();
    expect(typeof taskId).toBe('string');
    expect((await (await go()).json()).taskId).toBe(taskId);
    const row = await taskOf(taskId);
    expect(row).toMatchObject({ kind: 'cv', userId: user.id, dedupeKey: `cv:${user.id}:${job.id}` });
    expect(JSON.parse(row.payload)).toEqual({ jobId: job.id, action: 'generate' });
  });
});

describe('the cv handler', () => {
  it('stores the view', async () => {
    const { cookie, user } = await makeUser('admin');
    const job = await newJob();
    vi.mocked(publishCv).mockResolvedValue({
      resume: { path: '/x.pdf', tailored: true, lead: 'p1', order: ['p1'], experience: [], skillsLead: [] } as never,
      driveUrl: 'https://drive.test/f',
      driveReason: null,
    });
    const { taskId } = await (await jobResume.POST(request(`/api/jobs/${job.id}/resume`, { method: 'POST', cookie }), ctx({ id: job.id }))).json();
    await runOnce(undefined, { userId: user.id });
    const row = await taskOf(taskId);
    expect(row.status).toBe('done');
    const app = await db.application.findUniqueOrThrow({ where: { userId_jobId: { userId: user.id, jobId: job.id } } });
    expect(JSON.parse(row.result!)).toMatchObject({ pdfUrl: `/api/resume/${app.id}`, driveUrl: 'https://drive.test/f', tailored: true, lead: 'p1' });
  });

  it('a missing CV fails the task at once with the NO_RESUME text', async () => {
    const { cookie, user } = await makeUser();
    const job = await newJob();
    vi.mocked(publishCv).mockResolvedValue({ resume: null, driveUrl: null, driveReason: NO_RESUME });
    const { taskId } = await (await jobResume.POST(request(`/api/jobs/${job.id}/resume`, { method: 'POST', cookie }), ctx({ id: job.id }))).json();
    await runOnce(undefined, { userId: user.id });
    const row = await taskOf(taskId);
    expect(row).toMatchObject({ status: 'failed', lastError: NO_RESUME });
  });

  it('a user-facing error from refine is final; a fault is retried', async () => {
    const { cookie, user } = await makeUser('admin');
    const job = await newJob();
    const start = async () =>
      (await (await refine.POST(request(`/api/jobs/${job.id}/resume/refine`, { method: 'POST', cookie, body: { message: 'x' } }), ctx({ id: job.id }))).json()).taskId as string;
    vi.mocked(refineCv).mockRejectedValueOnce(new CvError('Type what to change first.'));
    const a = await taskOf(await start().then(async (id) => (await runOnce(undefined, { userId: user.id }), id)));
    expect(a).toMatchObject({ status: 'failed', lastError: 'Type what to change first.' });
    vi.mocked(refineCv).mockRejectedValueOnce(new Error('boom'));
    const b = await taskOf(await start().then(async (id) => (await runOnce(undefined, { userId: user.id }), id)));
    expect(b.status).toBe('queued');
  });
});

describe('refine', () => {
  it('keeps the message in the payload, and refuses more than 2000 characters', async () => {
    const { cookie } = await makeUser();
    const job = await newJob();
    const url = `/api/jobs/${job.id}/resume/refine`;
    const message = 'a'.repeat(2000);
    const ok = await refine.POST(request(url, { method: 'POST', cookie, body: { message } }), ctx({ id: job.id }));
    expect(ok.status).toBe(200);
    const row = await taskOf((await ok.json()).taskId);
    expect(JSON.parse(row.payload)).toEqual({ jobId: job.id, action: 'refine', message });
    const long = await refine.POST(request(url, { method: 'POST', cookie, body: { message: message + 'a' } }), ctx({ id: job.id }));
    expect(long.status).toBe(400);
  });

  it('DELETE queues a reset task with the same dedupe key', async () => {
    const { cookie, user } = await makeUser();
    const job = await newJob();
    const res = await refine.DELETE(request(`/api/jobs/${job.id}/resume/refine`, { method: 'DELETE', cookie }), ctx({ id: job.id }));
    const row = await taskOf((await res.json()).taskId);
    expect(row.dedupeKey).toBe(`cv:${user.id}:${job.id}`);
    expect(JSON.parse(row.payload)).toEqual({ jobId: job.id, action: 'reset' });
  });
});

describe('the PDF folder', () => {
  it('is inside the folder of the user, and the build does not compile in the request', async () => {
    const { user } = await makeUser('admin');
    const job = await newJob();
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id } });
    await buildCv(app, job);
    expect(buildResume).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(buildResume).mock.calls[0][4];
    expect(opts?.outDir).toBe(join(usersRoot(), user.id, 'resumes'));
    expect(opts?.compile).not.toBe(false); // the worker compiles by default
    await buildCv(app, job, { compile: false });
    expect(vi.mocked(buildResume).mock.calls[1][4]).toMatchObject({ compile: false });
  });

  it('another user cannot read the PDF', async () => {
    const a = await makeUser('admin');
    const b = await makeUser('admin');
    const job = await newJob();
    const app = await db.application.create({ data: { userId: a.user.id, jobId: job.id } });
    const res = await resumeFile.GET(request(`/api/resume/${app.id}`, { cookie: b.cookie }), ctx({ id: app.id }));
    expect(res.status).toBe(404);
  });

  it('the owner gets 404 "not built yet" when the file does not exist', async () => {
    const a = await makeUser('admin');
    const job = await newJob();
    const app = await db.application.create({ data: { userId: a.user.id, jobId: job.id } });
    vi.mocked(buildResume).mockResolvedValueOnce({ path: join(usersRoot(), a.user.id, 'resumes', 'none.pdf'), tailored: true } as never);
    const res = await resumeFile.GET(request(`/api/resume/${app.id}`, { cookie: a.cookie }), ctx({ id: app.id }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'The CV is not built yet. Build it first.' });
  });
});

import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analysis', async (orig) => {
  const real = await orig<typeof import('@/lib/analysis')>();
  return { ...real, analyseJob: vi.fn(async () => ({}) as never) };
});
vi.mock('@/lib/claude', async (orig) => {
  const real = await orig<typeof import('@/lib/claude')>();
  return { ...real, credentialFor: vi.fn(async () => ({ kind: 'api', key: 'k', source: 'own' }) as never), claudeStatus: vi.fn() };
});

import { db } from '@/lib/db';
import { analyseJob } from '@/lib/analysis';
import { claudeStatus, credentialFor } from '@/lib/claude';
import { analysisProgress, queueAnalysis } from '@/lib/queue';
import { enqueue } from '@/lib/tasks/queue';
import { runOnce } from '@/lib/tasks/worker';
import '@/lib/tasks/handlers';
import { makeUser } from './helpers/http';

async function newJob(cc: string) {
  return db.job.create({
    data: { externalId: `an-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Software Engineer', company: 'Acme', city: 'Berlin', cc, url: 'https://x.test' },
  });
}

// A country code of its own keeps the jobs of other test files out of the selection.
async function setup(jobs = 3) {
  const { user } = await makeUser();
  const cc = randomBytes(1).toString('hex').toUpperCase();
  await db.countryPref.create({ data: { userId: user.id, cc, on: true, rank: 0 } });
  const made = [];
  for (let i = 0; i < jobs; i++) made.push(await newJob(cc));
  return { userId: user.id, jobs: made };
}
const tasks = (userId: string) => db.task.findMany({ where: { userId, kind: 'analysis' }, orderBy: { createdAt: 'asc' } });

beforeEach(() => {
  vi.mocked(analyseJob).mockClear();
  vi.mocked(credentialFor).mockResolvedValue({ kind: 'api', key: 'k', source: 'own' } as never);
});

describe('analysis through the queue', () => {
  it('queueAnalysis makes one task per job and no duplicates', async () => {
    const { userId } = await setup(3);
    const first = await queueAnalysis(userId);
    const n = first.total;
    expect(n).toBeGreaterThan(0);
    await queueAnalysis(userId);
    expect(await tasks(userId)).toHaveLength(n);
  });

  it('analysisProgress counts the latest batch', async () => {
    const { userId, jobs } = await setup(3);
    const batch = 'b1';
    const ids: string[] = [];
    for (const j of jobs) ids.push((await enqueue({ kind: 'analysis', userId, payload: { jobId: j.id, batch } })).id);
    await db.task.update({ where: { id: ids[0] }, data: { status: 'done' } });
    await db.task.update({ where: { id: ids[1] }, data: { status: 'failed' } });
    expect(await analysisProgress(userId)).toEqual({ running: true, done: 2, total: 3, failed: 1 });
  });

  it('the handler runs analyseJob', async () => {
    const { userId, jobs } = await setup(1);
    const { id } = await enqueue({ kind: 'analysis', userId, payload: { jobId: jobs[0].id, batch: 'b' } });
    await runOnce(undefined, { userId });
    expect(analyseJob).toHaveBeenCalledWith(expect.objectContaining({ id: jobs[0].id }), userId);
    expect((await db.task.findUniqueOrThrow({ where: { id } })).status).toBe('done');
  });

  it('the handler skips a job that is gone', async () => {
    const { userId } = await setup(0);
    const { id } = await enqueue({ kind: 'analysis', userId, payload: { jobId: 'gone', batch: 'b' } });
    await runOnce(undefined, { userId });
    const row = await db.task.findUniqueOrThrow({ where: { id } });
    expect(JSON.parse(row.result!)).toEqual({ skipped: 'gone' });
    expect(analyseJob).not.toHaveBeenCalled();
  });

  it('a cap error defers the task to the reset date', async () => {
    const { userId, jobs } = await setup(1);
    const resetsAt = '2026-11-01T00:00:00.000Z';
    vi.mocked(credentialFor).mockResolvedValue(null);
    vi.mocked(claudeStatus).mockResolvedValue({ capReached: true, resetsAt } as never);
    const { id } = await enqueue({ kind: 'analysis', userId, payload: { jobId: jobs[0].id, batch: 'b' } });
    await runOnce(undefined, { userId });
    const row = await db.task.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(1);
    expect(row.runAt.toISOString()).toBe(resetsAt);
  });

  it('no credential and no cap skips the task', async () => {
    const { userId, jobs } = await setup(1);
    vi.mocked(credentialFor).mockResolvedValue(null);
    vi.mocked(claudeStatus).mockResolvedValue({ capReached: false, resetsAt: 'x' } as never);
    const { id } = await enqueue({ kind: 'analysis', userId, payload: { jobId: jobs[0].id, batch: 'b' } });
    await runOnce(undefined, { userId });
    expect(JSON.parse((await db.task.findUniqueOrThrow({ where: { id } })).result!)).toEqual({ skipped: 'no-credential' });
  });

  it('no credential means no tasks', async () => {
    const { userId } = await setup(3);
    vi.mocked(credentialFor).mockResolvedValue(null);
    expect(await queueAnalysis(userId)).toEqual({ running: false, done: 0, total: 0, failed: 0 });
    expect(await tasks(userId)).toHaveLength(0);
  });
});

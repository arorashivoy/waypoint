import { randomBytes, randomInt } from 'node:crypto';
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

// makeUser turns on every real country, so the code must be one no country uses.
// The X range is for user-assigned codes: X plus one random letter A-Z.
async function setup(jobs = 3) {
  const { user } = await makeUser();
  const cc = `X${String.fromCharCode(65 + randomInt(26))}`;
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
    expect(first.total).toBeGreaterThan(0);
    // Other test files add jobs to the shared database, so the second call can
    // add tasks for those. The check looks only at the jobs of the first call.
    const jobIdOf = (row: { payload: string }) => (JSON.parse(row.payload) as { jobId: string }).jobId;
    const firstJobIds = (await tasks(userId)).map(jobIdOf);
    await queueAnalysis(userId);
    const jobIds = (await tasks(userId)).map(jobIdOf);
    expect(new Set(jobIds).size).toBe(jobIds.length);
    for (const jobId of firstJobIds) expect(jobIds.filter((id) => id === jobId)).toHaveLength(1);
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
    expect(analyseJob).toHaveBeenCalledWith(expect.objectContaining({ id: jobs[0].id }), userId, false);
    expect(await db.task.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'done', lastError: null });
  });

  it('analysisProgress does not count a task of the job screen (no batch)', async () => {
    const { userId, jobs } = await setup(2);
    await enqueue({ kind: 'analysis', userId, payload: { jobId: jobs[0].id, batch: 'b2' } });
    await enqueue({ kind: 'analysis', userId, payload: { jobId: jobs[1].id } });
    expect(await analysisProgress(userId)).toEqual({ running: true, done: 0, total: 1, failed: 0 });
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

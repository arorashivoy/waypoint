import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

vi.mock('@/lib/claude', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude')>()),
  claudeStatus: vi.fn(async () => ({ mode: 'own', detail: '' })),
}));
vi.mock('@/lib/cache', async (orig) => ({ ...(await orig<typeof import('@/lib/cache')>()), askJsonCached: vi.fn() }));

import { db } from '@/lib/db';
import type { ClaimsDoc } from '@/lib/claims';
import { askJsonCached } from '@/lib/cache';
import { claudeStatus } from '@/lib/claude';
import { cvView, readSteer, refineCv, resetCv, writeCv } from '@/lib/cv';
import { saveProfile } from '@/lib/profile/store';
import * as suggestions from '@/app/api/jobs/[id]/resume/suggestions/route';
import * as jobResume from '@/app/api/jobs/[id]/resume/route';
import { runOnce } from '@/lib/tasks/worker';
import '@/lib/tasks/handlers';
import { ctx, makeUser, request } from './helpers/http';

const doc: ClaimsDoc = {
  version: 1,
  profile: { name: 'Test Person', headline: 'Engineer' },
  targets: {
    positions: [{ id: 'goldman', title: 'Analyst', company: 'Goldman Sachs', start: '2024', bullets: [{ id: 'validator', match: 'Python validator', text: 'Built a Python validator for remediation updates' }] }],
    projects: [{ id: 'claude-code-skills', title: 'Claude Code engineering skills', description: 'Wrote Claude Code skills that capture release test evidence.' }],
    educations: [],
  },
  claims: [
    {
      slug: 'test-evidence-automation', kind: 'skill', label: 'Release test evidence automation', aliases: [], links: [], mentions: [],
      evidence: [{ target: 'position:goldman/validator', depth: 'built', proof: 'automated release test evidence capture' }],
    },
  ],
};

const good = { id: 'goldman/validator', text: 'Built a Python validator that automated release test evidence capture', sources: ['goldman/validator', 'test-evidence-automation'] };
const bad = { id: 'goldman/validator', text: 'Built a Python validator on Kubernetes', sources: ['goldman/validator'] };
const writeReply = (bullets: object[]) => ({ projects: [], bullets, reply: 'Changed the validator line.' });

async function setup() {
  const u = await makeUser();
  await saveProfile(u.user.id, doc, 'Start');
  const job = await db.job.create({
    data: { externalId: `cvw-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Release Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test', description: 'Automate release test evidence with Kubernetes.' },
  });
  const app = await db.application.create({ data: { userId: u.user.id, jobId: job.id } });
  return { ...u, job, app };
}
const fresh = (id: string) => db.application.findUniqueOrThrow({ where: { id } });

beforeEach(() => {
  vi.mocked(askJsonCached).mockReset();
  vi.mocked(claudeStatus).mockResolvedValue({ mode: 'own', detail: '' } as never);
});

describe('writeCv', () => {
  it('stores the lines that pass and lists the changes in the view', async () => {
    const { job, app } = await setup();
    vi.mocked(askJsonCached).mockResolvedValueOnce(writeReply([good]) as never);
    const w = await writeCv(app, job);
    expect(w?.bullets['goldman/validator'].text).toBe(good.text);
    const saved = await fresh(app.id);
    expect(readSteer(saved).written?.bullets['goldman/validator'].text).toBe(good.text);
    const view = cvView(saved, { resume: null, driveUrl: null, driveReason: null });
    expect(view.changes).toEqual([{ id: 'goldman/validator', kind: 'bullet', old: 'Built a Python validator for remediation updates', now: good.text }]);
    expect(view.droppedLines).toEqual([]);
    expect(vi.mocked(askJsonCached).mock.calls[0][0]).toBe('cv-write');
  });

  it('keeps a line that fails out of the CV, and lists why', async () => {
    const { job, app } = await setup();
    vi.mocked(askJsonCached).mockResolvedValueOnce(writeReply([bad]) as never);
    await writeCv(app, job);
    const view = cvView(await fresh(app.id), { resume: null, driveUrl: null, driveReason: null });
    expect(view.changes).toEqual([]);
    expect(view.droppedLines).toEqual([{ id: 'goldman/validator', why: expect.stringMatching(/kubernetes/i) }]);
  });

  it('makes no call and changes nothing without Claude', async () => {
    const { job, app } = await setup();
    vi.mocked(claudeStatus).mockResolvedValue({ mode: 'none', detail: 'Add an API key in Settings to use Claude.' } as never);
    expect(await writeCv(app, job)).toBeNull();
    expect(askJsonCached).not.toHaveBeenCalled();
    expect(readSteer(await fresh(app.id)).written).toBeUndefined();
  });
});

describe('refine with a request for new words', () => {
  it('rewords the line and says so in the reply', async () => {
    const { job, app } = await setup();
    vi.mocked(askJsonCached).mockImplementation((async (kind: string) =>
      kind === 'refine' ? { projects: null, bullets: null, skills: null, reply: 'Kept the order.' } : writeReply([good])) as never);
    await refineCv(app, job, 'add the evidence-capture detail to the validator bullet');
    const saved = await fresh(app.id);
    expect(readSteer(saved).written?.bullets['goldman/validator'].text).toBe(good.text);
    const chat = JSON.parse(saved.cvChat ?? '[]') as { role: string; text: string }[];
    expect(chat.at(-1)?.text).toMatch(/Reworded 1 line\./);
    const call = vi.mocked(askJsonCached).mock.calls.find((c) => c[0] === 'cv-write')!;
    expect(String((call[2] as { prompt: string }).prompt)).toContain('add the evidence-capture detail');
  });
});

describe('Use my original', () => {
  it('keeps the line as written, for the owner only', async () => {
    const { job, app, cookie } = await setup();
    vi.mocked(askJsonCached).mockResolvedValueOnce(writeReply([good]) as never);
    await writeCv(app, job);
    const other = await makeUser();
    const post = (c: string) => suggestions.POST(request(`/api/jobs/${job.id}/resume/suggestions`, { method: 'POST', cookie: c, body: { action: 'original', id: 'goldman/validator' } }), ctx({ id: job.id }));
    expect((await post(other.cookie)).status).toBe(404);
    const res = await post(cookie);
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).taskId).toBe('string');
    expect(readSteer(await fresh(app.id)).keep).toEqual(['goldman/validator']);
    const view = cvView(await fresh(app.id), { resume: null, driveUrl: null, driveReason: null });
    expect(view.changes).toEqual([]);
  });

  it('is 404 for an id with no written line', async () => {
    const { job, cookie } = await setup();
    const res = await suggestions.POST(request(`/api/jobs/${job.id}/resume/suggestions`, { method: 'POST', cookie, body: { action: 'original', id: 'goldman/validator' } }), ctx({ id: job.id }));
    expect(res.status).toBe(404);
  });
});

describe('reset', () => {
  it('drops the written lines and the kept ids', async () => {
    const { job, app } = await setup();
    vi.mocked(askJsonCached).mockResolvedValueOnce(writeReply([good]) as never);
    await writeCv(app, job);
    await resetCv(await fresh(app.id), job);
    const steer = readSteer(await fresh(app.id));
    expect(steer.written).toBeUndefined();
    expect(steer.keep).toBeUndefined();
  });
});

describe('the first build of a job', () => {
  it('writes the lines once; a later build keeps them', async () => {
    const { job, user, cookie } = await setup();
    vi.mocked(askJsonCached).mockResolvedValue(writeReply([good]) as never);
    const build = async () => {
      const res = await jobResume.POST(request(`/api/jobs/${job.id}/resume`, { method: 'POST', cookie }), ctx({ id: job.id }));
      const taskId = (await res.json()).taskId as string;
      // Saving the profile queues a base CV task too, so the worker runs until this task is done.
      for (let i = 0; i < 5 && (await db.task.findUniqueOrThrow({ where: { id: taskId } })).status === 'queued'; i++) await runOnce(undefined, { userId: user.id });
      return taskId;
    };
    const first = await build();
    expect((await db.task.findUniqueOrThrow({ where: { id: first } })).status).toBe('done');
    const writes = () => vi.mocked(askJsonCached).mock.calls.filter((c) => c[0] === 'cv-write').length;
    expect(writes()).toBe(1);
    const app = await db.application.findUniqueOrThrow({ where: { userId_jobId: { userId: user.id, jobId: job.id } } });
    expect(readSteer(app).written?.bullets['goldman/validator'].text).toBe(good.text);
    await build();
    expect(writes()).toBe(1);
  }, 120_000);
});

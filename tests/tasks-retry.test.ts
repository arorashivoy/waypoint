import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// A retry must not pay for a second Claude call, and must not write the chat turn twice.
const ask = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/claude', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude')>()),
  claudeStatus: vi.fn(async () => ({ mode: 'own', detail: '' })),
  askJson: vi.fn(async () => {
    ask.calls++;
    const data = { projects: null, bullets: null, skills: null, reply: 'Moved the parser up.' };
    return { data, raw: JSON.stringify(data), usage: { model: 'claude-sonnet-test', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 } };
  }),
}));
// refineCv reads claims.yml and the LaTeX source. Stub both, so the test needs no data/profile/ or .env.
vi.mock('@/lib/user', async (orig) => ({
  ...(await orig<typeof import('@/lib/user')>()),
  claimsFor: vi.fn(async () => ({}) as never),
}));
vi.mock('@/lib/resume', async (orig) => ({
  ...(await orig<typeof import('@/lib/resume')>()),
  resumeMenu: vi.fn(() => ({ projects: [], bullets: [], skills: [] }) as never),
  buildResume: vi.fn(),
}));

import { db } from '@/lib/db';
import { buildResume } from '@/lib/resume';
import { readChat } from '@/lib/cv';
import { enqueue } from '@/lib/tasks/queue';
import { runOnce } from '@/lib/tasks/worker';
import '@/lib/tasks/handlers';
import { makeUser } from './helpers/http';

const built = { path: '', tailored: false, order: [], experience: [], skillsLead: [] } as never;

describe('a retried refine', () => {
  it('makes one Claude call and one chat turn when the CV build fails after the chat write', async () => {
    const { user } = await makeUser('admin');
    const job = await db.job.create({
      data: { externalId: `retry-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test' },
    });
    const { id } = await enqueue({ kind: 'cv', userId: user.id, payload: { jobId: job.id, action: 'refine', message: 'Lead with the parser.' } });
    const before = ask.calls;
    // 1st build: the current CV, before the Claude call. 2nd build: after the chat write, and it fails.
    vi.mocked(buildResume).mockResolvedValueOnce(built).mockRejectedValueOnce(new Error('latexmk failed'));
    await runOnce(undefined, { userId: user.id });
    expect((await db.task.findUniqueOrThrow({ where: { id } })).status).toBe('queued');

    vi.mocked(buildResume).mockResolvedValue(built);
    await runOnce(new Date(Date.now() + 24 * 3_600_000), { userId: user.id });
    expect((await db.task.findUniqueOrThrow({ where: { id } })).status).toBe('done');
    expect(ask.calls - before).toBe(1);
    const app = await db.application.findUniqueOrThrow({ where: { userId_jobId: { userId: user.id, jobId: job.id } } });
    const chat = readChat(app);
    expect(chat.map((t) => t.role)).toEqual(['you', 'claude']);
    expect(chat.every((t) => t.task === id)).toBe(true);
  });
});

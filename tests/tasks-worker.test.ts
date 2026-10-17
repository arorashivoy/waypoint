import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '@/lib/db';
import { enqueue, lastBeat, type TaskRow } from '@/lib/tasks/queue';
import { TaskDeferred, runOnce, startWorker } from '@/lib/tasks/worker';
import { registerHandler } from '@/lib/tasks/handlers';
import { makeUser } from './helpers/http';

// All test files share one database. Each test makes its own user and passes it as the scope.
// The test handler sits on the real kind 'refresh'. Each test sets `current` to its own function.
// The kind 'cv' has no handler in this file: it stands for an unknown kind.

type Fn = (payload: { n: number }, task: TaskRow) => Promise<unknown>;
let current: Fn = async () => ({});
registerHandler('refresh', z.object({ n: z.number() }), (p, t) => current(p, t));

async function setup(payload: unknown = { n: 1 }, kind: 'refresh' | 'cv' = 'refresh') {
  const { user } = await makeUser();
  const { id } = await enqueue({ kind, userId: user.id, payload });
  return { scope: { userId: user.id }, id, userId: user.id };
}
const row = (id: string) => db.task.findUniqueOrThrow({ where: { id } });

describe('worker', () => {
  it('runOnce runs the handler and stores the result', async () => {
    const t = await setup();
    current = async () => ({ n: 1 });
    expect(await runOnce(new Date(), t.scope)).toBe('ran');
    const r = await row(t.id);
    expect(r.status).toBe('done');
    expect(JSON.parse(r.result!)).toEqual({ n: 1 });
  });

  it('a handler error goes to failTask', async () => {
    const t = await setup();
    current = async () => {
      throw new Error('x'.repeat(900));
    };
    await runOnce(new Date(), t.scope);
    const r = await row(t.id);
    expect(r.status).toBe('queued');
    expect(r.lastError).toHaveLength(500);
  });

  it('TaskDeferred goes to deferTask', async () => {
    const t = await setup();
    const until = new Date(Date.now() + 3_600_000);
    current = async () => {
      throw new TaskDeferred(until, 'later');
    };
    await runOnce(new Date(), t.scope);
    const r = await row(t.id);
    expect(r.status).toBe('queued');
    expect(r.runAt.getTime()).toBe(until.getTime());
    expect(r.attempts).toBe(1);
  });

  it('a task of an unknown kind fails at once', async () => {
    const t = await setup({}, 'cv');
    await runOnce(new Date(), t.scope);
    const r = await row(t.id);
    expect(r.status).toBe('failed');
    expect(r.lastError).toContain('cv');
  });

  it('a payload that fails the schema fails at once', async () => {
    const t = await setup({ n: 'no' });
    let called = false;
    current = async () => {
      called = true;
      return {};
    };
    await runOnce(new Date(), t.scope);
    const r = await row(t.id);
    expect(r.status).toBe('failed');
    expect(called).toBe(false);
  });

  it('runOnce returns idle when nothing is due', async () => {
    const { user } = await makeUser();
    expect(await runOnce(new Date(), { userId: user.id })).toBe('idle');
  });

  it('startWorker stops when the signal aborts', async () => {
    const { user } = await makeUser();
    const beatId = `test-${randomBytes(4).toString('hex')}`;
    const ac = new AbortController();
    const started = Date.now();
    const p = startWorker({ signal: ac.signal, idleMs: 10, beatMs: 10, scope: { userId: user.id }, beatId });
    await new Promise((r) => setTimeout(r, 100));
    ac.abort();
    await p;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await lastBeat(beatId)).not.toBeNull();
    await db.workerHeartbeat.delete({ where: { id: beatId } });
  });

  it('a running task finishes before startWorker resolves', async () => {
    const t = await setup();
    const beatId = `test-${randomBytes(4).toString('hex')}`;
    const ac = new AbortController();
    current = async () => {
      ac.abort();
      await new Promise((r) => setTimeout(r, 200));
      return { n: 2 };
    };
    await startWorker({ signal: ac.signal, idleMs: 10, beatMs: 10, scope: t.scope, beatId });
    expect((await row(t.id)).status).toBe('done');
    await db.workerHeartbeat.deleteMany({ where: { id: beatId } });
  });
});

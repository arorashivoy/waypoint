import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  RETRY_DELAYS_MS,
  beat,
  claimNext,
  completeTask,
  deferTask,
  enqueue,
  failTask,
  lastBeat,
  requeueStale,
} from '@/lib/tasks/queue';
import { makeUser } from './helpers/http';

// All test files share one database. Each test makes its own user and claims only the tasks of that user.

describe('task queue', () => {
  it('enqueue creates a queued task', async () => {
    const { user } = await makeUser();
    const r = await enqueue({
      kind: 'refresh',
      userId: user.id,
      payload: { a: 1 },
    });
    expect(r.created).toBe(true);
    const row = await db.task.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(0);
  });

  it('enqueue returns the open task with the same dedupeKey', async () => {
    const { user } = await makeUser();
    const input = {
      kind: 'cv' as const,
      userId: user.id,
      payload: {},
      dedupeKey: `cv:${user.id}:j1`,
    };
    const a = await enqueue(input);
    const b = await enqueue(input);
    expect(b.id).toBe(a.id);
    expect(b.created).toBe(false);
    await completeTask(a.id, { ok: true });
    const c = await enqueue(input);
    expect(c.id).not.toBe(a.id);
    expect(c.created).toBe(true);
  });

  it('claimNext gives each task to one caller', async () => {
    const { user } = await makeUser();
    const scope = { userId: user.id };
    const { id } = await enqueue({
      kind: 'analysis',
      userId: user.id,
      payload: { jobId: 'j' },
    });
    const rows = await Promise.all([claimNext(undefined, scope), claimNext(undefined, scope)]);
    const got = rows.filter((r) => r !== null);
    expect(got).toHaveLength(1);
    expect(got[0]!.id).toBe(id);
    expect(got[0]!.payload).toEqual({ jobId: 'j' });
    const row = await db.task.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('running');
    expect(row.attempts).toBe(1);
    expect(row.startedAt).not.toBeNull();
  });

  it('claimNext skips a task whose runAt is in the future', async () => {
    const { user } = await makeUser();
    const scope = { userId: user.id };
    const now = new Date('2026-01-01T00:00:00Z');
    await enqueue({
      kind: 'refresh',
      userId: user.id,
      payload: {},
      runAt: new Date(now.getTime() + 1000),
    });
    expect(await claimNext(now, scope)).toBeNull();
    expect(await claimNext(new Date(now.getTime() + 1000), scope)).not.toBeNull();
  });

  it('claimNext takes the oldest runAt first', async () => {
    const { user } = await makeUser();
    const scope = { userId: user.id };
    const now = new Date('2026-01-01T00:00:00Z');
    const late = await enqueue({
      kind: 'refresh',
      userId: user.id,
      payload: {},
      runAt: new Date(now.getTime() - 1000),
    });
    const early = await enqueue({
      kind: 'refresh',
      userId: user.id,
      payload: {},
      runAt: new Date(now.getTime() - 5000),
    });
    expect((await claimNext(now, scope))!.id).toBe(early.id);
    expect((await claimNext(now, scope))!.id).toBe(late.id);
  });

  it('failTask retries after 1, 5 and 30 minutes, then fails', async () => {
    const { user } = await makeUser();
    const scope = { userId: user.id };
    const now = new Date('2026-01-01T00:00:00Z');
    const { id } = await enqueue({
      kind: 'refresh',
      userId: user.id,
      payload: {},
      runAt: now,
    });
    for (let i = 0; i < 3; i++) {
      const t = await claimNext(new Date(now.getTime() + 10 * 3_600_000 * (i + 1)), scope);
      expect(t!.id).toBe(id);
      expect(await failTask(id, 'boom', now)).toBe('queued');
      const row = await db.task.findUniqueOrThrow({ where: { id } });
      expect(row.runAt.getTime() - now.getTime()).toBe(RETRY_DELAYS_MS[i]);
      expect(row.status).toBe('queued');
    }
    await claimNext(new Date(now.getTime() + 100 * 3_600_000), scope);
    expect(await failTask(id, 'x'.repeat(900), now)).toBe('failed');
    const row = await db.task.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('failed');
    expect(row.lastError).toHaveLength(500);
  });

  it('deferTask keeps attempts', async () => {
    const { user } = await makeUser();
    const scope = { userId: user.id };
    const { id } = await enqueue({
      kind: 'refresh',
      userId: user.id,
      payload: {},
    });
    await claimNext(undefined, scope);
    const until = new Date(Date.now() + 60_000);
    await deferTask(id, until);
    const mid = await db.task.findUniqueOrThrow({ where: { id } });
    expect(mid.status).toBe('queued');
    expect(mid.attempts).toBe(1);
    expect(mid.runAt.getTime()).toBe(until.getTime());
    const t = await claimNext(until, scope);
    expect(t!.attempts).toBe(2);
  });

  it('requeueStale puts old running tasks back and leaves new ones', async () => {
    const { user } = await makeUser();
    const now = new Date('2026-01-01T12:00:00Z');
    const old = await enqueue({
      kind: 'refresh',
      userId: user.id,
      payload: {},
    });
    const fresh = await enqueue({
      kind: 'refresh',
      userId: user.id,
      payload: {},
    });
    await db.task.update({
      where: { id: old.id },
      data: {
        status: 'running',
        startedAt: new Date(now.getTime() - 11 * 60_000),
      },
    });
    await db.task.update({
      where: { id: fresh.id },
      data: {
        status: 'running',
        startedAt: new Date(now.getTime() - 9 * 60_000),
      },
    });
    expect(await requeueStale(now, { userId: user.id })).toBe(1);
    expect((await db.task.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('queued');
    expect((await db.task.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('running');
  });

  it('beat and lastBeat', async () => {
    // The heartbeat is one row for the whole app, so the test does not delete it.
    // It checks the times that its own beat() calls wrote.
    const at = new Date('2031-01-01T00:00:00Z');
    await beat(123, at);
    expect(await lastBeat()).toEqual(at);
    const at2 = new Date('2031-01-01T00:00:30Z');
    await beat(123, at2);
    expect(await lastBeat()).toEqual(at2);
  });

  it('a deleted user takes their tasks', async () => {
    const { user } = await makeUser();
    await enqueue({ kind: 'cv', userId: user.id, payload: {} });
    await db.user.delete({ where: { id: user.id } });
    expect(await db.task.count({ where: { userId: user.id } })).toBe(0);
  });
});

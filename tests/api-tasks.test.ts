import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/tasks/queue';
import * as taskRoute from '@/app/api/tasks/[id]/route';
import { ctx, makeUser, request } from './helpers/http';

const get = (id: string, cookie?: string) => taskRoute.GET(request(`/api/tasks/${id}`, { cookie }), ctx({ id }));

describe('GET /api/tasks/[id]', () => {
  it('owner reads the task', async () => {
    const { user, cookie } = await makeUser();
    const { id } = await enqueue({ kind: 'cv', userId: user.id, payload: { jobId: 'x' } });
    const res = await get(id, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id, kind: 'cv', status: 'queued', attempts: 0, runAt: expect.any(String), error: null, result: null });
  });

  it('shows the result of a done task', async () => {
    const { user, cookie } = await makeUser();
    const { id } = await enqueue({ kind: 'cv', userId: user.id, payload: null });
    await db.task.update({ where: { id }, data: { status: 'done', result: JSON.stringify({ ok: 1 }) } });
    expect((await (await get(id, cookie)).json()).result).toEqual({ ok: 1 });
  });

  it('shows a done task with a bad stored result as failed', async () => {
    const { user, cookie } = await makeUser();
    const { id } = await enqueue({ kind: 'cv', userId: user.id, payload: null });
    await db.task.update({ where: { id }, data: { status: 'done', result: '{bad' } });
    const res = await get(id, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error).toBe('The result of this task could not be read.');
    expect(body.result).toBeNull();
  });

  it('keeps a done task with a null result column as done', async () => {
    const { user, cookie } = await makeUser();
    const { id } = await enqueue({ kind: 'cv', userId: user.id, payload: null });
    await db.task.update({ where: { id }, data: { status: 'done', result: null } });
    const body = await (await get(id, cookie)).json();
    expect(body.status).toBe('done');
    expect(body.error).toBeNull();
    expect(body.result).toBeNull();
  });

  it('shows an error only when the task failed', async () => {
    const { user, cookie } = await makeUser();
    const { id } = await enqueue({ kind: 'cv', userId: user.id, payload: null });
    await db.task.update({ where: { id }, data: { status: 'queued', lastError: '[user] will retry' } });
    expect((await (await get(id, cookie)).json()).error).toBeNull();
    await db.task.update({ where: { id }, data: { status: 'failed' } });
    expect((await (await get(id, cookie)).json()).error).toBe('will retry');
  });

  it('shows the text of a user error, and a fixed text for any other error', async () => {
    const { user, cookie } = await makeUser();
    const { id } = await enqueue({ kind: 'cv', userId: user.id, payload: null });
    const raw = 'Invalid `prisma.task.update()` invocation in /home/shivoy/waypoint/src/lib/x.ts';
    await db.task.update({ where: { id }, data: { status: 'failed', lastError: raw } });
    expect((await (await get(id, cookie)).json()).error).toBe('The task failed. Try again later.');
    await db.task.update({ where: { id }, data: { lastError: null } });
    expect((await (await get(id, cookie)).json()).error).toBe('The task failed. Try again later.');
    await db.task.update({ where: { id }, data: { lastError: '[user] The job is gone.' } });
    expect((await (await get(id, cookie)).json()).error).toBe('The job is gone.');
  });

  it('another user gets 404', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { id } = await enqueue({ kind: 'cv', userId: a.user.id, payload: null });
    const res = await get(id, b.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found.' });
  });

  it('an unknown ID gets 404', async () => {
    const { cookie } = await makeUser();
    const res = await get('no-such-task', cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found.' });
  });

  it('a maintenance task (userId null) gets 404 for a member', async () => {
    const { cookie } = await makeUser();
    const { id } = await enqueue({ kind: 'maintenance', userId: null, payload: null });
    try {
      expect((await get(id, cookie)).status).toBe(404);
    } finally {
      await db.task.delete({ where: { id } });
    }
  });
});

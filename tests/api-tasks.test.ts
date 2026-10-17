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

  it('gives a null result when the stored JSON is bad', async () => {
    const { user, cookie } = await makeUser();
    const { id } = await enqueue({ kind: 'cv', userId: user.id, payload: null });
    await db.task.update({ where: { id }, data: { status: 'done', result: '{bad' } });
    const res = await get(id, cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBeNull();
  });

  it('shows the error only when the task failed', async () => {
    const { user, cookie } = await makeUser();
    const { id } = await enqueue({ kind: 'cv', userId: user.id, payload: null });
    await db.task.update({ where: { id }, data: { status: 'queued', lastError: 'will retry' } });
    expect((await (await get(id, cookie)).json()).error).toBeNull();
    await db.task.update({ where: { id }, data: { status: 'failed' } });
    expect((await (await get(id, cookie)).json()).error).toBe('will retry');
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTask } from '@/components/tasks';

const view = (status: string, extra: object = {}) => ({ id: 't1', kind: 'cv', status, attempts: 1, runAt: '2026-10-17T00:00:00.000Z', error: null, result: null, ...extra });

function fakeFetch(views: object[]) {
  let i = 0;
  const fn = vi.fn(async (_url: string) => {
    const v = views[Math.min(i++, views.length - 1)];
    return new Response(JSON.stringify(v), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runTask', () => {
  it('resolves with the result', async () => {
    const f = fakeFetch([view('queued'), view('running'), view('done', { result: { url: 'x' } })]);
    const seen: string[] = [];
    const p = runTask<{ url: string }>(async () => ({ taskId: 't1' }), { onProgress: (v) => seen.push(v.status) });
    await vi.advanceTimersByTimeAsync(1500 * 3);
    await expect(p).resolves.toEqual({ url: 'x' });
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls[0][0]).toBe('/api/tasks/t1');
    expect(seen).toEqual(['queued', 'running', 'done']);
  });

  it('throws the task error', async () => {
    fakeFetch([view('queued'), view('running'), view('failed', { error: 'The CV build failed.' })]);
    const p = runTask(async () => ({ taskId: 't1' }));
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(1500 * 3);
    expect(await caught).toEqual(new Error('The CV build failed.'));
  });

  it('throws after the time limit', async () => {
    fakeFetch([view('running')]);
    const caught = runTask(async () => ({ taskId: 't1' }), { timeoutMs: 5000 }).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await caught).toEqual(new Error('The task did not finish in time. It still runs; check again later.'));
  });
});

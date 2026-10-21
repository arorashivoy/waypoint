import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTask } from '@/components/tasks';
import { parser, refreshResult } from '@/components/task-results';

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
    const p = runTask(async () => ({ taskId: 't1' }), { onProgress: (v) => seen.push(v.status) });
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

  it('polls at the time limit, not one interval before it', async () => {
    const f = fakeFetch([view('running'), view('running'), view('running'), view('done', { result: 7 })]);
    const p = runTask(async () => ({ taskId: 't1' }), { timeoutMs: 4000 });
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(3999);
    expect(f).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(await caught).toBe(7);
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('gives the result to the parser of the caller', async () => {
    fakeFetch([view('done', { result: { added: 2, total: 9, report: [], extra: 'kept' } })]);
    const p = runTask(async () => ({ taskId: 't1' }), { parse: parser(refreshResult) });
    await expect(p).resolves.toEqual({ added: 2, total: 9, report: [], extra: 'kept' });
  });

  it('throws when the result does not match the parser', async () => {
    fakeFetch([view('done', { result: { added: 'two' } })]);
    const caught = runTask(async () => ({ taskId: 't1' }), { parse: parser(refreshResult) }).catch((e: Error) => e);
    expect(((await caught) as Error).message).toMatch(/result that Waypoint cannot read/);
  });
});

describe('runTask and lost polls', () => {
  /** Each entry is a view, 'net' (fetch rejects) or a number (an HTTP status with an error body). */
  function flakyFetch(steps: (object | 'net' | number)[]) {
    let i = 0;
    const fn = vi.fn(async () => {
      const s = steps[Math.min(i++, steps.length - 1)];
      if (s === 'net') throw new TypeError('Failed to fetch');
      if (typeof s === 'number') return new Response(JSON.stringify({ error: s === 404 ? 'Not found.' : 'Bad gateway.' }), { status: s });
      return new Response(JSON.stringify(s), { status: 200 });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('keeps polling through 5 lost polls in a row', async () => {
    const f = flakyFetch([view('running'), 'net', 'net', 502, 'net', 'net', view('done', { result: { ok: 1 } })]);
    const p = runTask(async () => ({ taskId: 't1' }));
    await vi.advanceTimersByTimeAsync(1500 * 7);
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(7);
  });

  it('a good poll resets the count', async () => {
    flakyFetch(['net', 'net', 'net', 'net', 'net', view('running'), 'net', 'net', 'net', 'net', 'net', view('done', { result: 2 })]);
    const p = runTask(async () => ({ taskId: 't1' }));
    await vi.advanceTimersByTimeAsync(1500 * 12);
    await expect(p).resolves.toBe(2);
  });

  it('stops at the 6th lost poll in a row', async () => {
    flakyFetch(['net']);
    const caught = runTask(async () => ({ taskId: 't1' })).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(1500 * 7);
    const e = await caught;
    expect(e).toBeInstanceOf(TypeError);
    expect((e as Error).message).toBe('Failed to fetch');
  });

  it('stops at once on a 404', async () => {
    const f = flakyFetch([404]);
    const caught = runTask(async () => ({ taskId: 't1' })).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(1500 * 3);
    expect(((await caught) as Error).message).toBe('Not found.');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

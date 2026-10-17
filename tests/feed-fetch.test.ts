import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WATCH: { companies: unknown[] } = { companies: [] };
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  const readFile = ((p: unknown, ...rest: unknown[]) =>
    String(p).endsWith('watchlist.json') ? Promise.resolve(JSON.stringify(WATCH)) : (real.readFile as any)(p, ...rest)) as typeof real.readFile;
  return { ...real, readFile, default: { ...real, readFile } };
});

import { db } from '@/lib/db';
import { fetchAll } from '@/lib/sources';
import { FEED_FRESH_MS, fetchBoard } from '@/lib/sources/feed-fetch';
import * as feedsRoute from '@/app/api/feeds/route';
import { runOnce } from '@/lib/tasks/worker';
import { enqueue } from '@/lib/tasks/queue';
import '@/lib/tasks/handlers';
import { makeUser, request } from './helpers/http';

const uid = () => randomBytes(5).toString('hex');
const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  WATCH.companies = [];
});

describe('fetchBoard', () => {
  it('a board fetched 5 hours ago is skipped', async () => {
    const board = `ff-skip-${uid()}`;
    await db.feedFetch.create({ data: { board, status: 'ok', fetchedAt: hoursAgo(5) } });
    const r = await fetchBoard(board, 'https://feed.test/a', {}, { force: false });
    expect(r).toEqual({ status: 'skipped' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a board fetched 7 hours ago is fetched', async () => {
    const board = `ff-old-${uid()}`;
    await db.feedFetch.create({ data: { board, status: 'ok', fetchedAt: hoursAgo(7) } });
    fetchMock.mockResolvedValue(json({ a: 1 }));
    const r = await fetchBoard(board, 'https://feed.test/a', {}, { force: false });
    expect(r).toMatchObject({ status: 'ok', json: { a: 1 } });
    expect(FEED_FRESH_MS).toBe(6 * 3600_000);
  });

  it('force fetches it', async () => {
    const board = `ff-force-${uid()}`;
    await db.feedFetch.create({ data: { board, status: 'ok', fetchedAt: hoursAgo(1) } });
    fetchMock.mockResolvedValue(json({ a: 1 }));
    const r = await fetchBoard(board, 'https://feed.test/a', {}, { force: true });
    expect(r.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('the second request sends If-None-Match and If-Modified-Since', async () => {
    const board = `ff-cond-${uid()}`;
    fetchMock.mockResolvedValueOnce(json({ a: 1 }, { etag: '"v1"', 'last-modified': 'Wed, 01 Oct 2026 10:00:00 GMT' }));
    const first = await fetchBoard(board, 'https://feed.test/a', { headers: { 'user-agent': 'x' } }, { force: true });
    if (first.status === 'ok') await first.commit();
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('if-none-match')).toBe(false);

    fetchMock.mockResolvedValueOnce(json({ a: 2 }));
    await fetchBoard(board, 'https://feed.test/a', { headers: { 'user-agent': 'x' } }, { force: true });
    const sent = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(sent.get('if-none-match')).toBe('"v1"');
    expect(sent.get('if-modified-since')).toBe('Wed, 01 Oct 2026 10:00:00 GMT');
    expect(sent.get('user-agent')).toBe('x');
  });

  it('304 keeps the jobs and sets status not-modified', async () => {
    const board = `ff-304-${uid()}`;
    const job = await db.job.create({
      data: { externalId: `ff-${uid()}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test' },
    });
    const old = hoursAgo(10);
    await db.feedFetch.create({ data: { board, status: 'ok', fetchedAt: old, etag: '"v1"' } });
    fetchMock.mockResolvedValue(new Response(null, { status: 304 }));
    const r = await fetchBoard(board, 'https://feed.test/a', {}, { force: false });
    expect(r.status).toBe('not-modified');
    expect(await db.feedFetch.findUniqueOrThrow({ where: { board } })).toMatchObject({ status: 'ok', fetchedAt: old });
    if (r.status === 'not-modified') await r.commit();
    const row = await db.feedFetch.findUniqueOrThrow({ where: { board } });
    expect(row.status).toBe('not-modified');
    expect(row.fetchedAt.getTime()).toBeGreaterThan(old.getTime());
    expect(row.etag).toBe('"v1"');
    expect(await db.job.findUnique({ where: { id: job.id } })).not.toBeNull();
  });

  it('a failed board records status failed and keeps its etag', async () => {
    const board = `ff-fail-${uid()}`;
    await db.feedFetch.create({ data: { board, status: 'ok', fetchedAt: hoursAgo(10), etag: '"v1"', lastModified: 'Mon' } });
    fetchMock.mockResolvedValue(new Response('no', { status: 500, statusText: 'Server Error' }));
    await expect(fetchBoard(board, 'https://feed.test/a', {}, { force: false })).rejects.toThrow('500');
    const row = await db.feedFetch.findUniqueOrThrow({ where: { board } });
    expect(row).toMatchObject({ status: 'failed', etag: '"v1"', lastModified: 'Mon' });
    expect(row.error).toContain('500');
  });

  it('cuts a long error to 200 characters', async () => {
    const board = `ff-long-${uid()}`;
    fetchMock.mockRejectedValue(new Error('x'.repeat(500)));
    await expect(fetchBoard(board, 'https://feed.test/a', {}, { force: true })).rejects.toThrow();
    expect((await db.feedFetch.findUniqueOrThrow({ where: { board } })).error).toHaveLength(200);
  });
});

describe('fetchAll with cached boards', () => {
  it('the other boards still return jobs when one fails', async () => {
    const good = `good${uid()}`;
    const bad = `bad${uid()}`;
    WATCH.companies = [
      { company: 'Good Co', ats: 'lever', token: good },
      { company: 'Bad Co', ats: 'lever', token: bad },
    ];
    fetchMock.mockImplementation(async (url: string) =>
      url.includes(bad) ? new Response('x', { status: 500, statusText: 'Boom' }) : json([{ id: '1', text: 'Dev', hostedUrl: 'https://x.test/1', categories: { location: 'Berlin, Germany' } }]),
    );
    const { report, commit } = await fetchAll(['ZZ'], [], { force: true });
    await commit();
    const rowOf = (c: string) => report.find((r) => r.company === c)!;
    expect(rowOf('Good Co')).toMatchObject({ got: 1 });
    expect(rowOf('Bad Co')).toMatchObject({ got: 0 });
    expect(rowOf('Bad Co').error).toContain('500');
    expect((await db.feedFetch.findUniqueOrThrow({ where: { board: `lever:${good}` } })).status).toBe('ok');
    expect((await db.feedFetch.findUniqueOrThrow({ where: { board: `lever:${bad}` } })).status).toBe('failed');
  });

  it('a fresh board and a 304 board add a report row with got 0 and the status', async () => {
    const fresh = `fresh${uid()}`;
    const same = `same${uid()}`;
    WATCH.companies = [
      { company: 'Fresh Co', ats: 'lever', token: fresh },
      { company: 'Same Co', ats: 'lever', token: same },
    ];
    await db.feedFetch.create({ data: { board: `lever:${fresh}`, status: 'ok', fetchedAt: hoursAgo(1) } });
    await db.feedFetch.create({ data: { board: `lever:${same}`, status: 'ok', fetchedAt: hoursAgo(9), etag: '"v1"' } });
    fetchMock.mockResolvedValue(new Response(null, { status: 304 }));
    const { jobs, report } = await fetchAll(['ZZ'], [], { force: false });
    expect(jobs).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(report.find((r) => r.company === 'Fresh Co')).toMatchObject({ got: 0, kept: 0, status: 'skipped' });
    expect(report.find((r) => r.company === 'Same Co')).toMatchObject({ got: 0, kept: 0, status: 'not-modified' });
  });

  it('a careers site gets the skip and the status, with no conditional headers', async () => {
    const token = `career${uid()}`;
    WATCH.companies = [{ company: 'Career Co', ats: 'smartrecruiters', token }];
    await db.feedFetch.create({ data: { board: `smartrecruiters:${token}`, status: 'ok', fetchedAt: hoursAgo(10), etag: '"v1"' } });
    fetchMock.mockResolvedValue(json({ content: [], totalFound: 0 }));
    const first = await fetchAll(['ZZ'], [], { force: false });
    await first.commit();
    expect(fetchMock).toHaveBeenCalled();
    for (const c of fetchMock.mock.calls) expect(new Headers(c[1]?.headers).has('if-none-match')).toBe(false);
    const row = await db.feedFetch.findUniqueOrThrow({ where: { board: `smartrecruiters:${token}` } });
    expect(row.status).toBe('ok');
    const again = await fetchAll(['ZZ'], [], { force: false });
    expect(again.report.find((r) => r.company === 'Career Co')).toMatchObject({ status: 'skipped' });
  });
});

describe('GET /api/feeds', () => {
  it('lists only failed boards', async () => {
    const { cookie } = await makeUser();
    const failed = `ff-list-fail-${uid()}`;
    const ok = `ff-list-ok-${uid()}`;
    await db.feedFetch.create({ data: { board: failed, status: 'failed', fetchedAt: new Date(), error: 'Boom' } });
    await db.feedFetch.create({ data: { board: ok, status: 'ok', fetchedAt: new Date() } });
    const res = await feedsRoute.GET(request('/api/feeds', { cookie }), { params: {} });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { board: string; status: string; fetchedAt: string; error: string | null }[];
    expect(rows.find((r) => r.board === failed)).toMatchObject({ status: 'failed', error: 'Boom' });
    expect(rows.find((r) => r.board === ok)).toBeUndefined();
    expect(rows.every((r) => r.status === 'failed')).toBe(true);
  });

  it('hides the search query of an Adzuna board and joins the rows of one country', async () => {
    const { cookie } = await makeUser();
    const secret = `secretquery${uid()}`;
    const cc = `Q${uid().slice(0, 3).toUpperCase()}`;
    await db.feedFetch.create({ data: { board: `adzuna:${cc}:${secret} one`, status: 'failed', fetchedAt: hoursAgo(3), error: 'older' } });
    await db.feedFetch.create({ data: { board: `adzuna:${cc}:${secret} two`, status: 'failed', fetchedAt: hoursAgo(1), error: 'newer' } });
    const res = await feedsRoute.GET(request('/api/feeds', { cookie }), { params: {} });
    const text = JSON.stringify(await res.clone().json());
    expect(text).not.toContain(secret);
    const rows = (await res.json()) as { board: string; error: string }[];
    const mine = rows.filter((r) => r.board === `adzuna:${cc}`);
    expect(mine).toHaveLength(1);
    expect(mine[0].error).toBe('newer');
  });
});

/** A user with only the given countries on. */
async function userWith(...ccs: string[]) {
  const u = await makeUser();
  await db.countryPref.updateMany({ where: { userId: u.user.id }, data: { on: false } });
  for (const [rank, cc] of ccs.entries()) {
    await db.countryPref.upsert({ where: { userId_cc: { userId: u.user.id, cc } }, update: { on: true }, create: { userId: u.user.id, cc, rank, on: true } });
  }
  return u;
}
const runRefresh = async (userId: string, force: boolean) => {
  const { id } = await enqueue({ kind: 'refresh', userId, payload: { force } });
  await runOnce(undefined, { userId });
  return db.task.findUniqueOrThrow({ where: { id } });
};

describe('the refresh task and the feed cache', () => {
  it('a failed store leaves the old etag and date, and the next refresh fetches again', async () => {
    const token = `store${uid()}`;
    const board = `lever:${token}`;
    WATCH.companies = [{ company: 'Store Co', ats: 'lever', token }];
    const { user } = await userWith('DE');
    const old = hoursAgo(10);
    await db.feedFetch.create({ data: { board, status: 'ok', fetchedAt: old, etag: '"old"' } });
    const reply = () => json([{ id: `i${token}`, text: 'Dev', hostedUrl: 'https://x.test/1', categories: { location: 'Berlin, Germany' } }], { etag: '"new"' });
    fetchMock.mockImplementation(async () => reply());

    const spy = vi.spyOn(db.job, 'upsert').mockRejectedValueOnce(new Error('disk full'));
    await runRefresh(user.id, false);
    spy.mockRestore();
    const row = await db.feedFetch.findUniqueOrThrow({ where: { board } });
    expect(row).toMatchObject({ etag: '"old"', status: 'ok' });
    expect(row.fetchedAt.getTime()).toBe(old.getTime());

    fetchMock.mockClear();
    const task = await runRefresh(user.id, false);
    expect(task.status).toBe('done');
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes(token))!;
    expect(new Headers(call[1].headers).get('if-none-match')).toBe('"old"');
    expect(await db.job.findUnique({ where: { externalId: `lever:${token}:i${token}` } })).not.toBeNull();
    expect((await db.feedFetch.findUniqueOrThrow({ where: { board } })).etag).toBe('"new"');
  });

  it('a refresh of user A stores the jobs of the countries of user B', async () => {
    const token = `multi${uid()}`;
    WATCH.companies = [{ company: 'Multi Co', ats: 'lever', token }];
    const a = await userWith('DE');
    const b = await userWith('NL');
    fetchMock.mockImplementation(async () =>
      json([
        { id: `de${token}`, text: 'Dev DE', hostedUrl: 'https://x.test/de', categories: { location: 'Berlin, Germany' } },
        { id: `nl${token}`, text: 'Dev NL', hostedUrl: 'https://x.test/nl', categories: { location: 'Amsterdam, Netherlands' } },
      ]),
    );
    await runRefresh(a.user.id, false);
    const nl = { externalId: `lever:${token}:nl${token}` };
    expect(await db.job.findUnique({ where: nl })).not.toBeNull();

    fetchMock.mockClear();
    const second = await runRefresh(b.user.id, false);
    expect(second.status).toBe('done');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(token))).toBe(false);
    expect(await db.job.findUnique({ where: nl })).not.toBeNull();
  });
});

describe('fetch time limit', () => {
  it('every board fetch has a 30-second signal', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    WATCH.companies = [
      { company: 'Lever Co', ats: 'lever', token: `t${uid()}` },
      { company: 'Workday Co', ats: 'workday', token: `ten|wd1|site${uid()}` },
    ];
    fetchMock.mockImplementation(async () => json([]));
    await fetchAll(['ZZ'], [], { force: true });
    expect(fetchMock).toHaveBeenCalled();
    for (const [, init] of fetchMock.mock.calls) expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(30_000);
    timeout.mockRestore();
  });
});

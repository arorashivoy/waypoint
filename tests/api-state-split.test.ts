import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { GET as meRoute } from '@/app/api/me/route';
import { GET as jobsRoute } from '@/app/api/jobs/list/route';
import { GET as pendingRoute } from '@/app/api/pending/route';
import { ctx, makeUser, request } from './helpers/http';

type U = Awaited<ReturnType<typeof makeUser>>;
const get = (route: typeof meRoute, path: string, cookie?: string, inm?: string) =>
  route(request(path, { cookie, headers: inm ? { 'if-none-match': inm } : undefined }), ctx());

/** A user with one country on. The code is unique to each call, so no job of another test or file enters the list. */
async function userInCountry(code?: string) {
  const u = await makeUser();
  // Not X + 1 letter: other test files pick from those 26 codes, and a job of theirs in the same code would change the ETag.
  const cc = code ?? `XT${randomBytes(4).toString('hex')}`;
  await db.countryPref.updateMany({ where: { userId: u.user.id }, data: { on: false } });
  await db.countryPref.create({ data: { userId: u.user.id, cc, rank: 0, on: true } });
  return { ...u, cc };
}

const makeJob = (cc: string, extra: Record<string, unknown> = {}) =>
  db.job.create({
    data: { externalId: `t:${randomBytes(6).toString('hex')}`, source: 'test', role: 'Backend Engineer', company: 'Acme', city: 'Berlin', cc, url: 'https://example.com/j', postedAt: new Date('2026-10-10T08:00:00Z'), ...extra },
  });

const ROUTES: [string, typeof meRoute][] = [
  ['/api/me', meRoute],
  ['/api/jobs/list', jobsRoute],
  ['/api/pending', pendingRoute],
];

describe('the state routes', () => {
  afterEach(() => vi.useRealTimers());

  it.each(ROUTES)('%s gives 401 when signed out', async (path, route) => {
    expect((await get(route, path)).status).toBe(401);
  });

  it.each(ROUTES)('%s sends an ETag and answers 304 for it', async (path, route) => {
    const u = await userInCountry();
    const res = await get(route, path, u.cookie);
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag')!;
    expect(etag).toBeTruthy();
    expect((await get(route, path, u.cookie, etag)).status).toBe(304);
  });

  it('/api/me holds the user, the countries with their counts, and the needs count', async () => {
    const a = await userInCountry();
    const b = await userInCountry();
    await makeJob(a.cc);
    await db.countryPref.upsert({ where: { userId_cc: { userId: a.user.id, cc: 'DE' } }, create: { userId: a.user.id, cc: 'DE', rank: 1, on: false }, update: { on: false } });
    const body = await (await get(meRoute, '/api/me', a.cookie)).json();
    expect(body.user.email).toBe(a.user.email);
    // Countries come from the fixed list, and the count covers every job the user can see.
    expect(body.countries.length).toBeGreaterThan(0);
    expect(body.countries[0]).toEqual(expect.objectContaining({ cc: expect.any(String), on: expect.any(Boolean), count: expect.stringMatching(/^\d+$/) }));
    expect(body.countries.find((c: any) => c.cc === 'DE')).toMatchObject({ on: false });
    expect(body.needsCount).toBe(0);
    expect(body.analysing).toBeDefined();
    expect(body.claude).toBeDefined();
    expect(JSON.stringify(body)).not.toContain(b.user.email);
  });

  it('/api/jobs/list gives the cards of the user, and hides a job that another user pasted', async () => {
    const a = await userInCountry();
    const b = await userInCountry(a.cc);
    const feed = await makeJob(a.cc);
    const mine = await makeJob(a.cc, { pastedBy: a.user.id });
    const theirs = await makeJob(a.cc, { pastedBy: b.user.id });
    const ids = async (u: U) => ((await (await get(jobsRoute, '/api/jobs/list', u.cookie)).json()).jobs as { id: string }[]).map((j) => j.id);
    const forA = await ids(a);
    expect(forA).toContain(feed.id);
    expect(forA).toContain(mine.id);
    expect(forA).not.toContain(theirs.id);
    const forB = await ids(b);
    expect(forB).toContain(feed.id);
    expect(forB).toContain(theirs.id);
    expect(forB).not.toContain(mine.id);
  });

  it('/api/jobs/list sends the posting date as an ISO date, not as relative text', async () => {
    const a = await userInCountry();
    await makeJob(a.cc);
    const [card] = (await (await get(jobsRoute, '/api/jobs/list', a.cookie)).json()).jobs;
    expect(card.postedAt).toBe('2026-10-10T08:00:00.000Z');
    expect(card).not.toHaveProperty('posted');
    expect(card).not.toHaveProperty('days');
  });

  it('/api/jobs/list keeps its ETag after 2 minutes, and changes it after a job changes', async () => {
    const a = await userInCountry();
    const job = await makeJob(a.cc);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    const first = (await get(jobsRoute, '/api/jobs/list', a.cookie)).headers.get('etag');
    vi.setSystemTime(new Date('2026-10-18T12:02:00Z'));
    const later = await get(jobsRoute, '/api/jobs/list', a.cookie, first!);
    expect(later.status).toBe(304);
    await db.job.update({ where: { id: job.id }, data: { role: 'Staff Engineer' } });
    const changed = await get(jobsRoute, '/api/jobs/list', a.cookie, first!);
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(first);
  });

  it('/api/pending keeps its ETag after 2 minutes and holds only the rows of the user', async () => {
    const a = await userInCountry();
    const b = await userInCountry();
    const job = await makeJob(a.cc);
    const app = await db.application.create({ data: { userId: a.user.id, jobId: job.id, status: 'sent' } });
    await db.outreachEvent.create({
      data: { applicationId: app.id, kind: 'request', body: 'Hello', contactName: 'Sam Lee', contactInit: 'SL', createdAt: new Date('2026-10-18T11:55:00Z') },
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    const res = await get(pendingRoute, '/api/pending', a.cookie);
    const body = await res.json();
    expect(body.awaiting).toHaveLength(1);
    expect(body.awaiting[0].sentAt).toBe('2026-10-18T11:55:00.000Z');
    expect(body.awaiting[0]).not.toHaveProperty('when');
    vi.setSystemTime(new Date('2026-10-18T12:02:00Z'));
    expect((await get(pendingRoute, '/api/pending', a.cookie, res.headers.get('etag')!)).status).toBe(304);
    const other = await (await get(pendingRoute, '/api/pending', b.cookie)).json();
    expect(other).toMatchObject({ needs: [], awaiting: [], auto: [], appliedList: [] });
  });
});

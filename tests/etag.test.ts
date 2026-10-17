import { describe, expect, it } from 'vitest';
import { jsonWithEtag } from '@/lib/etag';
import { GET as state } from '@/app/api/state/route';
import { GET as profile } from '@/app/api/profile/route';
import { ctx, makeUser, request } from './helpers/http';

const req = (inm?: string) => new Request('http://localhost/x', { headers: inm ? { 'if-none-match': inm } : {} });

describe('jsonWithEtag', () => {
  it('gives 200 with an ETag, then 304 for the same If-None-Match', async () => {
    const first = jsonWithEtag(req(), { a: 1 });
    const etag = first.headers.get('etag')!;
    expect(first.status).toBe(200);
    expect(etag).toMatch(/^W\/"[A-Za-z0-9_-]{27}"$/);
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    expect(await first.json()).toEqual({ a: 1 });
    const second = jsonWithEtag(req(etag), { a: 1 });
    expect(second.status).toBe(304);
    expect(second.headers.get('etag')).toBe(etag);
    expect(second.headers.get('cache-control')).toBe('private, no-cache');
    expect(await second.text()).toBe('');
  });

  it('gives 200 when the body changes', () => {
    const etag = jsonWithEtag(req(), { a: 1 }).headers.get('etag')!;
    expect(jsonWithEtag(req(etag), { a: 2 }).status).toBe(200);
  });

  it('reads If-None-Match as a list and accepts *', () => {
    const etag = jsonWithEtag(req(), { a: 1 }).headers.get('etag')!;
    expect(jsonWithEtag(req(`W/"other", ${etag}`), { a: 1 }).status).toBe(304);
    expect(jsonWithEtag(req('*'), { a: 1 }).status).toBe(304);
    expect(jsonWithEtag(req('W/"other"'), { a: 1 }).status).toBe(200);
  });
});

describe('ETag on the routes', () => {
  it('/api/state sends an ETag and answers 304 for it', async () => {
    const { cookie } = await makeUser();
    const res = await state(request('/api/state', { cookie }), ctx());
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag')!;
    expect(etag).toBeTruthy();
    const again = await state(request('/api/state', { cookie, headers: { 'if-none-match': etag } }), ctx());
    expect(again.status).toBe(304);
  });

  it('GET /api/profile sends an ETag', async () => {
    const { cookie } = await makeUser();
    const res = await profile(request('/api/profile', { cookie }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBeTruthy();
  });
});

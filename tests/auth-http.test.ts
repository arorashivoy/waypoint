import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { log } from '@/lib/log';
import { publicBase, sameOrigin } from '@/lib/auth/origin';

const req = (headers: Record<string, string>, method = 'POST', body?: string) =>
  new NextRequest('http://localhost:3117/api/x', { method, headers, body });

describe('handle', () => {
  it('turns an HttpError into JSON with its status', async () => {
    const h = handle(async () => { throw new HttpError(404, 'Not found.'); });
    const res = await h(req({}), { params: {} });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found.' });
  });

  it('sends the details of an HttpError with the message', async () => {
    const h = handle(async () => {
      throw new HttpError(422, 'Bad profile.', { errors: ['a: b'] });
    });
    const res = await h(req({}), { params: {} });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'Bad profile.', errors: ['a: b'] });
  });

  it('turns a Prisma "record not found" into 404', async () => {
    const h = handle(async () => { throw Object.assign(new Error('No Job found'), { code: 'P2025' }); });
    expect((await h(req({}), { params: {} })).status).toBe(404);
  });

  it('turns a Prisma "foreign key failed" into 404', async () => {
    const h = handle(async () => { throw Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' }); });
    const res = await h(req({}), { params: {} });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found.' });
  });

  it('hides the message of an unknown error', async () => {
    const spy = vi.spyOn(log, 'error').mockImplementation(() => {});
    const h = handle(async () => { throw new Error('/home/shivoy/secret/path failed'); });
    const res = await h(req({}), { params: {} });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('/home');
    spy.mockRestore();
  });

  it('each response has an x-request-id', async () => {
    const ok = handle(async () => NextResponse.json({ ok: true }));
    const bad = handle(async () => { throw new HttpError(404, 'Not found.'); });
    const notModified = handle(async () => new NextResponse(null, { status: 304 }));
    for (const h of [ok, bad, notModified]) {
      const id = (await h(req({}), { params: {} })).headers.get('x-request-id');
      expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    }
  });

  it('a valid incoming ID is kept', async () => {
    const h = handle(async () => NextResponse.json({ ok: true }));
    const res = await h(req({ 'x-request-id': 'abc-12345678' }), { params: {} });
    expect(res.headers.get('x-request-id')).toBe('abc-12345678');
  });

  it('a bad incoming ID is replaced', async () => {
    const h = handle(async () => NextResponse.json({ ok: true }));
    for (const bad of ['short', 'has space in it 123', 'x'.repeat(65), 'a/b\\c-12345678']) {
      const id = (await h(req({ 'x-request-id': bad }), { params: {} })).headers.get('x-request-id');
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    }
  });

  it('a 500 logs the request ID and no query string', async () => {
    const spy = vi.spyOn(log, 'error').mockImplementation(() => {});
    const h = handle(async () => { throw new Error('boom'); });
    const r = new NextRequest('http://localhost:3117/api/x?token=secret', { method: 'GET', headers: { 'x-request-id': 'req-12345678' } });
    const res = await h(r, { params: {} });
    expect(res.headers.get('x-request-id')).toBe('req-12345678');
    const fields = (spy.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(fields).toMatchObject({ reqId: 'req-12345678', method: 'GET', path: '/api/x' });
    expect(fields.err).toBeInstanceOf(Error);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret');
    spy.mockRestore();
  });

  it('passes a normal response through', async () => {
    const h = handle(async () => NextResponse.json({ ok: true }));
    expect(await (await h(req({}), { params: {} })).json()).toEqual({ ok: true });
  });
});

describe('readJson', () => {
  it('reads an object and refuses other bodies with 400', async () => {
    expect(await readJson(req({}, 'POST', '{"a":1}'))).toEqual({ a: 1 });
    await expect(readJson(req({}, 'POST', 'not json'))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(req({}, 'POST', '[1,2]'))).rejects.toMatchObject({ status: 400 });
  });
});

describe('sameOrigin', () => {
  it('accepts the same host and refuses others', () => {
    expect(sameOrigin(req({ origin: 'http://localhost:3117', host: 'localhost:3117' }))).toBe(true);
    expect(sameOrigin(req({ origin: 'https://evil.test', host: 'localhost:3117' }))).toBe(false);
    expect(sameOrigin(req({ host: 'localhost:3117' }))).toBe(false);
    expect(sameOrigin(req({ origin: 'null', host: 'localhost:3117' }))).toBe(false);
  });

  it('accepts X-Forwarded-Host', () => {
    expect(sameOrigin(req({ origin: 'https://a.test', host: 'localhost:3118', 'x-forwarded-host': 'a.test' }))).toBe(true);
  });

  it('accepts the public URL', () => {
    vi.stubEnv('WAYPOINT_PUBLIC_URL', 'https://wp.shares.zrok.io');
    try {
      expect(sameOrigin(req({ origin: 'https://wp.shares.zrok.io', host: 'localhost:3118' }))).toBe(true);
      expect(publicBase(req({ host: 'localhost:3118' }))).toBe('https://wp.shares.zrok.io');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('builds the base from the forwarded headers without a public URL', () => {
    expect(publicBase(req({ host: 'localhost:3118', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'a.test' }))).toBe('https://a.test');
    expect(publicBase(req({ host: 'localhost:3118' }))).toBe('http://localhost:3118');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { handle, HttpError, readJson } from '@/lib/auth/http';
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

  it('turns a Prisma "record not found" into 404', async () => {
    const h = handle(async () => { throw Object.assign(new Error('No Job found'), { code: 'P2025' }); });
    expect((await h(req({}), { params: {} })).status).toBe(404);
  });

  it('hides the message of an unknown error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = handle(async () => { throw new Error('/home/shivoy/secret/path failed'); });
    const res = await h(req({}), { params: {} });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('/home');
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

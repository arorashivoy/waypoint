import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareResume } from '@/lib/gdrive';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Drive fetches', () => {
  it('each Drive fetch has a 30-second signal', async () => {
    vi.stubEnv('GDRIVE_CLIENT_ID', 'id');
    vi.stubEnv('GDRIVE_CLIENT_SECRET', 'secret');
    vi.stubEnv('GDRIVE_REFRESH_TOKEN', 'refresh');
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes('oauth2') ? { access_token: 'a', expires_in: 3600 } : { id: 'f1', webViewLink: 'https://drive.test/f1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pdf = join(mkdtempSync(join(tmpdir(), 'drive-')), 'cv.pdf');
    writeFileSync(pdf, '%PDF-1');
    const r = await shareResume(pdf, 'Acme', 'Engineer', { id: null, url: null, uploaded: null });
    expect(r.url).toBe('https://drive.test/f1');
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(30_000);
  });

  it('keeps a secret out of the reason when Drive refuses the upload', async () => {
    vi.stubEnv('GDRIVE_CLIENT_ID', 'id');
    vi.stubEnv('GDRIVE_CLIENT_SECRET', 'secret');
    vi.stubEnv('GDRIVE_REFRESH_TOKEN', 'refresh');
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('oauth2')
        ? new Response(JSON.stringify({ access_token: 'a', expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: 'Invalid Bearer ya29.plainsecret123 and api_key=plainkey123456' } }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pdf = join(mkdtempSync(join(tmpdir(), 'drive-')), 'cv.pdf');
    writeFileSync(pdf, '%PDF-1');
    const r = await shareResume(pdf, 'Acme', 'Engineer', { id: null, url: null, uploaded: null });
    expect(r.url).toBeNull();
    expect(r.reason).toContain('Drive upload failed');
    expect(r.reason).not.toMatch(/plainsecret123|plainkey123456/);
    expect(r.reason).toContain('[removed]');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ApiError, leaveSession, upload } from '@/components/api';

describe('globals.css: .settings-body', () => {
  it('puts the base rule before the phone rule, so the phone rule wins', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const base = css.search(/^\.settings-body\s*\{/m);
    const phoneBlock = css.indexOf('@media (max-width: 1023px)');
    const phoneRule = css.indexOf('.settings-body', phoneBlock);
    expect(base).toBeGreaterThan(-1);
    expect(phoneBlock).toBeGreaterThan(-1);
    expect(phoneRule).toBeGreaterThan(phoneBlock);
    expect(base).toBeLessThan(phoneBlock);
  });
});

describe('globals.css: .profile-body', () => {
  it('puts the base rule before the phone rule, so the phone rule wins', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const base = css.search(/^\.profile-body\s*\{/m);
    const phoneBlock = css.indexOf('@media (max-width: 1023px)');
    expect(base).toBeGreaterThan(-1);
    expect(base).toBeLessThan(phoneBlock);
    expect(css.indexOf('.profile-body', phoneBlock)).toBeGreaterThan(phoneBlock);
  });
});

describe('leaveSession (sign out from Settings)', () => {
  it('goes to /login when the request works, and shows no message', async () => {
    const go = vi.fn();
    const toast = vi.fn();
    await leaveSession(async () => ({ ok: true }), toast, go);
    expect(go).toHaveBeenCalledWith('/login');
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows the error and stays on the page when the request fails', async () => {
    const go = vi.fn();
    const toast = vi.fn();
    await leaveSession(async () => { throw new ApiError('Something went wrong.', 500); }, toast, go);
    expect(toast).toHaveBeenCalledWith('Something went wrong.');
    expect(go).not.toHaveBeenCalled();
  });
});

describe('upload', () => {
  it('posts the file as the form field "file" and gives the error body to ApiError', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.body as FormData).get('file')).toBeInstanceOf(File);
      return new Response(JSON.stringify({ error: 'The file has errors.', errors: ['a: b'] }), { status: 422 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(upload('/api/profile/yaml', new File(['x'], 'claims.yml'))).rejects.toMatchObject({ status: 422, data: { errors: ['a: b'] } });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

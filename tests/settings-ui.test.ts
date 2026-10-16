import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ApiError, leaveSession } from '@/components/api';

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

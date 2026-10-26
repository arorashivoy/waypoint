import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { POST as login } from '@/app/api/auth/login/route';
import { requireTurnstile, turnstileSiteKey } from '@/lib/auth/turnstile';
import { ctx, makeUser, request, TEST_PASSWORD } from './helpers/http';

const ip = () => `203.0.113.${Math.floor(Math.random() * 250)}-${randomBytes(3).toString('hex')}`;
const answer = (success: boolean) => vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('requireTurnstile', () => {
  it('is off without a secret, and the form gets no site key', async () => {
    vi.stubEnv('WAYPOINT_TURNSTILE_SECRET', '');
    vi.stubEnv('WAYPOINT_TURNSTILE_SITE_KEY', 'site');
    const fetch = answer(false);
    vi.stubGlobal('fetch', fetch);
    await expect(requireTurnstile(undefined, '1.2.3.4')).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(turnstileSiteKey()).toBeNull();
  });

  it('sends the secret, the token and the IP address to Cloudflare', async () => {
    vi.stubEnv('WAYPOINT_TURNSTILE_SECRET', 'sec');
    vi.stubEnv('WAYPOINT_TURNSTILE_SITE_KEY', 'site');
    const fetch = answer(true);
    vi.stubGlobal('fetch', fetch);
    await requireTurnstile('tok', '1.2.3.4');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ secret: 'sec', response: 'tok', remoteip: '1.2.3.4' });
    expect(turnstileSiteKey()).toBe('site');
  });

  it('refuses a missing token without a call, a refused token, and a network failure', async () => {
    vi.stubEnv('WAYPOINT_TURNSTILE_SECRET', 'sec');
    const fetch = answer(false);
    vi.stubGlobal('fetch', fetch);
    await expect(requireTurnstile(undefined, '1.2.3.4')).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
    await expect(requireTurnstile('tok', '1.2.3.4')).rejects.toMatchObject({ status: 400 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(requireTurnstile('tok', '1.2.3.4')).rejects.toMatchObject({ status: 400 });
  });
});

describe('POST /api/auth/login with Turnstile on', () => {
  const tryLogin = (body: Record<string, unknown>) =>
    login(request('/api/auth/login', { method: 'POST', body, headers: { 'x-forwarded-for': ip() } }), ctx());

  it('refuses a right password without a token, and signs in with an accepted token', async () => {
    const { user } = await makeUser();
    vi.stubEnv('WAYPOINT_TURNSTILE_SECRET', 'sec');
    vi.stubGlobal('fetch', answer(true));
    expect((await tryLogin({ email: user.email, password: TEST_PASSWORD })).status).toBe(400);
    expect((await tryLogin({ email: user.email, password: TEST_PASSWORD, turnstile: 'tok' })).status).toBe(200);
  });
});

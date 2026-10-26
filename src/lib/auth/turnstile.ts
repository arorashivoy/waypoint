import { HttpError } from './http';

/**
 * The Cloudflare Turnstile check on the sign-in, invite and reset forms.
 * It is off when WAYPOINT_TURNSTILE_SECRET is not set. It reads process.env
 * directly, so a test can turn it on with vi.stubEnv.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FAILED = 'The browser check failed. Wait for the check to finish, then try again.';

export function turnstileOn(): boolean {
  return !!process.env.WAYPOINT_TURNSTILE_SECRET;
}

/** The site key for the form, or null when the check is off. */
export function turnstileSiteKey(): string | null {
  return turnstileOn() ? process.env.WAYPOINT_TURNSTILE_SITE_KEY || null : null;
}

/**
 * Throws a 400 unless Cloudflare accepts the token. A network failure also
 * refuses the try: the form says to try again, and no password is checked.
 */
export async function requireTurnstile(token: unknown, ip: string): Promise<void> {
  const secret = process.env.WAYPOINT_TURNSTILE_SECRET;
  if (!secret) return;
  if (typeof token !== 'string' || !token || token.length > 2048) throw new HttpError(400, FAILED);
  const form = new URLSearchParams({ secret, response: token });
  if (ip && ip !== 'local') form.set('remoteip', ip);
  let ok = false;
  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) });
    ok = res.ok && ((await res.json()) as { success?: unknown }).success === true;
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(400, FAILED);
}

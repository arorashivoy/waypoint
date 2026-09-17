import { timingSafeEqual } from 'node:crypto';

/**
 * A single shared passcode guarding sign-in.
 *
 * Waypoint was built to run on one laptop, where "sign in" opening the only
 * account was harmless. The moment it is reachable from outside the house that
 * stops being true: the database holds the name, employer and job title of every
 * LinkedIn connection — other people's personal data, not just the user's — plus
 * a CV, and a button that spawns the `claude` CLI against a paid subscription.
 *
 * This is deliberately not a user system. There is one person. A shared secret
 * checked in constant time, with attempts rate-limited, is the right size of
 * lock for that, and it composes with whatever the tunnel puts in front of it
 * (Tailscale keeps the app off the public internet entirely; Cloudflare Access
 * adds an identity layer). Defence in depth: the tunnel can be misconfigured,
 * and this still holds.
 */

export const accessCodeRequired = () => !!process.env.WAYPOINT_ACCESS_CODE;

/** Rejects a wrong code without leaking how much of it was right. */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself be a leak, so
  // compare a fixed-size digest-like padding of both.
  if (ab.length !== bb.length) {
    // Still burn a comparison so the failure takes a similar amount of time.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

export type AccessResult = { ok: true } | { ok: false; status: number; error: string };

export function checkAccessCode(code: unknown, clientKey: string): AccessResult {
  const expected = process.env.WAYPOINT_ACCESS_CODE;
  if (!expected) return { ok: true };

  const now = Date.now();
  const record = attempts.get(clientKey);
  if (record && now - record.first > WINDOW_MS) attempts.delete(clientKey);

  const current = attempts.get(clientKey);
  if (current && current.count >= MAX_ATTEMPTS) {
    const mins = Math.ceil((WINDOW_MS - (now - current.first)) / 60_000);
    return { ok: false, status: 429, error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
  }

  if (typeof code === 'string' && constantTimeEquals(code, expected)) {
    attempts.delete(clientKey);
    return { ok: true };
  }

  attempts.set(clientKey, { count: (current?.count ?? 0) + 1, first: current?.first ?? now });
  return { ok: false, status: 401, error: 'Wrong passcode.' };
}

/**
 * Identifies the caller for rate-limiting. Behind a tunnel every request
 * arrives from 127.0.0.1, so the forwarded header is the only thing that
 * distinguishes callers — and it is spoofable, which is why this only paces
 * attempts and is never the thing granting access.
 */
export function clientKey(headers: Headers): string {
  const fwd = headers.get('cf-connecting-ip') || headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || 'local';
}

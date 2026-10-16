import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createUser } from '@/lib/auth/users';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';

export const ORIGIN = 'http://localhost:3117';
export const TEST_PASSWORD = 'violet kettle drums 4417';

/** A new user with a random email and one session. */
export async function makeUser(role: 'admin' | 'member' = 'member') {
  const email = `u-${randomBytes(6).toString('hex')}@test.local`;
  const user = await createUser({ email, name: 'Test User', password: TEST_PASSWORD, role });
  const token = await createSession(user.id, 'vitest');
  return { user, token, cookie: `${SESSION_COOKIE}=${token}` };
}

/** A request as the browser sends it: same Origin and Host, JSON or form body. */
export function request(
  path: string,
  init: { method?: string; cookie?: string; body?: unknown; form?: FormData; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers({ origin: ORIGIN, host: 'localhost:3117', ...init.headers });
  if (init.cookie) headers.set('cookie', init.cookie);
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.body);
  }
  return new NextRequest(new URL(path, ORIGIN), { method: init.method ?? 'GET', headers, body });
}

/**
 * A form upload as the browser sends it: the multipart body with its
 * Content-Length. `headers` can replace or (with null) remove a header.
 */
export async function formRequest(path: string, form: FormData, init: { cookie?: string; headers?: Record<string, string | null> } = {}): Promise<NextRequest> {
  const encoded = new Response(form);
  const body = Buffer.from(await encoded.arrayBuffer());
  const headers = new Headers({ origin: ORIGIN, host: 'localhost:3117', 'content-type': encoded.headers.get('content-type')!, 'content-length': String(body.length) });
  if (init.cookie) headers.set('cookie', init.cookie);
  for (const [k, v] of Object.entries(init.headers ?? {})) {
    if (v === null) headers.delete(k);
    else headers.set(k, v);
  }
  return new NextRequest(new URL(path, ORIGIN), { method: 'POST', headers, body });
}

export const ctx = <P extends Record<string, string> = Record<string, string>>(params = {} as P) => ({ params });

/** The value of the session cookie that a response sets, or null. */
export function cookieFrom(res: Response): string | null {
  const set = res.headers.get('set-cookie') ?? '';
  const m = set.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return m ? m[1] : null;
}

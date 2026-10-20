import { request, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ADMIN, BASE_URL, PASSWORD, PROJECTS, memberOf, stateFile } from './accounts';

/**
 * Signs in one time for the whole run and saves the cookies. The sign-in API allows few tries,
 * so no test signs in again, except the sign-in test itself. Each sign-in comes from its own
 * made-up address, so the limit for one address does not fill.
 */
export default async function globalSetup(_config: FullConfig) {
  const accounts = [{ who: 'admin', email: ADMIN.email }, ...PROJECTS.map((p) => ({ who: p, email: memberOf(p).email }))];
  for (const [i, { who, email }] of accounts.entries()) {
    const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL, 'x-forwarded-for': `10.20.0.${i + 1}` } });
    const res = await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } });
    if (!res.ok()) throw new Error(`Sign-in of ${email} failed: ${res.status()} ${await res.text()}`);
    mkdirSync(dirname(stateFile(who)), { recursive: true });
    await ctx.storageState({ path: stateFile(who) });
    await ctx.dispose();
  }
  await warmUp();
}

/**
 * The dev server compiles each page and route on its first request, and a test must not wait for that.
 * This asks for each one once, as the admin and as a member.
 */
async function warmUp() {
  for (const who of ['admin', PROJECTS[0]]) {
    const ctx = await request.newContext({ baseURL: BASE_URL, storageState: stateFile(who) });
    const list = (await (await ctx.get('/api/jobs/list')).json()) as { jobs?: { id: string }[] } | { id: string }[];
    const id = (Array.isArray(list) ? list : (list.jobs ?? []))[0]?.id;
    const paths = ['/', '/api/me', '/api/onboarding', '/api/settings/search', '/api/profile', '/api/pending', '/api/tasks'];
    if (id) paths.push(`/?job=${id}`, `/api/jobs/${id}`);
    for (const path of paths) await ctx.get(path);
    await ctx.dispose();
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { saveSecret } from '@/lib/secrets';
import { listRepos, readme } from '@/lib/github';
import { GET as getToken, PUT as putToken, DELETE as deleteToken } from '@/app/api/account/github/route';
import { ctx, makeUser, request } from './helpers/http';

type Call = { url: string; headers: Record<string, string> };
function stubGithub(routes: Record<string, { status?: number; body?: unknown; etag?: string }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      calls.push({ url, headers });
      const u = new URL(url);
      const hit = routes[u.pathname + u.search] ?? routes[u.pathname];
      if (!hit) return new Response('not found', { status: 404 });
      if (hit.etag && headers['if-none-match'] === hit.etag) return new Response(null, { status: 304 });
      const body = typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body);
      return new Response(body, { status: hit.status ?? 200, headers: hit.etag ? { etag: hit.etag } : {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const REPOS = [
  { name: 'parser', owner: { login: 'octo' }, description: 'Fast JSON', fork: false, language: 'Rust', topics: ['json'], stargazers_count: 3, pushed_at: '2026-01-01T00:00:00Z', private: false, html_url: 'https://evil.test/x' },
  { name: 'fork-of-x', owner: { login: 'octo' }, description: null, fork: true, language: null, topics: [], stargazers_count: 0, pushed_at: null, private: false },
  { name: '../../etc', owner: { login: 'octo' }, fork: false },
];

describe('github client', () => {
  it('lists repos from api.github.com only, builds the URL itself and drops bad names', async () => {
    const { user } = await makeUser();
    const calls = stubGithub({ '/users/octo/repos': { body: REPOS } });
    const repos = await listRepos(user.id, 'octo');
    expect(repos.map((r) => r.name)).toEqual(['parser', 'fork-of-x']);
    expect(repos[0]).toMatchObject({ owner: 'octo', htmlUrl: 'https://github.com/octo/parser', fork: false, topics: ['json'] });
    expect(calls.every((c) => new URL(c.url).host === 'api.github.com')).toBe(true);
  });

  it('refuses a user name that is not a GitHub name, before any request', async () => {
    const { user } = await makeUser();
    const calls = stubGithub({});
    for (const name of ['../x', 'a/b', 'evil.test', '-a', 'x'.repeat(40)]) await expect(listRepos(user.id, name)).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });

  it('sends the ETag again and uses the cached reply on 304, for each user', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const calls = stubGithub({ '/users/octo/repos': { body: REPOS, etag: '"v1"' } });
    await listRepos(a.user.id, 'octo');
    expect((await listRepos(a.user.id, 'octo')).length).toBe(2);
    expect(calls[1].headers['if-none-match']).toBe('"v1"');
    await listRepos(b.user.id, 'octo');
    expect(calls[2].headers['if-none-match']).toBeUndefined();
  });

  it('uses /user/repos with the token when the token belongs to that user', async () => {
    const { user } = await makeUser();
    await saveSecret(user.id, 'github', 'ghp_' + 'a'.repeat(36));
    const calls = stubGithub({ '/user': { body: { login: 'Octo' } }, '/user/repos': { body: REPOS.slice(0, 1) } });
    expect((await listRepos(user.id, 'octo')).length).toBe(1);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/user', '/user/repos']);
    expect(calls[0].headers.authorization).toBe(`Bearer ghp_${'a'.repeat(36)}`);
  });

  it('maps GitHub errors to clear statuses', async () => {
    const { user } = await makeUser();
    stubGithub({ '/users/ghost/repos': { status: 404, body: {} }, '/users/limited/repos': { status: 403, body: {} } });
    await expect(listRepos(user.id, 'ghost')).rejects.toMatchObject({ status: 404 });
    await expect(listRepos(user.id, 'limited')).rejects.toMatchObject({ status: 429 });
  });

  it('cuts the README to 4 KB and gives an empty README for 404', async () => {
    const { user } = await makeUser();
    stubGithub({ '/repos/octo/parser/readme': { body: 'x'.repeat(10_000) } });
    const repo = { owner: 'octo', name: 'parser' } as never;
    expect((await readme(user.id, repo, null)).length).toBe(4096);
    expect(await readme(user.id, { owner: 'octo', name: 'none' } as never, null)).toBe('');
  });
});

describe('/api/account/github', () => {
  it('saves a token, shows only its last 4 characters, and clears the cache on a change', async () => {
    const u = await makeUser();
    await db.githubCache.create({ data: { userId: u.user.id, url: 'x', etag: 'e', body: 'private' } });
    expect((await putToken(request('/api/account/github', { method: 'PUT', cookie: u.cookie, body: { token: 'not a token' } }), ctx())).status).toBe(400);
    const r = await (await putToken(request('/api/account/github', { method: 'PUT', cookie: u.cookie, body: { token: `github_pat_${'b'.repeat(40)}` } }), ctx())).json();
    expect(r.hint).toBe('bbbb');
    expect(JSON.stringify(r)).not.toContain('github_pat_');
    expect(await db.githubCache.count({ where: { userId: u.user.id } })).toBe(0);
    expect((await (await getToken(request('/api/account/github', { cookie: u.cookie }), ctx())).json()).hint).toBe('bbbb');
    expect((await (await deleteToken(request('/api/account/github', { method: 'DELETE', cookie: u.cookie }), ctx())).json()).hint).toBeNull();
  });
});

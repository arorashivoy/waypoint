import { db } from './db';
import { HttpError } from './auth/http';
import { readSecret } from './secrets';

/**
 * The GitHub client (spec 3.3 and 6.6). Every request goes to
 * https://api.github.com. The code builds each path from a user name that
 * passes GITHUB_USER and a repo name from GitHub's own list. A URL from a user
 * or a model never becomes a fetch target. Each reply is cached with its ETag
 * for each user, because a token can read private repos.
 */

const ORIGIN = 'https://api.github.com';
export const GITHUB_USER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_BODY = 1024 * 1024;
export const README_BYTES = 4096;

export type Repo = {
  owner: string;
  name: string;
  description: string | null;
  fork: boolean;
  language: string | null;
  topics: string[];
  htmlUrl: string;
  stars: number;
  pushedAt: string | null;
  private: boolean;
};

export const githubToken = (userId: string) => readSecret(userId, 'github');

function fail(status: number): never {
  if (status === 401) throw new HttpError(400, 'GitHub refused the token. Check it in Settings → Integrations.');
  if (status === 403 || status === 429) throw new HttpError(429, 'GitHub limits the requests now. Try again later, or add a token in Settings → Integrations.');
  if (status === 404) throw new HttpError(404, 'GitHub has no user or repo with that name.');
  throw new HttpError(502, `GitHub answered with status ${status}.`);
}

async function get(userId: string, path: string, token: string | null, accept = 'application/vnd.github+json'): Promise<{ status: number; body: string }> {
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN) throw new Error('A GitHub request must go to api.github.com.');
  const key = `${accept} ${url.pathname}${url.search}`;
  const cached = await db.githubCache.findUnique({ where: { userId_url: { userId, url: key } } });
  const headers: Record<string, string> = { accept, 'user-agent': 'waypoint', 'x-github-api-version': '2022-11-28' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cached) headers['if-none-match'] = cached.etag;
  let res: Response;
  try {
    res = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new HttpError(502, 'GitHub did not answer. Try again later.');
  }
  if (res.status === 304 && cached) return { status: 200, body: cached.body };
  const body = (await res.text()).slice(0, MAX_BODY);
  const etag = res.headers.get('etag');
  if (res.ok && etag) {
    await db.githubCache.upsert({
      where: { userId_url: { userId, url: key } },
      create: { userId, url: key, etag, body },
      update: { etag, body, fetchedAt: new Date() },
    });
  }
  return { status: res.status, body };
}

const json = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    throw new HttpError(502, 'GitHub sent a reply that is not JSON.');
  }
};

/** The repos of a user, newest push first (at most 100). With the user's own token, private repos too. */
export async function listRepos(userId: string, username: string): Promise<Repo[]> {
  if (!GITHUB_USER.test(username)) throw new HttpError(400, 'This is not a GitHub user name.');
  const token = await githubToken(userId);
  let path = `/users/${username}/repos?per_page=100&sort=pushed&type=owner`;
  if (token) {
    const me = await get(userId, '/user', token);
    if (me.status !== 200) fail(me.status);
    const login = String((json(me.body) as { login?: unknown }).login ?? '');
    if (login.toLowerCase() === username.toLowerCase()) path = '/user/repos?per_page=100&sort=pushed&affiliation=owner';
  }
  const r = await get(userId, path, token);
  if (r.status !== 200) fail(r.status);
  const rows = json(r.body);
  if (!Array.isArray(rows)) throw new HttpError(502, 'GitHub sent a reply in an unknown shape.');
  return rows.slice(0, 100).flatMap((x: Record<string, any>) => {
    const owner = String(x?.owner?.login ?? '');
    const name = String(x?.name ?? '');
    if (!GITHUB_USER.test(owner) || !REPO_NAME.test(name) || name === '.' || name === '..') return [];
    return [
      {
        owner,
        name,
        description: typeof x.description === 'string' ? x.description.slice(0, 400) : null,
        fork: x.fork === true,
        language: typeof x.language === 'string' ? x.language.slice(0, 60) : null,
        topics: Array.isArray(x.topics) ? x.topics.filter((t: unknown): t is string => typeof t === 'string').slice(0, 20).map((t: string) => t.slice(0, 60)) : [],
        // Built here, not taken from the reply.
        htmlUrl: `https://github.com/${owner}/${name}`,
        stars: Number.isFinite(x.stargazers_count) ? Number(x.stargazers_count) : 0,
        pushedAt: typeof x.pushed_at === 'string' ? x.pushed_at : null,
        private: x.private === true,
      },
    ];
  });
}

/** The first 4 KB of the README, or '' when there is none. */
export async function readme(userId: string, repo: Pick<Repo, 'owner' | 'name'>, token: string | null): Promise<string> {
  const r = await get(userId, `/repos/${repo.owner}/${repo.name}/readme`, token, 'application/vnd.github.raw');
  if (r.status === 404) return '';
  if (r.status !== 200) fail(r.status);
  return Buffer.from(r.body, 'utf8').subarray(0, README_BYTES).toString('utf8').replace(/�+$/, '');
}

export async function languages(userId: string, repo: Pick<Repo, 'owner' | 'name'>, token: string | null): Promise<string[]> {
  const r = await get(userId, `/repos/${repo.owner}/${repo.name}/languages`, token);
  if (r.status === 404) return [];
  if (r.status !== 200) fail(r.status);
  const v = json(r.body);
  return v && typeof v === 'object' ? Object.keys(v).slice(0, 10).map((k) => k.slice(0, 60)) : [];
}

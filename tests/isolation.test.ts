import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

vi.mock('@/lib/claude/credential', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude/credential')>()),
  credentialFor: vi.fn(async () => null),
}));

vi.mock('@/lib/cv', async (orig) => ({
  ...(await orig<typeof import('@/lib/cv')>()),
  buildCv: vi.fn(async () => ({ path: fileURLToPath(import.meta.url), tailored: false })),
}));

// refineCv reads claims.yml and the LaTeX source before the Claude call. Stub both, so the test does not need data/profile/ or .env.
vi.mock('@/lib/user', async (orig) => ({
  ...(await orig<typeof import('@/lib/user')>()),
  claimsFor: vi.fn(async () => ({}) as never),
}));
vi.mock('@/lib/resume', async (orig) => ({
  ...(await orig<typeof import('@/lib/resume')>()),
  resumeMenu: vi.fn(() => ({ projects: [], bullets: [], skills: [] }) as never),
  buildResume: vi.fn(async () => ({ path: null, tailored: false, order: [], experience: [], skillsLead: [] }) as never),
}));

import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '@/lib/db';
import { runOnce } from '@/lib/tasks/worker';
import '@/lib/tasks/handlers';
import { ctx, formRequest, makeUser, request } from './helpers/http';
import * as claudeRoute from '@/app/api/claude/route';
import * as countries from '@/app/api/countries/route';
import * as jobDetail from '@/app/api/jobs/[id]/route';
import * as taskRoute from '@/app/api/tasks/[id]/route';
import * as jobResume from '@/app/api/jobs/[id]/resume/route';
import * as refine from '@/app/api/jobs/[id]/resume/refine/route';
import * as refresh from '@/app/api/jobs/refresh/route';
import * as feeds from '@/app/api/feeds/route';
import * as outreach from '@/app/api/outreach/route';
import * as outreachEvent from '@/app/api/outreach/[id]/route';
import * as profileRoute from '@/app/api/profile/route';
import * as profileMeta from '@/app/api/profile/meta/route';
import * as itemsAdd from '@/app/api/profile/items/[kind]/route';
import * as itemOne from '@/app/api/profile/items/[kind]/[key]/route';
import * as revisions from '@/app/api/profile/revisions/route';
import * as revisionRestore from '@/app/api/profile/revisions/[id]/restore/route';
import * as profileExport from '@/app/api/profile/export/route';
import * as profileYaml from '@/app/api/profile/yaml/route';
import * as profileImport from '@/app/api/profile/import/route';
import * as resumeImport from '@/app/api/profile/resume-import/route';
import * as profileDrafts from '@/app/api/profile/drafts/route';
import * as draftsAccept from '@/app/api/profile/drafts/accept/route';
import * as draftsReject from '@/app/api/profile/drafts/reject/route';
import * as draftOne from '@/app/api/profile/drafts/[id]/route';
import * as draftApprove from '@/app/api/profile/drafts/[id]/approve/route';
import * as resumeFile from '@/app/api/resume/[id]/route';
import * as stateRoute from '@/app/api/state/route';
import * as settingsSearch from '@/app/api/settings/search/route';
import * as account from '@/app/api/account/route';
import * as password from '@/app/api/account/password/route';
import * as sessions from '@/app/api/account/sessions/route';
import * as sessionOne from '@/app/api/account/sessions/[id]/route';
import * as accountClaude from '@/app/api/account/claude/route';
import * as accountGithub from '@/app/api/account/github/route';
import * as githubRepos from '@/app/api/profile/github/repos/route';
import * as githubImport from '@/app/api/profile/github/import/route';
import * as adminInvites from '@/app/api/admin/invites/route';
import * as adminHealth from '@/app/api/admin/health/route';
import * as adminUsers from '@/app/api/admin/users/route';
import * as adminUser from '@/app/api/admin/users/[id]/route';
import * as adminReset from '@/app/api/admin/users/[id]/reset/route';

type Handler = (req: ReturnType<typeof request>, c: ReturnType<typeof ctx>) => Promise<Response>;

/** User A with a job, an application, an outreach event and a contact. */
async function seedA() {
  const a = await makeUser();
  const job = await db.job.create({
    data: { externalId: `iso-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test' },
  });
  const app = await db.application.create({ data: { userId: a.user.id, jobId: job.id, status: 'sent', note: 'note of A', cvChat: '[{"role":"you","text":"secret chat of A","at":"x"}]' } });
  const event = await db.outreachEvent.create({ data: { applicationId: app.id, kind: 'request', contactName: 'Contact Of A', body: 'message of A', handled: true } });
  await db.contact.create({ data: { userId: a.user.id, firstName: 'Private', lastName: 'Connection', company: 'Acme' } });
  return { a, job, app, event };
}

describe('every route refuses a request without a session', () => {
  const routes: [string, Handler, Record<string, string>?][] = [
    ['GET /api/claude', claudeRoute.GET as Handler],
    ['POST /api/countries', countries.POST as Handler],
    ['GET /api/jobs/[id]', jobDetail.GET as Handler, { id: 'x' }],
    ['POST /api/jobs/[id]', jobDetail.POST as Handler, { id: 'x' }],
    ['PATCH /api/jobs/[id]', jobDetail.PATCH as Handler, { id: 'x' }],
    ['POST /api/jobs/[id]/resume', jobResume.POST as Handler, { id: 'x' }],
    ['POST /api/jobs/[id]/resume/refine', refine.POST as Handler, { id: 'x' }],
    ['DELETE /api/jobs/[id]/resume/refine', refine.DELETE as Handler, { id: 'x' }],
    ['POST /api/jobs/refresh', refresh.POST as Handler],
    ['GET /api/feeds', feeds.GET as Handler],
    ['GET /api/tasks/[id]', taskRoute.GET as Handler, { id: 'x' }],
    ['POST /api/outreach', outreach.POST as Handler],
    ['PATCH /api/outreach/[id]', outreachEvent.PATCH as Handler, { id: 'x' }],
    ['GET /api/profile', profileRoute.GET as Handler],
    ['PUT /api/profile/meta', profileMeta.PUT as Handler],
    ['POST /api/profile/items/[kind]', itemsAdd.POST as Handler, { kind: 'project' }],
    ['PUT /api/profile/items/[kind]/[key]', itemOne.PUT as Handler, { kind: 'project', key: 'x' }],
    ['DELETE /api/profile/items/[kind]/[key]', itemOne.DELETE as Handler, { kind: 'project', key: 'x' }],
    ['GET /api/profile/revisions', revisions.GET as Handler],
    ['POST /api/profile/revisions/[id]/restore', revisionRestore.POST as Handler, { id: 'x' }],
    ['POST /api/profile/import', profileImport.POST as Handler],
    ['GET /api/profile/export', profileExport.GET as Handler],
    ['POST /api/profile/yaml', profileYaml.POST as Handler],
    ['POST /api/profile/resume-import', resumeImport.POST as Handler],
    ['POST /api/profile/github/repos', githubRepos.POST as Handler],
    ['POST /api/profile/github/import', githubImport.POST as Handler],
    ['DELETE /api/account', account.DELETE as Handler],
    ['GET /api/account/github', accountGithub.GET as Handler],
    ['PUT /api/account/github', accountGithub.PUT as Handler],
    ['DELETE /api/account/github', accountGithub.DELETE as Handler],
    ['GET /api/profile/drafts', profileDrafts.GET as Handler],
    ['POST /api/profile/drafts/accept', draftsAccept.POST as Handler],
    ['POST /api/profile/drafts/reject', draftsReject.POST as Handler],
    ['PUT /api/profile/drafts/[id]', draftOne.PUT as Handler, { id: 'x' }],
    ['POST /api/profile/drafts/[id]/approve', draftApprove.POST as Handler, { id: 'x' }],
    ['GET /api/resume/[id]', resumeFile.GET as Handler, { id: 'x' }],
    ['GET /api/state', stateRoute.GET as Handler],
    ['GET /api/settings/search', settingsSearch.GET as Handler],
    ['PATCH /api/settings/search', settingsSearch.PATCH as Handler],
    ['POST /api/account/password', password.POST as Handler],
    ['GET /api/account/sessions', sessions.GET as Handler],
    ['DELETE /api/account/sessions', sessions.DELETE as Handler],
    ['DELETE /api/account/sessions/[id]', sessionOne.DELETE as Handler, { id: 'x' }],
    ['GET /api/account/claude', accountClaude.GET as Handler],
    ['PUT /api/account/claude', accountClaude.PUT as Handler],
    ['DELETE /api/account/claude', accountClaude.DELETE as Handler],
    ['POST /api/admin/invites', adminInvites.POST as Handler],
    ['GET /api/admin/health', adminHealth.GET as Handler],
    ['GET /api/admin/users', adminUsers.GET as Handler],
    ['PATCH /api/admin/users/[id]', adminUser.PATCH as Handler, { id: 'x' }],
    ['POST /api/admin/users/[id]/reset', adminReset.POST as Handler, { id: 'x' }],
  ];

  // These answer without a session on purpose.
  const PUBLIC = ['/api/auth/login', '/api/auth/signout', '/api/invites/[token]', '/api/health'];
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  /** Every route.ts under src/app/api, as its URL path ("/api/jobs/[id]"). */
  function routeFiles(dir = 'src/app/api'): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const full = join(dir, d.name);
      if (d.isDirectory()) return routeFiles(full);
      return d.name === 'route.ts' ? [full] : [];
    });
  }
  const urlOf = (file: string) => '/' + relative('src/app', file).split(sep).slice(0, -1).join('/');

  it('lists every method of every route, or names the route as public', async () => {
    const files = routeFiles();
    expect(files.length).toBeGreaterThan(20);
    const listed = new Set(routes.map(([name]) => name));
    const missing: string[] = [];
    for (const file of files) {
      const url = urlOf(file);
      if (PUBLIC.includes(url)) continue;
      const mod: Record<string, unknown> = await import(/* @vite-ignore */ fileURLToPath(new URL(`../${file}`, import.meta.url)));
      for (const m of METHODS) if (typeof mod[m] === 'function' && !listed.has(`${m} ${url}`)) missing.push(`${m} ${url}`);
    }
    expect(missing).toEqual([]);
  });

  for (const [name, handler, params] of routes) {
    it(name, async () => {
      const [method, path] = name.split(' ');
      const res = await handler(request(path, { method, body: method === 'GET' ? undefined : {} }), ctx(params));
      expect(res.status).toBe(401);
    });
  }
});

describe('user B cannot reach the rows of user A', () => {
  it('GET /api/state shows B only its own data', async () => {
    await seedA();
    const b = await makeUser();
    const body = JSON.stringify(await (await stateRoute.GET(request('/api/state', { cookie: b.cookie }), ctx())).json());
    expect(body).not.toContain('note of A');
    expect(body).not.toContain('Contact Of A');
    expect(body).not.toContain('Private');
  });

  it("GET /api/jobs/[id] does not show A's referral or chat", async () => {
    const { job } = await seedA();
    const b = await makeUser();
    const res = await jobDetail.GET(request(`/api/jobs/${job.id}`, { cookie: b.cookie }), ctx({ id: job.id }));
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('message of A');
    expect(body).not.toContain('secret chat of A');
  });

  it("PATCH /api/jobs/[id] changes B's application, not A's", async () => {
    const { job, app } = await seedA();
    const b = await makeUser();
    await jobDetail.PATCH(request(`/api/jobs/${job.id}`, { method: 'PATCH', cookie: b.cookie, body: { applied: true } }), ctx({ id: job.id }));
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('sent');
    expect((await db.application.findUniqueOrThrow({ where: { userId_jobId: { userId: b.user.id, jobId: job.id } } })).status).toBe('applied');
  });

  it("PATCH /api/outreach/[id] on A's event is 404 and changes nothing", async () => {
    const { event } = await seedA();
    const b = await makeUser();
    const res = await outreachEvent.PATCH(request(`/api/outreach/${event.id}`, { method: 'PATCH', cookie: b.cookie, body: { body: 'changed by B' } }), ctx({ id: event.id }));
    expect(res.status).toBe(404);
    expect((await db.outreachEvent.findUniqueOrThrow({ where: { id: event.id } })).body).toBe('message of A');
  });

  it("GET /api/resume/[id] gives the file to A and 'not found' to B", async () => {
    const { a, app } = await seedA();
    const b = await makeUser();
    expect((await resumeFile.GET(request(`/api/resume/${app.id}`, { cookie: a.cookie }), ctx({ id: app.id }))).status).toBe(200);
    const res = await resumeFile.GET(request(`/api/resume/${app.id}`, { cookie: b.cookie }), ctx({ id: app.id }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });

  it("POST /api/jobs/[id]/resume does not touch A's application", async () => {
    const { job, app } = await seedA();
    const b = await makeUser();
    const res = await jobResume.POST(request(`/api/jobs/${job.id}/resume`, { method: 'POST', cookie: b.cookie }), ctx({ id: job.id }));
    expect(res.status).toBe(200);
    await runOnce(undefined, { userId: b.user.id });
    const after = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.cvChat).toContain('secret chat of A');
    expect(after.cvPath).toBeNull();
    expect(await db.application.count({ where: { userId: b.user.id, jobId: job.id } })).toBe(1);
  });

  it("POST /api/jobs/[id]/resume/refine does not touch A's chat", async () => {
    const { job, app } = await seedA();
    // An admin passes the isAdmin gate in refineCv, so the call goes as far as it can without Claude.
    const b = await makeUser('admin');
    const res = await refine.POST(request(`/api/jobs/${job.id}/resume/refine`, { method: 'POST', cookie: b.cookie, body: { message: 'change it' } }), ctx({ id: job.id }));
    expect(res.status).toBe(200);
    const { taskId } = await res.json();
    await runOnce(undefined, { userId: b.user.id });
    // B reaches the Claude call, which has no credential (stubbed), so the task stops there before any write.
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ status: 'failed', lastError: '[user] Add an API key in Settings to use Claude.' });
    expect(await db.application.count({ where: { userId: b.user.id, jobId: job.id } })).toBe(1);
    const after = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.cvChat).toContain('secret chat of A');
    expect(after.cvChat).not.toContain('change it');
  });

  it("DELETE /api/jobs/[id]/resume/refine does not reset A's chat", async () => {
    const { job, app } = await seedA();
    const b = await makeUser();
    const res = await refine.DELETE(request(`/api/jobs/${job.id}/resume/refine`, { method: 'DELETE', cookie: b.cookie }), ctx({ id: job.id }));
    expect(res.status).toBe(200);
    await runOnce(undefined, { userId: b.user.id });
    expect(await db.application.count({ where: { userId: b.user.id, jobId: job.id } })).toBe(1);
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).cvChat).toContain('secret chat of A');
  });

  it("POST /api/countries changes B's list only", async () => {
    const { a } = await seedA();
    const b = await makeUser();
    await countries.POST(request('/api/countries', { method: 'POST', cookie: b.cookie, body: { cc: 'DE', on: false } }), ctx());
    expect((await db.countryPref.findFirstOrThrow({ where: { userId: a.user.id, cc: 'DE' } })).on).toBe(true);
    expect((await db.countryPref.findFirstOrThrow({ where: { userId: b.user.id, cc: 'DE' } })).on).toBe(false);
  });

  it("POST /api/profile/import does not delete A's contacts", async () => {
    const { a } = await seedA();
    const b = await makeUser();
    const form = new FormData();
    form.set('file', new File(['First Name,Last Name,URL,Email Address,Company,Position,Connected On\nNew,Person,,,Beta,Dev,01 Jan 2025\n'], 'Connections.csv'));
    const res = await profileImport.POST(await formRequest('/api/profile/import', form, { cookie: b.cookie }), ctx());
    expect(res.status).toBe(200);
    expect(await db.contact.count({ where: { userId: a.user.id } })).toBe(1);
  });

  it("POST /api/outreach on a job uses B's application only", async () => {
    const { job, app } = await seedA();
    const b = await makeUser();
    await outreach.POST(request('/api/outreach', { method: 'POST', cookie: b.cookie, body: { jobId: job.id, action: 'replied', incoming: 'Thanks!' } }), ctx());
    expect(await db.outreachEvent.count({ where: { applicationId: app.id } })).toBe(1);
  });

  it("DELETE /api/account/sessions/[id] on A's session is 404", async () => {
    const { a } = await seedA();
    const b = await makeUser();
    const s = await db.session.findFirstOrThrow({ where: { userId: a.user.id } });
    expect((await sessionOne.DELETE(request(`/api/account/sessions/${s.id}`, { method: 'DELETE', cookie: b.cookie }), ctx({ id: s.id }))).status).toBe(404);
    expect(await db.session.count({ where: { id: s.id } })).toBe(1);
  });

  it('admin routes refuse a member', async () => {
    const { a } = await seedA();
    const b = await makeUser();
    expect((await adminUser.PATCH(request(`/api/admin/users/${a.user.id}`, { method: 'PATCH', cookie: b.cookie, body: { disabled: true } }), ctx({ id: a.user.id }))).status).toBe(403);
    expect((await adminReset.POST(request(`/api/admin/users/${a.user.id}/reset`, { method: 'POST', cookie: b.cookie }), ctx({ id: a.user.id }))).status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: a.user.id } })).disabledAt).toBeNull();
    expect((await adminInvites.POST(request('/api/admin/invites', { method: 'POST', cookie: b.cookie, body: {} }), ctx())).status).toBe(403);
    expect((await adminUsers.GET(request('/api/admin/users', { cookie: b.cookie }), ctx())).status).toBe(403);
  });
});

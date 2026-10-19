import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
// The real self-test row is shared by all test files. Here the reader is a mock.
vi.mock('@/lib/claude/selftest', () => ({ cliDisabled: vi.fn(async () => null), runCliSelfTestAtStart: vi.fn() }));
vi.mock('@/lib/claude/cli', async (orig) => ({ ...(await orig<typeof import('@/lib/claude/cli')>()), cliBinary: vi.fn(() => '/usr/bin/claude') }));

import { GET } from '@/app/api/health/route';
import { GET as ADMIN_GET } from '@/app/api/admin/health/route';
import { db } from '@/lib/db';
import { cliDisabled } from '@/lib/claude/selftest';
import { resetEnvForTests } from '@/lib/env';
import { runChecks } from '@/lib/health';
import { beat } from '@/lib/tasks/queue';
import { ctx, makeUser, request } from './helpers/http';

const beatId = `health-test-${randomBytes(4).toString('hex')}`;

afterAll(async () => {
  await db.workerHeartbeat.deleteMany({ where: { id: beatId } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  vi.mocked(cliDisabled).mockResolvedValue(null);
});

describe('runChecks', () => {
  it('health is ok with a fresh heartbeat', async () => {
    const now = new Date();
    await beat(1, new Date(now.getTime() - 10_000), beatId);
    const c = await runChecks(now, { beatId });
    expect(c.db.ok).toBe(true);
    expect(c.worker.ok).toBe(true);
  });

  it('is degraded when the heartbeat is older than 90 seconds', async () => {
    const now = new Date();
    await beat(1, new Date(now.getTime() - 91_000), beatId);
    expect((await runChecks(now, { beatId })).worker.ok).toBe(false);
  });

  it('degraded with no heartbeat', async () => {
    const c = await runChecks(new Date(), { beatId: `${beatId}-none` });
    expect(c.worker.ok).toBe(false);
  });
});

describe('GET /api/health', () => {
  it('answers without a session, keeps app: waypoint and shows no detail text', async () => {
    const res = await GET(request('/api/health'), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['app', 'checks', 'status']);
    expect(body.app).toBe('waypoint');
    expect(['ok', 'degraded']).toContain(body.status);
    expect(Object.keys(body.checks).sort()).toEqual(['claude', 'db', 'disk', 'worker']);
    const strings: string[] = [];
    const walk = (v: unknown, key = '') => {
      if (typeof v === 'string' && key !== 'app') strings.push(v);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    walk(body);
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) expect(s.length).toBeLessThanOrEqual(10);
    for (const v of Object.values(body.checks)) expect(['ok', 'degraded']).toContain(v);
  });
});

describe('GET /api/admin/health', () => {
  it('gives details and task counts to the admin', async () => {
    const admin = await makeUser('admin');
    const res = await ADMIN_GET(request('/api/admin/health', { cookie: admin.cookie }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(['ok', 'degraded']).toContain(body.status);
    for (const k of ['db', 'worker', 'claude', 'disk']) {
      expect(typeof body.checks[k].ok).toBe('boolean');
      expect(body.checks[k].detail.length).toBeGreaterThan(0);
    }
    expect(Object.keys(body.tasks).sort()).toEqual(['failed', 'queued', 'running']);
  });

  it('shows the self-test reason when the CLI is the only source and it is off', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    resetEnvForTests();
    vi.mocked(cliDisabled).mockResolvedValue({ reason: 'tools are on', at: '2026-10-17T10:00:00.000Z' });
    const secrets = vi.spyOn(db.userSecret, 'count').mockResolvedValue(0);
    const admin = await makeUser('admin');
    const body = await (await ADMIN_GET(request('/api/admin/health', { cookie: admin.cookie }), ctx())).json();
    expect(body.checks.claude).toEqual({ ok: false, detail: 'The Claude CLI failed its self-test at 2026-10-17T10:00:00.000Z: tools are on' });
    const pub = await (await GET(request('/api/health'), ctx())).json();
    expect(pub.checks.claude).toBe('degraded');
    secrets.mockRestore();
  });

  it('stays ok with a shared key, and notes that the CLI is off', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-shared-key');
    resetEnvForTests();
    vi.mocked(cliDisabled).mockResolvedValue({ reason: 'r', at: '2026-10-17T10:00:00.000Z' });
    const c = await runChecks(new Date(), { beatId });
    expect(c.claude.ok).toBe(true);
    expect(c.claude.detail).toMatch(/CLI is off/);
  });

  it('gives 403 to a member', async () => {
    const m = await makeUser('member');
    expect((await ADMIN_GET(request('/api/admin/health', { cookie: m.cookie }), ctx())).status).toBe(403);
  });
});

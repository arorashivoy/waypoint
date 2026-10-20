import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import { buildMe } from '@/lib/state';
import AccountSection from '@/components/settings/AccountSection';
import { refreshLine } from '@/components/jobs/refresh';
import { hasViewParam } from '@/components/onboarding/bypass';
import { leaveWizard } from '@/components/onboarding/leave';
import Onboarding from '@/components/onboarding/Onboarding';
import StepRoute from '@/components/onboarding/StepRoute';
import { startStep, stepStatus, wizardSteps, type WizardStep } from '@/components/onboarding/steps';
import { getSettings } from '@/lib/settings';
import * as onboarding from '@/app/api/onboarding/route';
import { ctx, makeUser, request } from './helpers/http';
import { applyMigrations, migrationNames } from './setup/migrate';

async function withDb(fn: (c: PrismaClient) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'wp-onb-'));
  const c = new PrismaClient({ datasourceUrl: `file:${join(dir, 'm.db')}?connection_limit=1` });
  try {
    await fn(c);
  } finally {
    await c.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
}

const get = (cookie: string) => onboarding.GET(request('/api/onboarding', { cookie }), ctx());
const patch = (cookie: string, body: unknown) => onboarding.PATCH(request('/api/onboarding', { method: 'PATCH', cookie, body }), ctx());

describe('migration 7_onboarding', () => {
  it('is the last migration', () => {
    expect(migrationNames().slice(-1)).toEqual(['7_onboarding']);
  });

  it('marks each existing user as set up and keeps the settings that exist', async () => {
    await withDb(async (c) => {
      const before = migrationNames().filter((n) => n !== '7_onboarding');
      await applyMigrations(c, before);
      await c.$executeRawUnsafe(
        `INSERT INTO "User" ("id","email","name","createdAt","role") VALUES ('u1','a@x.test','A',1700000000000,'admin'), ('u2','b@x.test','B',1700000000001,'member')`,
      );
      await c.$executeRawUnsafe(
        `INSERT INTO "UserSettings" ("userId","fields","visaStatus","updatedAt") VALUES ('u2','["Backend"]','I need a visa',1700000000000)`,
      );
      const start = Date.now();
      await applyMigrations(c, ['7_onboarding']);

      const rows = await c.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT "userId","fields","visaStatus","resumeMode","templateId","onboardedAt","wizardStep" FROM "UserSettings" ORDER BY "userId"`,
      );
      expect(rows).toHaveLength(2);
      // The admin keeps RESUME_TEX: 'own-tex' with no own file is the admin default of resumeConfig.
      expect(rows[0]).toMatchObject({ userId: 'u1', fields: '[]', visaStatus: '', resumeMode: 'own-tex', templateId: 'classic', wizardStep: null });
      expect(rows[1]).toMatchObject({ userId: 'u2', fields: '["Backend"]', visaStatus: 'I need a visa', wizardStep: null });
      for (const r of rows) {
        expect(Number(r.onboardedAt)).toBeGreaterThanOrEqual(Math.floor(start / 1000) * 1000);
        expect(Number(r.onboardedAt)).toBeLessThanOrEqual(Date.now());
      }
      expect(await c.$queryRawUnsafe(`PRAGMA foreign_key_check`)).toEqual([]);
    });
  });

  it('runs on an empty database', async () => {
    await withDb(async (c) => {
      await applyMigrations(c);
      expect(await c.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "UserSettings"`)).toEqual([{ n: 0n }]);
    });
  });
});

describe('the admin row that the migration makes', () => {
  it('keeps RESUME_TEX for the admin', async () => {
    vi.stubEnv('RESUME_TEX', '/srv/waypoint-test/resume.tex');
    try {
      const { user } = await makeUser('admin');
      // The same row that 7_onboarding inserts for an admin with no settings row.
      await db.userSettings.upsert({ where: { userId: user.id }, update: { resumeMode: 'own-tex' }, create: { userId: user.id, fields: '[]', visaStatus: '', resumeMode: 'own-tex' } });
      const { resumeConfig } = await import('@/lib/resume');
      const cfg = await resumeConfig(user.id);
      expect(cfg.tex).toBe('/srv/waypoint-test/resume.tex');
      expect(cfg.template).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('a new user', () => {
  it('has no onboardedAt, so the wizard shows', async () => {
    const { user, cookie } = await makeUser();
    expect(await (await get(cookie)).json()).toEqual({ onboardedAt: null, step: null });
    expect((await buildMe(user.id)).onboarding).toEqual({ onboardedAt: null, step: null });
  });
});

describe('the steps of the wizard', () => {
  const me = (mode: string) => ({ claude: { mode } });

  it('shows all 6 steps to a user with no credential', () => {
    expect(wizardSteps(me('none'))).toEqual(['account', 'search', 'claude', 'import', 'review', 'refresh']);
  });

  it.each(['shared', 'own', 'cli'])('skips the Claude step for a user with the %s credential', (mode) => {
    expect(wizardSteps(me(mode))).toEqual(['account', 'search', 'import', 'review', 'refresh']);
  });

  it('shows the Claude step to a user with a credential who asks to add an own key', () => {
    expect(wizardSteps(me('shared'), true)).toContain('claude');
  });

  it('opens the saved step, or the first step when the saved one is not shown', () => {
    const steps = wizardSteps(me('shared'));
    expect(startStep(steps, 'import')).toBe('import');
    expect(startStep(steps, 'claude')).toBe('account');
    expect(startStep(steps, null)).toBe('account');
  });
});

describe('PATCH /api/onboarding', () => {
  it('keeps the step', async () => {
    const { cookie } = await makeUser();
    expect(await (await patch(cookie, { step: 'import' })).json()).toEqual({ onboardedAt: null, step: 'import' });
    expect(await (await get(cookie)).json()).toEqual({ onboardedAt: null, step: 'import' });
  });

  it('skips the whole wizard and keeps the step, then opens it again', async () => {
    const { user, cookie } = await makeUser();
    await patch(cookie, { step: 'search' });
    const skipped = await (await patch(cookie, { onboarded: true })).json();
    expect(skipped.step).toBe('search');
    expect(Date.parse(skipped.onboardedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect((await buildMe(user.id)).onboarding.onboardedAt).toBe(skipped.onboardedAt);

    const again = await (await patch(cookie, { onboarded: false })).json();
    expect(again).toEqual({ onboardedAt: null, step: 'search' });
  });

  it('finishes the wizard and clears the step', async () => {
    const { cookie } = await makeUser();
    await patch(cookie, { step: 'refresh' });
    const done = await (await patch(cookie, { onboarded: true, step: null })).json();
    expect(done.step).toBeNull();
    expect(done.onboardedAt).not.toBeNull();
  });

  it('refuses a step that is not one of the 6', async () => {
    const { cookie } = await makeUser();
    const res = await patch(cookie, { step: 'welcome' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/step must be one of/);
    expect((await get(cookie).then((r) => r.json())).step).toBeNull();
  });

  it('refuses an empty body and a wrong type', async () => {
    const { cookie } = await makeUser();
    expect((await patch(cookie, {})).status).toBe(400);
    expect((await patch(cookie, { onboarded: 'yes' })).status).toBe(400);
  });

  it('does not let user B read or set the state of user A', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await patch(a.cookie, { step: 'review', onboarded: true });
    expect(await (await get(b.cookie)).json()).toEqual({ onboardedAt: null, step: null });
    await patch(b.cookie, { step: 'search' });
    const rowA = await db.userSettings.findUniqueOrThrow({ where: { userId: a.user.id } });
    expect(rowA.wizardStep).toBe('review');
    expect(rowA.onboardedAt).not.toBeNull();
  });

  it('answers 401 without a session', async () => {
    expect((await onboarding.GET(request('/api/onboarding'), ctx())).status).toBe(401);
    expect((await onboarding.PATCH(request('/api/onboarding', { method: 'PATCH', body: { step: 'search' } }), ctx())).status).toBe(401);
  });
});

describe('the line after the first refresh', () => {
  const ok = { added: 4, total: 12, report: [], analysing: null };

  it('says what the refresh did', () => {
    expect(refreshLine(ok)).toBe('4 new, 12 live in your countries.');
    expect(refreshLine({ ...ok, analysing: { total: 9 } })).toBe('4 new, 12 live in your countries. Claude is reading the top 9.');
  });

  it('names a source that failed one time, even when it failed in many countries', () => {
    const report = [{ source: 'The Muse PT', error: 'x' }, { source: 'The Muse PT', error: 'x' }, { source: 'The Muse IN', error: 'x' }, { source: 'Lever', error: null }];
    expect(refreshLine({ ...ok, report })).toBe('4 new, 12 live in your countries. 2 sources failed: The Muse PT, The Muse IN.');
  });

  it('shortens a long list of failed sources', () => {
    const report = Array.from({ length: 7 }, (_, i) => ({ source: `s${i}`, error: 'x' }));
    expect(refreshLine({ ...ok, report })).toContain('7 sources failed: s0, s1, s2, s3 and 3 more.');
  });
});

describe('Settings, Account', () => {
  const render = (finishSetup?: () => void) =>
    renderToStaticMarkup(createElement(AccountSection, { user: { name: 'Mira' }, run: async () => true, leave: async () => {}, retry: () => {}, finishSetup }));

  it('offers "Finish setting up" only when the user skipped part of the wizard', () => {
    expect(render(() => {})).toContain('Finish setting up');
    expect(render()).not.toContain('Finish setting up');
  });
});

describe('the status of a step on the route', () => {
  const steps = wizardSteps({ claude: { mode: 'shared' } });
  const status = (current: WizardStep, skipped: WizardStep[], step: WizardStep) => stepStatus(steps, current, new Set(skipped), step);

  it('marks the steps before the current one as done, or skipped when the user skipped them', () => {
    expect(status('review', ['import'], 'account')).toBe('done');
    expect(status('review', ['import'], 'import')).toBe('skipped');
    expect(status('review', ['import'], 'review')).toBe('now');
    expect(status('review', ['import'], 'refresh')).toBe('later');
  });

  it('does not mark a step that comes later as skipped', () => {
    expect(status('search', ['refresh'], 'refresh')).toBe('later');
  });

  it('says Skipped on the route', () => {
    const html = renderToStaticMarkup(createElement(StepRoute, { steps, current: 'review', skipped: new Set<WizardStep>(['import']) }));
    expect(html).toContain('Skipped');
    expect(html.match(/Done/g)).toHaveLength(2);
  });
});

describe('leaving the wizard', () => {
  it('leaves when the save works, even if loading the data again fails', async () => {
    const reload = vi.fn(async () => { throw new Error('offline'); });
    expect(await leaveWizard(async () => ({}), reload)).toEqual({ ok: true });
    expect(reload).toHaveBeenCalled();
  });

  it('stays and gives the message when the save fails', async () => {
    const reload = vi.fn(async () => {});
    expect(await leaveWizard(async () => { throw new Error('The server is down.'); }, reload)).toEqual({ ok: false, message: 'The server is down.' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('shows Skip setup, Skip this step and Sign out on the wizard', () => {
    const me = {
      user: { name: 'Mira Okafor', email: 'mira@example.com', role: 'member' }, claude: { mode: 'none' }, countries: [], analysing: null,
      onboarding: { onboardedAt: null, step: null },
    } as unknown as Parameters<typeof Onboarding>[0]['me'];
    const html = renderToStaticMarkup(createElement(Onboarding, { me, setToast: () => {}, toggleCountry: () => {}, refresh: async () => {}, onLeave: () => {} }));
    for (const text of ['Skip setup', 'Skip this step', 'Sign out']) expect(html).toContain(text);
  });
});

describe('the ?view= bypass', () => {
  it('sees a view in the address', () => {
    expect(hasViewParam('?view=settings')).toBe(true);
    expect(hasViewParam('?job=abc')).toBe(false);
    expect(hasViewParam('')).toBe(false);
  });
});

describe('the résumé mode of a row that the migration made', () => {
  const withEnv = async (value: string, fn: () => Promise<void>) => {
    const old = process.env.RESUME_TEX;
    process.env.RESUME_TEX = value;
    try { await fn(); } finally { if (old === undefined) delete process.env.RESUME_TEX; else process.env.RESUME_TEX = old; }
  };

  it('gives the template to an admin with own-tex and no file when the server has no RESUME_TEX', async () => {
    const { user } = await makeUser('admin');
    await db.userSettings.create({ data: { userId: user.id, resumeMode: 'own-tex' } });
    await withEnv('', async () => expect((await getSettings(user.id)).resumeMode).toBe('template'));
    await withEnv('/srv/cv.tex', async () => expect((await getSettings(user.id)).resumeMode).toBe('own-tex'));
  });

  it('gives the template to a member with own-tex and no file, and keeps own-tex with a file', async () => {
    const a = await makeUser();
    await db.userSettings.create({ data: { userId: a.user.id, resumeMode: 'own-tex' } });
    expect((await getSettings(a.user.id)).resumeMode).toBe('template');
    const b = await makeUser();
    await db.userSettings.create({ data: { userId: b.user.id, resumeMode: 'own-tex', ownTex: 'own.tex' } });
    expect((await getSettings(b.user.id)).resumeMode).toBe('own-tex');
  });
});

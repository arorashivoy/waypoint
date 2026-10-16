import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { applyMigrations, migrationNames } from './setup/migrate';

async function withDb(fn: (c: PrismaClient) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'wp-mig-'));
  const c = new PrismaClient({ datasourceUrl: `file:${join(dir, 'm.db')}?connection_limit=1` });
  try {
    await fn(c);
  } finally {
    await c.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('migration 1_accounts', () => {
  it('lists the migrations in order', () => {
    expect(migrationNames().slice(0, 2)).toEqual(['0_init', '1_accounts']);
  });

  it('makes the oldest user the admin and moves each analysis to JobAnalysis', async () => {
    await withDb(async (c) => {
      await applyMigrations(c, ['0_init']);
      await c.$executeRawUnsafe(
        `INSERT INTO "User" ("id","email","name","createdAt") VALUES ('u1',' Old@X.test ','Old',1700000000000), ('u2','new@x.test','New',1800000000000)`,
      );
      await c.$executeRawUnsafe(
        `INSERT INTO "Job" ("id","externalId","source","role","company","city","cc","url","analysis","analysedAt","analysisTries","fetchedAt","postedAt") VALUES
         ('j1','e1','Test','Dev','Acme','Berlin','DE','https://x.test','{"by":"claude"}',1750000000000,0,1750000000000,1750000000000),
         ('j2','e2','Test','Dev','Acme','Berlin','DE','https://y.test',NULL,NULL,0,1750000000000,1750000000000)`,
      );
      await applyMigrations(c, ['1_accounts']);

      const users = await c.$queryRawUnsafe<{ id: string; role: string; email: string }[]>(
        `SELECT "id","role","email" FROM "User" ORDER BY "id"`,
      );
      expect(users).toEqual([
        { id: 'u1', role: 'admin', email: 'old@x.test' },
        { id: 'u2', role: 'member', email: 'new@x.test' },
      ]);
      const rows = await c.$queryRawUnsafe<{ userId: string; jobId: string; analysis: string }[]>(
        `SELECT "userId","jobId","analysis" FROM "JobAnalysis"`,
      );
      expect(rows).toEqual([{ userId: 'u1', jobId: 'j1', analysis: '{"by":"claude"}' }]);
      const cols = await c.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("Job")`);
      expect(cols.map((x) => x.name)).not.toContain('analysis');
      expect(cols.map((x) => x.name)).not.toContain('analysisTries');
    });
  });

  it('runs on an empty database', async () => {
    await withDb(async (c) => {
      await applyMigrations(c);
      const [n] = await c.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "User"`);
      expect(Number(n.n)).toBe(0);
    });
  });
});

describe('migration 2_profile', () => {
  it('lists the migration after 1_accounts', () => {
    expect(migrationNames().slice(0, 3)).toEqual(['0_init', '1_accounts', '2_profile']);
  });

  it('makes a pending draft from each old LinkedIn row and drops the old rows', async () => {
    await withDb(async (c) => {
      await applyMigrations(c, ['0_init', '1_accounts']);
      await c.$executeRawUnsafe(`INSERT INTO "User" ("id","email","name","createdAt","role") VALUES ('u1','a@x.test','A',1700000000000,'admin')`);
      await c.$executeRawUnsafe(
        `INSERT INTO "Position" ("id","userId","title","company","location","startedAt","endedAt","summary") VALUES
         ('cpos00000001abcd1234','u1','Developer','Acme','Berlin',1709251200000,NULL,'Builds things.')`,
      );
      await c.$executeRawUnsafe(`INSERT INTO "Education" ("id","userId","school","degree","field","years") VALUES ('cedu00000001abcd5678','u1','TU','BSc','CS','2019 – 2023')`);
      await c.$executeRawUnsafe(`INSERT INTO "ProjectItem" ("id","userId","title","org","description","url","tags") VALUES ('cprj00000001abcd9999','u1','Parser',NULL,'Fast.','https://x.test','')`);
      await c.$executeRawUnsafe(`INSERT INTO "Skill" ("id","userId","name") VALUES ('cskl00000001abcd0000','u1','Java')`);
      await applyMigrations(c, ['2_profile']);

      const drafts = await c.$queryRawUnsafe<{ type: string; source: string; status: string; data: string; batchId: string }[]>(
        `SELECT "type","source","status","data","batchId" FROM "ProfileDraft" ORDER BY "type"`,
      );
      expect(drafts.map((d) => [d.type, d.source, d.status, d.batchId])).toEqual([
        ['claim', 'linkedin', 'pending', 'migration'],
        ['education', 'linkedin', 'pending', 'migration'],
        ['position', 'linkedin', 'pending', 'migration'],
        ['project', 'linkedin', 'pending', 'migration'],
      ]);
      const byType = Object.fromEntries(drafts.map((d) => [d.type, JSON.parse(d.data)]));
      expect(byType.position).toEqual({ id: 'linkedin-abcd1234', title: 'Developer', company: 'Acme', location: 'Berlin', start: '2024-03', end: null, summary: 'Builds things.', bullets: [] });
      expect(byType.education).toEqual({ id: 'linkedin-abcd5678', school: 'TU', degree: 'BSc', field: 'CS', years: '2019 – 2023', aliases: [] });
      expect(byType.project).toEqual({ id: 'linkedin-abcd9999', title: 'Parser', org: null, description: 'Fast.', url: 'https://x.test', source: 'linkedin' });
      expect(byType.claim).toEqual({ slug: 'skill-abcd0000', kind: 'skill', label: 'Java', aliases: [], links: [], evidence: [], mentions: [{ surface: 'linkedin-skills', listed: true }] });

      for (const t of ['Position', 'Education', 'ProjectItem']) {
        expect(await c.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "${t}"`)).toEqual([{ n: 0n }]);
      }
      const tables = await c.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table'`);
      expect(tables.map((t) => t.name)).not.toContain('Skill');
      expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['ProfileMeta', 'PositionBullet', 'Claim', 'ClaimLink', 'ClaimEvidence', 'ClaimMention', 'ProfileRevision', 'ProfileDraft', 'GithubCache']));
      expect(await c.$queryRawUnsafe(`PRAGMA foreign_key_check`)).toEqual([]);
    });
  });
});

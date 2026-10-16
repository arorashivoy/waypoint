import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { applyMigrations, migrationNames } from './setup/migrate';

async function withDb(fn: (c: PrismaClient) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'wp-mig-'));
  const c = new PrismaClient({ datasourceUrl: `file:${join(dir, 'm.db')}` });
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

import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('db', () => {
  it('sets WAL mode and keeps foreign keys and the busy timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-db-'));
    const oldUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${join(dir, 't.db')}`;
    const { db, dbReady } = await import('@/lib/db');
    try {
      await dbReady;
      // Build the schema from the baseline migration, one statement at a time.
      const sql = readFileSync('prisma/migrations/0_init/migration.sql', 'utf8');
      for (const chunk of sql.split(/;\s*\n/)) {
        const stmt = chunk
          .split('\n')
          .filter((l) => !l.trim().startsWith('--'))
          .join('\n')
          .trim();
        if (stmt) await db.$executeRawUnsafe(stmt);
      }
      const [mode] = await db.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode');
      const [fk] = await db.$queryRawUnsafe<{ foreign_keys: bigint }[]>('PRAGMA foreign_keys');
      const [bt] = await db.$queryRawUnsafe<{ timeout: bigint }[]>('PRAGMA busy_timeout');
      const tables = await db.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='User'",
      );
      expect(mode.journal_mode).toBe('wal');
      expect(Number(fk.foreign_keys)).toBe(1);
      expect(Number(bt.timeout)).toBeGreaterThanOrEqual(5000);
      expect(tables).toHaveLength(1);
    } finally {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
      if (oldUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = oldUrl;
    }
  });

  it('each connection has WAL, busy_timeout 5000 and foreign keys on', async () => {
    // The test above closed the first client, so load db.ts again on a new file.
    vi.resetModules();
    delete (globalThis as { prisma?: unknown }).prisma;
    delete (globalThis as { dbReady?: unknown }).dbReady;
    const dir = mkdtempSync(join(tmpdir(), 'wp-db-'));
    const oldUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${join(dir, 't2.db')}`;
    const { db, dbReady } = await import('@/lib/db');
    try {
      await dbReady;
      await check(db);
    } finally {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
      if (oldUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = oldUrl;
    }
  });
});

async function check(db: import('@prisma/client').PrismaClient) {
  // Read the settings many times at once, so that every pool connection answers.
  const rows = await Promise.all(
    Array.from({ length: 8 }, async () => ({
      mode: (await db.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode'))[0].journal_mode,
      bt: Number((await db.$queryRawUnsafe<{ timeout: bigint }[]>('PRAGMA busy_timeout'))[0].timeout),
      fk: Number((await db.$queryRawUnsafe<{ foreign_keys: bigint }[]>('PRAGMA foreign_keys'))[0].foreign_keys),
    })),
  );
  for (const r of rows) expect(r).toEqual({ mode: 'wal', bt: 5000, fk: 1 });
}

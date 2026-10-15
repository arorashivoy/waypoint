import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('db', () => {
  it('sets WAL mode and keeps foreign keys and the busy timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-db-'));
    copyFileSync('data/backups/waypoint.db.pre-migrate-2026-10-15', join(dir, 't.db'));
    process.env.DATABASE_URL = `file:${join(dir, 't.db')}`;
    const { db, dbReady } = await import('@/lib/db');
    await dbReady;
    const [mode] = await db.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode');
    const [fk] = await db.$queryRawUnsafe<{ foreign_keys: bigint }[]>('PRAGMA foreign_keys');
    const [bt] = await db.$queryRawUnsafe<{ timeout: bigint }[]>('PRAGMA busy_timeout');
    expect(mode.journal_mode).toBe('wal');
    expect(Number(fk.foreign_keys)).toBe(1);
    expect(Number(bt.timeout)).toBeGreaterThanOrEqual(5000);
    await db.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });
});

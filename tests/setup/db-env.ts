import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { applyMigrations } from './migrate';

// Runs one time, before any worker starts. The workers inherit DATABASE_URL,
// so db.ts opens a temporary database with all migrations, never the real one.
// All test files share this database, so each test makes its own rows
// (random emails) and never counts rows that other files can make.
let dir = '';

export async function setup(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), 'waypoint-vitest-'));
  process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`;
  const client = new PrismaClient({ datasourceUrl: `${process.env.DATABASE_URL}?connection_limit=1` });
  try {
    await applyMigrations(client);
  } finally {
    await client.$disconnect();
  }
}

export function teardown(): void {
  if (dir) rmSync(dir, { recursive: true, force: true });
}

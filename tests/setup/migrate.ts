import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';

const DIR = 'prisma/migrations';

/** Migration folders in the order Prisma applies them: by the number before the first "_". */
export function migrationNames(): string[] {
  return readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
}

/** Splits a migration file into statements and removes the comment lines. */
export function statements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Applies the named migrations (default: all), one statement at a time.
 * The client must use `?connection_limit=1`. PRAGMA settings (such as
 * `foreign_keys=OFF` in a table rebuild) belong to one connection, and a pool
 * can run the next statement on another connection.
 */
export async function applyMigrations(client: PrismaClient, names = migrationNames()): Promise<void> {
  for (const name of names) {
    for (const stmt of statements(readFileSync(join(DIR, name, 'migration.sql'), 'utf8'))) {
      await client.$executeRawUnsafe(stmt);
    }
  }
}

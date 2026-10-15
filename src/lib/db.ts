import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; dbReady?: Promise<void> };

export const db = globalForPrisma.prisma ?? new PrismaClient();

/**
 * WAL lets the web server read while the worker writes. The mode is stored in
 * the database file, so this is a no-op after the first start. Prisma already
 * turns on foreign keys and sets a 5-second busy timeout on each connection.
 */
export const dbReady: Promise<void> =
  globalForPrisma.dbReady ??
  db
    .$queryRawUnsafe('PRAGMA journal_mode=WAL')
    .then(() => undefined)
    .catch((e) => {
      console.error('[db] could not set WAL mode:', (e as Error).message);
    });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
  globalForPrisma.dbReady = dbReady;
}

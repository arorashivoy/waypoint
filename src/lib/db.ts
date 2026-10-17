import { PrismaClient } from '@prisma/client';
import { log } from '@/lib/log';

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
      log.error({ err: e }, 'could not set WAL mode');
    });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
  globalForPrisma.dbReady = dbReady;
}

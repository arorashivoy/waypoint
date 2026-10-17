import { dirname, join } from 'node:path';
import { EnvError, env } from '@/lib/env';
import { log } from '@/lib/log';

try {
  env();
} catch (err) {
  if (err instanceof EnvError) {
    log.error({ err }, 'bad environment');
    process.exit(1);
  }
  throw err;
}

async function main() {
  const { backupNow, databasePath, pruneBackups, uploadBackup } = await import('@/lib/backup');
  const { usersRoot } = await import('@/lib/user-files');
  const { db } = await import('@/lib/db');
  const dir = join(dirname(databasePath()), 'backups');
  try {
    const made = await backupNow({ dir, usersDir: usersRoot() });
    log.info(made, 'backup written');
    const removed = await pruneBackups(dir);
    if (removed.length) log.info({ removed }, 'old backups removed');
    await uploadBackup([made.db, made.users]);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  log.error({ err }, 'backup failed');
  process.exit(1);
});

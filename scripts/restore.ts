import { dirname, resolve } from 'node:path';
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
  const [dbFile, usersTar] = process.argv.slice(2);
  if (!dbFile) {
    console.error('Use: npm run restore -- <database file> [users archive]');
    process.exit(2);
  }
  const { databasePath, restoreBackup } = await import('@/lib/backup');
  const { usersRoot } = await import('@/lib/user-files');
  const target = databasePath();
  await restoreBackup({
    dbFile: resolve(dbFile),
    usersTar: usersTar ? resolve(usersTar) : undefined,
    dataDir: dirname(target),
    usersDir: usersRoot(),
    target,
  });
  console.log('Restored. Start the units again.');
}

main().catch((err) => {
  log.error({ err }, 'restore failed');
  process.exit(1);
});

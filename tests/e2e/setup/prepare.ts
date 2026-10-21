// Makes the scratch database for the device tests: all migrations, an admin, one new member for each project and the jobs.
// start.sh runs it before the app starts, with only the keys the app needs. It never opens data/.
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { applyMigrations } from '../../setup/migrate';
import { ADMIN, CREDENTIALS, NO_CV, PROJECTS, SCRATCH, memberOf } from './accounts';

async function main() {
  mkdirSync(SCRATCH, { recursive: true });
  // A new password for each run. The file is for the tests only, and only this user can read it.
  const PASSWORD = randomBytes(18).toString('base64url');
  writeFileSync(CREDENTIALS, JSON.stringify({ password: PASSWORD }), { mode: 0o600 });
  chmodSync(CREDENTIALS, 0o600);
  const url = `file:${join(SCRATCH, 'e2e.db')}`;
  process.env.DATABASE_URL = url;
  const client = new PrismaClient({ datasourceUrl: `${url}?connection_limit=1` });
  try {
    await applyMigrations(client);
  } finally {
    await client.$disconnect();
  }

  // The app code reads DATABASE_URL when it loads, so it loads after the line above.
  const { db } = await import('@/lib/db');
  const { createUser } = await import('@/lib/auth/users');
  const { seedJobs } = await import('./seed');
  try {
    const admin = await createUser({ ...ADMIN, password: PASSWORD, role: 'admin' });
    // The admin skips the wizard. A new member sees it.
    await db.userSettings.upsert({ where: { userId: admin.id }, update: { onboardedAt: new Date() }, create: { userId: admin.id, onboardedAt: new Date(), resumeMode: 'own-tex' } });
    const noCv = await createUser({ ...NO_CV, password: PASSWORD });
    await db.userSettings.upsert({ where: { userId: noCv.id }, update: { onboardedAt: new Date() }, create: { userId: noCv.id, onboardedAt: new Date(), resumeMode: 'template' } });
    for (const p of PROJECTS) await createUser({ ...memberOf(p), password: PASSWORD });
    await seedJobs(ADMIN.email);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

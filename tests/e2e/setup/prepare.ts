// Makes the scratch database for the device tests: all migrations, an admin, one new member for each project and the jobs.
// The webServer command runs it before the app starts. It never opens data/.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { applyMigrations } from '../../setup/migrate';
import { ADMIN, PASSWORD, PROJECTS, SCRATCH, memberOf } from './accounts';

async function main() {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
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

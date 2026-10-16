/**
 * Moves a claims.yml into the profile tables of one user (spec 3.5).
 *
 *   npm run migrate:claims -- --user <email> [--file data/profile/claims.yml]
 *
 * Stop the server first, and back up data/waypoint.db, -wal and -shm.
 * The script refuses the file if the strict check fails, or if the tables do
 * not give the same data back. In both cases nothing changes.
 */
import { readFileSync } from 'node:fs';
import { CLAIMS_PATH } from '../src/lib/claims';
import { db } from '../src/lib/db';
import { migrateClaimsText } from '../src/lib/profile/migrate';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('--user');
  const file = arg('--file') || CLAIMS_PATH;
  if (!email) throw new Error('Give the email of the user: --user <email>');
  const r = await migrateClaimsText(email, readFileSync(file, 'utf8'));
  if (!r.ok) {
    console.error(`Not migrated. ${file}:`);
    for (const e of r.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  const c = r.counts;
  console.log(`${r.replaced ? 'Replaced' : 'Saved'} the profile of ${email.trim().toLowerCase()}: ${c.positions} positions, ${c.educations} educations, ${c.projects} projects, ${c.claims} claims.`);
  console.log('The round trip check passed. The Profile screen has a revision of the state before this change.');
  if (r.warnings.length) console.log(`${r.warnings.length} warnings (run npm run check:claims to see them).`);
}

main()
  .catch((e) => {
    console.error(`Error: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

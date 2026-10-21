# Production part 2: accounts and data isolation. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single passcode account with invited accounts (argon2id passwords, database sessions, an admin), give each user their own Claude credential, spend cap and data, and prove with tests that one user cannot see or change the data of another user.

**Architecture:** A new `src/lib/auth/` folder holds the password, token, session, rate-limit, origin and invite code. Every API route uses one wrapper (`handle`) and one guard (`requireUser(req)`), which read the session cookie from the request, so route handlers run in Vitest without the Next.js runtime. Next.js middleware sends signed-out page requests to `/login` and refuses cross-origin writes. The Claude client gets a call context (`userId`, `kind`), picks the credential for that user (own key, then the shared key under a monthly cap, then the CLI for the admin only) and writes one `LlmUsage` row for each call.

**Tech Stack:** Next.js 14 route handlers and middleware, Prisma 5 with SQLite (WAL), `@node-rs/argon2` 2.2.1, Node `crypto` (AES-256-GCM, SHA-256), zod 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-15-production-ready-design.md`, section 2 (also 6.8, 7.6, 9 and 11). Part 1 plan: `docs/superpowers/plans/2026-10-15-prod-part1-foundation.md`.

## Global Constraints

- Write all prose (comments, docs, commit messages, UI text) in ASD-STE100 style: simple words, active voice, short sentences, commands for procedures.
- Passwords: argon2id through `@node-rs/argon2`, pinned to the exact version `2.2.1` (2.2.2 is less than 2 weeks old). Parameters: `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`.
- Passwords are 12 characters or more (and 256 or fewer). The app refuses the 10,000 most common passwords (a list in the repo), with no regard to letter case.
- Tokens (session, invite, reset): 32 random bytes. The database keeps only the SHA-256 hash of a token.
- An invite or a reset link is valid for 7 days and works one time.
- Session: 30 days. Each request moves `expiresAt` forward, at most one database write each hour for each session. The cookie holds the token, never the user ID. The cookie is `httpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when the request came over https. The cookie name is `SESSION_COOKIE` (port-specific, as today).
- Sign-in: 10 tries in 15 minutes for each IP address and for each email. Invite and reset tokens: 20 tries in 15 minutes for each IP address. The counts are in the `RateLimit` table. The IP address is the first entry of `X-Forwarded-For`.
- CSRF: every POST, PUT, PATCH and DELETE to `/api/` must have an `Origin` header whose host matches the request host, `X-Forwarded-Host`, or the host of `WAYPOINT_PUBLIC_URL`.
- Upload limit for a LinkedIn export: 50 MB. The server checks the file signature, not only the name.
- A request for a row of another user gets `404`, not `403`.
- Secrets: AES-256-GCM with the key `WAYPOINT_SECRET_KEY` (32 bytes, base64). A random 12-byte IV for each value. The row keeps the IV, the auth tag, the ciphertext and a key version. The app never sends a secret to the browser. It shows only the last 4 characters.
- Claude credential order for each call: (1) the user's own key, (2) `ANTHROPIC_API_KEY` while the user's shared-key cost this month (UTC) is below `WAYPOINT_SHARED_MONTHLY_USD` (default 5), (3) the `claude` CLI, **only for the admin**. A member never uses the CLI.
- `LlmUsage` keeps one row for each call: `userId`, `credential` (`own`, `shared` or `cli`), `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `costUsd`, `kind`, `createdAt`.
- All Claude calls use `MODEL` from `src/lib/claude/model.ts` (Sonnet). Do not change the model rules from part 1.
- Only `src/lib/exec.ts` starts processes. Lint enforces this for `src/`, `scripts/` and `tests/`.
- Do not touch the main checkout (`/home/shivoy/waypoint-shivoy`) or its database. This worktree's `data/waypoint.db` is a copy, and only Task 1 changes it.
- Commands: `npx vitest run <file>` for one test file, `npm test` for all, `npm run typecheck`, `npm run lint`.
- End each commit message with two lines: `Co-Authored-By: Claude <the model that wrote the commit> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01NBiMk6SSfnPwe8wAW7MFwo`.

## Review Focus

1. **The zrok tunnel.** Through zrok, the `Host` header can be `localhost:3118` while the browser sends `Origin: https://<name>.shares.zrok.io`. Writes must work when `WAYPOINT_PUBLIC_URL` names that URL. Test: Task 3, `tests/middleware.test.ts`, "accepts the public URL".
2. **A double click on an invite link.** Two redemptions of one invite at the same time must make exactly one account. Test: Task 7, `tests/api-invites.test.ts`, "one invite makes one account".
3. **Email case and spaces.** `" Admin@Example.COM "` must sign in as `admin@example.com`, and an invite for an email that exists in another case must fail. Test: Task 4, `tests/api-auth.test.ts`, "email case"; Task 7, "existing email in another case".
4. **A session that ends while the page is open.** An expired session, or a user that the admin disables, gets `401` with a JSON error on the next API request, not `500`. Test: Task 4, `tests/auth-session.test.ts` and `tests/api-auth.test.ts`, "disabled user".
5. **A member at the shared cap.** A member over the cap gets no credential (never the CLI), and the analysis falls back to the heuristic. Test: Task 6, `tests/claude-credential.test.ts`, "member over the cap".

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/1_accounts/` | New tables and fields; data move (Task 1) |
| `tests/setup/migrate.ts` | Applies migration SQL to a test database (Task 1) |
| `src/lib/auth/password.ts`, `common-passwords.txt` | Hash, check and rules for passwords (Task 2) |
| `src/lib/auth/tokens.ts` | Random tokens and their hashes (Task 2) |
| `src/lib/secrets.ts` | AES-256-GCM secrets for each user (Task 2) |
| `src/lib/auth/http.ts` | `HttpError`, `handle`, `readJson` (Task 3) |
| `src/lib/auth/origin.ts` | Same-origin check and public base URL; edge-safe (Task 3) |
| `src/lib/auth/rate-limit.ts` | Counts in the `RateLimit` table (Task 3) |
| `src/lib/auth/cookie-name.ts` | `SESSION_COOKIE`; edge-safe (Task 3) |
| `src/middleware.ts` | Redirect to `/login`; CSRF check (Task 3) |
| `src/lib/auth/session.ts` | Create, read, touch and end sessions; cookie helpers (Task 4) |
| `src/lib/auth/guard.ts` | `requireSession`, `requireUser`, `requireAdmin` (Task 4) |
| `src/lib/auth/users.ts` | `normEmail`, `createUser`, `setPassword` (Task 4) |
| `src/app/api/auth/login`, `signout` | Sign in and sign out (Task 4) |
| `src/app/login/page.tsx`, `src/components/LoginForm.tsx` | The sign-in page (Task 4) |
| `src/lib/auth/admin-setup.ts`, `scripts/create-admin.ts` | `npm run user:create-admin` (Task 5) |
| `src/lib/claude/usage.ts`, `credential.ts`, `failures.ts` | Credential for each user, cap, usage rows, banners (Task 6) |
| `src/lib/auth/invites.ts`, `src/app/api/invites/`, `src/app/api/admin/` | Invites, reset links, user admin (Task 7) |
| `src/app/api/account/` | Password, sessions, own Claude key (Task 8) |
| `src/lib/user.ts` (`claimsFor`, `isAdmin`), `analysis.ts`, `queue.ts`, `cv.ts` | Data isolation in the libraries (Task 9) |
| `tests/isolation.test.ts` | Two users for each API route (Task 10) |
| `src/components/SettingsScreen.tsx`, `TokenForm.tsx`, invite and reset pages | Settings and link pages (Task 11) |
| `src/app/api/health/route.ts`, `scripts/remote.sh`, docs | Health check, tunnel without basic auth, docs (Task 12) |

---

### Task 1: Schema and the `1_accounts` migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/1_accounts/migration.sql`
- Create: `tests/setup/migrate.ts`
- Modify: `tests/setup/db-env.ts`
- Test: `tests/migrations.test.ts`

**Interfaces:**
- Produces: Prisma models `Session`, `Invite`, `RateLimit`, `UserSecret`, `LlmUsage`, `JobAnalysis`; new `User` fields `passwordHash`, `role`, `disabledAt`; `Job` loses `analysis`, `analysedAt` and `analysisTries`.
- Produces: `applyMigrations(client: PrismaClient, names?: string[]): Promise<void>` and `migrationNames(): string[]` in `tests/setup/migrate.ts`.
- Produces: every test file opens a temporary database that has all migrations applied.

- [ ] **Step 1: Write the migration helper for tests**

Create `tests/setup/migrate.ts`:

```ts
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

/** Applies the named migrations (default: all), one statement at a time. */
export async function applyMigrations(client: PrismaClient, names = migrationNames()): Promise<void> {
  for (const name of names) {
    for (const stmt of statements(readFileSync(join(DIR, name, 'migration.sql'), 'utf8'))) {
      await client.$executeRawUnsafe(stmt);
    }
  }
}
```

- [ ] **Step 2: Write the failing migration test**

Create `tests/migrations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { applyMigrations, migrationNames } from './setup/migrate';

async function withDb(fn: (c: PrismaClient) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'wp-mig-'));
  const c = new PrismaClient({ datasourceUrl: `file:${join(dir, 'm.db')}` });
  try {
    await fn(c);
  } finally {
    await c.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('migration 1_accounts', () => {
  it('lists the migrations in order', () => {
    expect(migrationNames().slice(0, 2)).toEqual(['0_init', '1_accounts']);
  });

  it('makes the oldest user the admin and moves each analysis to JobAnalysis', async () => {
    await withDb(async (c) => {
      await applyMigrations(c, ['0_init']);
      await c.$executeRawUnsafe(
        `INSERT INTO "User" ("id","email","name","createdAt") VALUES ('u1',' Old@X.test ','Old',1700000000000), ('u2','new@x.test','New',1800000000000)`,
      );
      await c.$executeRawUnsafe(
        `INSERT INTO "Job" ("id","externalId","source","role","company","city","cc","url","analysis","analysedAt","analysisTries","fetchedAt","postedAt") VALUES
         ('j1','e1','Test','Dev','Acme','Berlin','DE','https://x.test','{"by":"claude"}',1750000000000,0,1750000000000,1750000000000),
         ('j2','e2','Test','Dev','Acme','Berlin','DE','https://y.test',NULL,NULL,0,1750000000000,1750000000000)`,
      );
      await applyMigrations(c, ['1_accounts']);

      const users = await c.$queryRawUnsafe<{ id: string; role: string; email: string }[]>(
        `SELECT "id","role","email" FROM "User" ORDER BY "id"`,
      );
      expect(users).toEqual([
        { id: 'u1', role: 'admin', email: 'old@x.test' },
        { id: 'u2', role: 'member', email: 'new@x.test' },
      ]);
      const rows = await c.$queryRawUnsafe<{ userId: string; jobId: string; analysis: string }[]>(
        `SELECT "userId","jobId","analysis" FROM "JobAnalysis"`,
      );
      expect(rows).toEqual([{ userId: 'u1', jobId: 'j1', analysis: '{"by":"claude"}' }]);
      const cols = await c.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("Job")`);
      expect(cols.map((x) => x.name)).not.toContain('analysis');
      expect(cols.map((x) => x.name)).not.toContain('analysisTries');
    });
  });

  it('runs on an empty database', async () => {
    await withDb(async (c) => {
      await applyMigrations(c);
      const [n] = await c.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "User"`);
      expect(Number(n.n)).toBe(0);
    });
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run tests/migrations.test.ts`
Expected: FAIL. The first test gets `['0_init']`, and the second test cannot find `prisma/migrations/1_accounts/migration.sql`.

- [ ] **Step 4: Change the schema**

In `prisma/schema.prisma`, replace the `User` model with:

```prisma
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  name         String
  picture      String?
  linkedin     String?
  // argon2id. Null only for a user from before part 2 until
  // `npm run user:create-admin` sets a password.
  passwordHash String?
  role         String    @default("member") // "admin" | "member"
  disabledAt   DateTime?
  createdAt    DateTime  @default(now())

  countries    CountryPref[]
  positions    Position[]
  educations   Education[]
  projects     ProjectItem[]
  skills       Skill[]
  contacts     Contact[]
  applications Application[]
  imports      ProfileImport[]
  sessions     Session[]
  secrets      UserSecret[]
  usage        LlmUsage[]
  analyses     JobAnalysis[]
  invitesMade  Invite[]      @relation("InviteCreator")
  resetLinks   Invite[]      @relation("InviteUser")
}
```

In the `Job` model, delete the `analysis`, `analysedAt` and `analysisTries` fields and the comment above `analysedAt`. Add this line after `applications Application[]`:

```prisma
  analyses     JobAnalysis[]
```

Add these models at the end of the file:

```prisma
// The cookie holds a random token. Only its SHA-256 hash is stored here.
model Session {
  id         String   @id @default(cuid())
  tokenHash  String   @unique
  userId     String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())
  userAgent  String?
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// An invite (kind "invite") or a password reset link (kind "reset").
// Valid for 7 days, one use. Only the SHA-256 hash of the token is stored.
model Invite {
  id          String    @id @default(cuid())
  tokenHash   String    @unique
  kind        String
  email       String?
  userId      String?
  createdById String
  expiresAt   DateTime
  usedAt      DateTime?
  createdAt   DateTime  @default(now())
  user        User?     @relation("InviteUser", fields: [userId], references: [id], onDelete: Cascade)
  createdBy   User      @relation("InviteCreator", fields: [createdById], references: [id], onDelete: Cascade)
}

// Attempt counts for sign-in and token links. A table, so that a restart
// does not reset the counts.
model RateLimit {
  key         String   @id
  count       Int
  windowStart DateTime
}

// An encrypted secret of one user (AES-256-GCM). kind: "anthropic" | "github" | "gdrive".
model UserSecret {
  userId     String
  kind       String
  iv         String
  tag        String
  data       String
  keyVersion Int      @default(1)
  last4      String
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, kind])
}

// One row for each Claude call. credential: "own" | "shared" | "cli".
model LlmUsage {
  id              String   @id @default(cuid())
  userId          String
  credential      String
  model           String
  kind            String
  inputTokens     Int
  outputTokens    Int
  cacheReadTokens Int      @default(0)
  costUsd         Float
  createdAt       DateTime @default(now())
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, credential, createdAt])
}

// The analysis of one job for one user. It replaces Job.analysis, because the
// prompt contains the profile of the user.
model JobAnalysis {
  userId     String
  jobId      String
  analysis   String
  analysedAt DateTime?
  tries      Int       @default(0)
  updatedAt  DateTime  @updatedAt
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  job        Job       @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@id([userId, jobId])
  @@index([jobId])
}
```

- [ ] **Step 5: Generate the migration SQL**

Run:

```bash
mkdir -p prisma/migrations/1_accounts
SHADOW="$(mktemp -d)/shadow.db"
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "file:$SHADOW" --script > prisma/migrations/1_accounts/migration.sql
npx prisma generate
```

Expected: the file has `CREATE TABLE` statements for the 6 new tables, and a `RedefineTables` block that rebuilds `User` and `Job` (`CREATE TABLE "new_Job"`, `INSERT INTO "new_Job" ... SELECT ... FROM "Job"`, `DROP TABLE "Job"`, `ALTER TABLE "new_Job" RENAME TO "Job"`).

- [ ] **Step 6: Add the data steps to the migration by hand**

Open `prisma/migrations/1_accounts/migration.sql`.

1. Find the `CREATE TABLE "JobAnalysis"` statement. Directly after it, and before the `PRAGMA defer_foreign_keys=ON;` line of the `RedefineTables` block, insert:

```sql
-- Move each stored analysis to the oldest user (the owner of this copy
-- before part 2). This runs before the Job table loses the columns.
INSERT INTO "JobAnalysis" ("userId", "jobId", "analysis", "analysedAt", "tries", "updatedAt")
SELECT u."id", j."id", j."analysis", j."analysedAt", j."analysisTries", COALESCE(j."analysedAt", j."fetchedAt")
FROM "Job" j, (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) u
WHERE j."analysis" IS NOT NULL;
```

2. At the end of the file, append:

```sql
-- Emails are stored trimmed and in lower case, so sign-in ignores case.
UPDATE "User" SET "email" = lower(trim("email"));

-- The oldest user becomes the admin. `npm run user:create-admin` sets the password.
UPDATE "User" SET "role" = 'admin'
WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1);
```

Check that each statement ends with `;` at the end of a line. The test helper splits on that.

- [ ] **Step 7: Run the migration test**

Run: `npx vitest run tests/migrations.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Apply all migrations to the temporary test database**

Replace `tests/setup/db-env.ts` with:

```ts
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
  const client = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    await applyMigrations(client);
  } finally {
    await client.$disconnect();
  }
}

export function teardown(): void {
  if (dir) rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 9: Run all tests and the type check**

Run: `npm test` then `npm run typecheck`
Expected: all tests pass. The type check fails in `src/lib/analysis.ts`, `src/lib/queue.ts`, `src/app/api/jobs/[id]/route.ts` and `src/app/api/profile/import/route.ts`, because `Job.analysis`, `analysedAt` and `analysisTries` are gone. Do this minimum fix now, so that the branch compiles (Task 9 replaces it with real per-user code):

- In `src/lib/analysis.ts` `analyseJob`, read and write `db.jobAnalysis` (key `userId_jobId`) in place of the three `Job` fields:

```ts
export async function analyseJob(job: Job, userId: string, force = false): Promise<Analysis> {
  const row = await db.jobAnalysis.findUnique({ where: { userId_jobId: { userId, jobId: job.id } } });
  if (row?.analysedAt && !force) return parseAnalysis(row.analysis);
  // ... the body that makes `analysis` and `read` stays as it is ...
  await db.jobAnalysis.upsert({
    where: { userId_jobId: { userId, jobId: job.id } },
    create: { userId, jobId: job.id, analysis: JSON.stringify(analysis), analysedAt: read ? new Date() : null, tries: read ? 0 : 1 },
    update: { analysis: JSON.stringify(analysis), ...(read ? { analysedAt: new Date() } : { tries: { increment: 1 } }) },
  });
  return analysis;
}
```

  Delete the `db.job.update` that wrote `field`, `mode`, `level`, `sponsor` and `visa`. These are AI output for one user, and spec 6.8 says that no AI output for user A reaches user B.
- In `makeJobViewer` and `jobView`, load the row of this user: `makeJobViewer` loads `db.jobAnalysis.findMany({ where: { userId } })` into a `Map` by `jobId`, and `jobView` uses `db.jobAnalysis.findUnique`. Use `parseAnalysis(row.analysis)` where the code used `parseAnalysis(job.analysis)`.
- In `src/lib/queue.ts`, change the candidate query to:

```ts
  const candidates = await db.job.findMany({
    where: {
      cc: { in: onCcs },
      analyses: { none: { userId, OR: [{ analysedAt: { not: null } }, { tries: { gte: MAX_ANALYSIS_TRIES } }] } },
    },
    orderBy: { postedAt: 'desc' },
    take: 400,
  });
```

- In `src/app/api/jobs/[id]/route.ts` `detail`, replace `if (force || !job.analysedAt)` with a read of the row: `const row = await db.jobAnalysis.findUnique({ where: { userId_jobId: { userId, jobId } } }); if (force || !row?.analysedAt) await analyseJob(job, userId, force);`
- In `src/app/api/profile/import/route.ts`, replace `db.job.updateMany({ data: { analysis: null } })` with `db.jobAnalysis.deleteMany({ where: { userId } })`. The old line cleared the analyses of all users.

Run `npm run typecheck` again. Expected: no errors.

- [ ] **Step 10: Apply the migration to this worktree's database copy**

This worktree's `data/waypoint.db` is a copy of the live database (part 1, ruling R2). Back it up, then apply:

```bash
mkdir -p data/backups
cp data/waypoint.db data/backups/waypoint-before-part2.db
[ -f data/waypoint.db-wal ] && cp data/waypoint.db-wal data/backups/waypoint-before-part2.db-wal
npx prisma migrate deploy
npx prisma migrate status
```

Expected: `migrate deploy` applies `1_accounts`. `migrate status` prints "Database schema is up to date!".

- [ ] **Step 11: Run all tests, then commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass, lint 0 errors.

```bash
git add prisma/schema.prisma prisma/migrations/1_accounts tests/setup tests/migrations.test.ts src/lib/analysis.ts src/lib/queue.ts 'src/app/api/jobs/[id]/route.ts' src/app/api/profile/import/route.ts
git commit -m "Add the account tables and move each analysis to its user"
```

---

### Task 2: Passwords, tokens and encrypted secrets

**Files:**
- Modify: `package.json`, `package-lock.json` (add `@node-rs/argon2` 2.2.1)
- Modify: `next.config.mjs`
- Create: `src/lib/auth/password.ts`, `src/lib/auth/common-passwords.txt`, `src/lib/auth/tokens.ts`, `src/lib/secrets.ts`
- Test: `tests/auth-password.test.ts`, `tests/secrets.test.ts`

**Interfaces:**
- Consumes: `env().WAYPOINT_SECRET_KEY` (part 1); the `UserSecret` model (Task 1).
- Produces (`src/lib/auth/password.ts`): `MIN_PASSWORD = 12`, `MAX_PASSWORD = 256`, `hashPassword(pw: string): Promise<string>`, `verifyPassword(stored: string, pw: string): Promise<boolean>`, `burnPasswordCheck(pw: string): Promise<void>`, `passwordProblem(pw: string, who?: { email?: string | null; name?: string | null }): string | null`.
- Produces (`src/lib/auth/tokens.ts`): `newToken(): { token: string; hash: string }`, `hashToken(token: string): string`.
- Produces (`src/lib/secrets.ts`): `type SecretKind = 'anthropic' | 'github' | 'gdrive'`, `type Sealed`, `seal(plain, aad, key?)`, `unseal(sealed, aad, key?)`, `saveSecret(userId, kind, value): Promise<void>`, `readSecret(userId, kind): Promise<string | null>`, `secretHint(userId, kind): Promise<string | null>`, `deleteSecret(userId, kind): Promise<void>`.

- [ ] **Step 1: Add the dependency and the password list**

```bash
npm install --save-exact @node-rs/argon2@2.2.1
curl -fsSL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/10k-most-common.txt -o src/lib/auth/common-passwords.txt
wc -l src/lib/auth/common-passwords.txt
```

Expected: about 10,000 lines. If `npm install` changes more than `@node-rs/argon2` and its platform packages in `package-lock.json`, stop and report it.

In `next.config.mjs`, add `serverComponentsExternalPackages: ['@node-rs/argon2']` to the `experimental` object (it already has `instrumentationHook: true`). Webpack cannot bundle the native `.node` file.

- [ ] **Step 2: Write the failing password tests**

Create `tests/auth-password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from '@/lib/auth/password';
import { hashToken, newToken } from '@/lib/auth/tokens';

describe('passwords', () => {
  it('hashes with argon2id and checks the password', async () => {
    const h = await hashPassword('a long passphrase 123');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'a long passphrase 123')).toBe(true);
    expect(await verifyPassword(h, 'a long passphrase 124')).toBe(false);
  });

  it('returns false for a stored value that is not a hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever whatever')).toBe(false);
  });

  it('runs a check without a user', async () => {
    await expect(burnPasswordCheck('anything at all')).resolves.toBeUndefined();
  });

  it('refuses short and long passwords', () => {
    expect(passwordProblem('elevenchars')).toMatch(/12 characters/);
    expect(passwordProblem('x'.repeat(257))).toMatch(/256/);
    expect(passwordProblem('twelve chars')).toBeNull();
  });

  it('refuses a common password in any letter case', () => {
    const common = readFileSync('src/lib/auth/common-passwords.txt', 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s.length >= 12);
    expect(common).toBeTruthy();
    expect(passwordProblem(common!)).toMatch(/common/);
    expect(passwordProblem(common!.toUpperCase())).toMatch(/common/);
  });

  it('refuses the email or the name as the password', () => {
    expect(passwordProblem('janedoe12345@x.test', { email: 'JaneDoe12345@x.test' })).toMatch(/name or email/);
    expect(passwordProblem('janedoe12345', { email: 'janedoe12345@x.test' })).toMatch(/name or email/);
    expect(passwordProblem('Jane Doe The Third', { name: 'jane doe the third' })).toMatch(/name or email/);
  });
});

describe('tokens', () => {
  it('makes 32 random bytes and keeps only the SHA-256 hash', () => {
    const a = newToken();
    const b = newToken();
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a.token)).toBe(a.hash);
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run tests/auth-password.test.ts`
Expected: FAIL, "Cannot find module '@/lib/auth/password'".

- [ ] **Step 4: Write the password and token modules**

Create `src/lib/auth/password.ts`:

```ts
import { hash, verify } from '@node-rs/argon2';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Password hashes and rules.
 *
 * argon2id is the default algorithm of @node-rs/argon2. These are the OWASP
 * minimum values: 19 MiB of memory, 2 passes, 1 lane. One hash takes about
 * 0.2 s on a Raspberry Pi 4.
 */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 256;

export const hashPassword = (pw: string) => hash(pw, OPTIONS);

/** False for a wrong password and for a stored value that is not a hash. */
export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  try {
    return await verify(stored, pw);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;

/**
 * Does the same work as a real check. Sign-in calls it when the email is
 * unknown, so the response time does not show which emails have accounts.
 */
export async function burnPasswordCheck(pw: string): Promise<void> {
  dummy ??= hashPassword('waypoint dummy password');
  await verifyPassword(await dummy, pw);
}

let common: Set<string> | null = null;

function commonPasswords(): Set<string> {
  common ??= new Set(
    readFileSync(join(process.cwd(), 'src/lib/auth/common-passwords.txt'), 'utf8')
      .split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return common;
}

/** The first problem with a new password, or null if it is good. */
export function passwordProblem(pw: string, who: { email?: string | null; name?: string | null } = {}): string | null {
  if (pw.length < MIN_PASSWORD) return `Use ${MIN_PASSWORD} characters or more.`;
  if (pw.length > MAX_PASSWORD) return `Use ${MAX_PASSWORD} characters or fewer.`;
  const lower = pw.toLowerCase();
  if (commonPasswords().has(lower)) return 'This password is on a list of common passwords. Use a different one.';
  const email = who.email?.trim().toLowerCase();
  const local = email?.split('@')[0];
  const name = who.name?.trim().toLowerCase();
  if ((email && lower === email) || (local && lower === local) || (name && lower === name)) {
    return 'Do not use your name or email as the password.';
  }
  return null;
}
```

Create `src/lib/auth/tokens.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

/** A token for a cookie or a link: 32 random bytes. Store only `hash`. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
```

- [ ] **Step 5: Run the password tests**

Run: `npx vitest run tests/auth-password.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Write the failing secrets tests**

Create `tests/secrets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { deleteSecret, readSecret, saveSecret, seal, secretHint, unseal } from '@/lib/secrets';

const newUser = () =>
  db.user.create({ data: { email: `s-${randomBytes(6).toString('hex')}@test.local`, name: 'S' } });

describe('seal and unseal', () => {
  const key = randomBytes(32);

  it('round-trips and uses a new IV each time', () => {
    const a = seal('sk-ant-secret-value', 'u1:anthropic', key);
    const b = seal('sk-ant-secret-value', 'u1:anthropic', key);
    expect(Buffer.from(a.iv, 'base64')).toHaveLength(12);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toContain('secret');
    expect(unseal(a, 'u1:anthropic', key)).toBe('sk-ant-secret-value');
  });

  it('fails for another user, a changed tag or another key', () => {
    const s = seal('value', 'u1:anthropic', key);
    expect(() => unseal(s, 'u2:anthropic', key)).toThrow();
    const tag = Buffer.from(s.tag, 'base64');
    tag[0] ^= 1;
    expect(() => unseal({ ...s, tag: tag.toString('base64') }, 'u1:anthropic', key)).toThrow();
    expect(() => unseal(s, 'u1:anthropic', randomBytes(32))).toThrow();
  });
});

describe('user secrets', () => {
  it('saves, reads, hints and deletes', async () => {
    const u = await newUser();
    expect(await readSecret(u.id, 'anthropic')).toBeNull();
    await saveSecret(u.id, 'anthropic', 'sk-ant-api03-abcdefWXYZ');
    expect(await readSecret(u.id, 'anthropic')).toBe('sk-ant-api03-abcdefWXYZ');
    expect(await secretHint(u.id, 'anthropic')).toBe('WXYZ');
    const row = await db.userSecret.findUniqueOrThrow({ where: { userId_kind: { userId: u.id, kind: 'anthropic' } } });
    expect(row.data).not.toContain('abcdef');
    expect(row.keyVersion).toBe(1);
    await deleteSecret(u.id, 'anthropic');
    expect(await readSecret(u.id, 'anthropic')).toBeNull();
  });

  it('cannot read a row that is copied to another user', async () => {
    const a = await newUser();
    const b = await newUser();
    await saveSecret(a.id, 'github', 'ghp_secret_of_a');
    const row = await db.userSecret.findUniqueOrThrow({ where: { userId_kind: { userId: a.id, kind: 'github' } } });
    await db.userSecret.create({ data: { ...row, userId: b.id } });
    expect(await readSecret(b.id, 'github')).toBeNull();
  });
});
```

- [ ] **Step 7: Run the test to see it fail**

Run: `npx vitest run tests/secrets.test.ts`
Expected: FAIL, "Cannot find module '@/lib/secrets'".

- [ ] **Step 8: Write the secrets module**

Create `src/lib/secrets.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { db } from './db';
import { env } from './env';

/**
 * Secrets of each user: the Anthropic key, the GitHub token and the Drive
 * refresh token. AES-256-GCM with WAYPOINT_SECRET_KEY. The additional data
 * is "<userId>:<kind>", so a row copied to another user does not decrypt.
 */

export type SecretKind = 'anthropic' | 'github' | 'gdrive';
export type Sealed = { iv: string; tag: string; data: string; keyVersion: number };

const KEY_VERSION = 1;

const masterKey = () => Buffer.from(env().WAYPOINT_SECRET_KEY, 'base64');

export function seal(plain: string, aad: string, key: Buffer = masterKey()): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'), keyVersion: KEY_VERSION };
}

export function unseal(sealed: Sealed, aad: string, key: Buffer = masterKey()): string {
  if (sealed.keyVersion !== KEY_VERSION) throw new Error(`Unknown secret key version ${sealed.keyVersion}.`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
}

const aadOf = (userId: string, kind: SecretKind) => `${userId}:${kind}`;

export async function saveSecret(userId: string, kind: SecretKind, value: string): Promise<void> {
  const sealed = seal(value, aadOf(userId, kind));
  const last4 = value.slice(-4);
  await db.userSecret.upsert({
    where: { userId_kind: { userId, kind } },
    create: { userId, kind, ...sealed, last4 },
    update: { ...sealed, last4 },
  });
}

/** Null if there is no secret, or if it does not decrypt (the log says why). */
export async function readSecret(userId: string, kind: SecretKind): Promise<string | null> {
  const row = await db.userSecret.findUnique({ where: { userId_kind: { userId, kind } } });
  if (!row) return null;
  try {
    return unseal(row, aadOf(userId, kind));
  } catch (e) {
    console.error(`[secrets] cannot decrypt the ${kind} secret of user ${userId}:`, (e as Error).message);
    return null;
  }
}

/** The last 4 characters, for Settings. Never the secret. */
export async function secretHint(userId: string, kind: SecretKind): Promise<string | null> {
  const row = await db.userSecret.findUnique({ where: { userId_kind: { userId, kind } }, select: { last4: true } });
  return row?.last4 ?? null;
}

export async function deleteSecret(userId: string, kind: SecretKind): Promise<void> {
  await db.userSecret.deleteMany({ where: { userId, kind } });
}
```

- [ ] **Step 9: Run the tests, then commit**

Run: `npx vitest run tests/auth-password.test.ts tests/secrets.test.ts && npm run typecheck && npm run lint`
Expected: PASS (11 tests), no type errors, lint 0 errors.

```bash
git add package.json package-lock.json next.config.mjs src/lib/auth/password.ts src/lib/auth/common-passwords.txt src/lib/auth/tokens.ts src/lib/secrets.ts tests/auth-password.test.ts tests/secrets.test.ts
git commit -m "Add argon2id passwords, tokens and encrypted user secrets"
```

---

### Task 3: HTTP helpers, origin check, rate limits and middleware

**Files:**
- Modify: `src/lib/env.ts`
- Create: `src/lib/auth/http.ts`, `src/lib/auth/origin.ts`, `src/lib/auth/rate-limit.ts`, `src/lib/auth/cookie-name.ts`, `src/middleware.ts`
- Modify: `src/lib/user.ts` (move `SESSION_COOKIE` out)
- Test: `tests/auth-http.test.ts`, `tests/rate-limit.test.ts`, `tests/middleware.test.ts`

**Interfaces:**
- Produces (`http.ts`): `class HttpError extends Error { status: number }`; `type RouteContext = { params: Record<string, string> }`; `handle<C = RouteContext>(fn: (req: NextRequest, ctx: C) => Promise<Response>): (req: NextRequest, ctx: C) => Promise<Response>`; `readJson(req: Request): Promise<Record<string, unknown>>`.
- Produces (`origin.ts`, edge-safe, no Node imports): `sameOrigin(req: Request): boolean`, `publicBase(req: Request): string`.
- Produces (`rate-limit.ts`): `hitLimit(key: string, max: number, windowMs: number, now?: Date): Promise<{ ok: boolean; retryAfterSec: number }>`, `clearLimit(key: string): Promise<void>`, `clientIp(headers: Headers): string`, `FIFTEEN_MINUTES = 900_000`.
- Produces (`cookie-name.ts`, edge-safe): `SESSION_COOKIE`.
- Produces (`env.ts`): new keys `WAYPOINT_PUBLIC_URL?: string` and `WAYPOINT_SHARED_MONTHLY_USD: number` (default 5); `resetEnvForTests(): void`.

- [ ] **Step 1: Write the failing tests**

Create `tests/auth-http.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { publicBase, sameOrigin } from '@/lib/auth/origin';

const req = (headers: Record<string, string>, method = 'POST', body?: string) =>
  new NextRequest('http://localhost:3117/api/x', { method, headers, body });

describe('handle', () => {
  it('turns an HttpError into JSON with its status', async () => {
    const h = handle(async () => { throw new HttpError(404, 'Not found.'); });
    const res = await h(req({}), { params: {} });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found.' });
  });

  it('turns a Prisma "record not found" into 404', async () => {
    const h = handle(async () => { throw Object.assign(new Error('No Job found'), { code: 'P2025' }); });
    expect((await h(req({}), { params: {} })).status).toBe(404);
  });

  it('hides the message of an unknown error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = handle(async () => { throw new Error('/home/shivoy/secret/path failed'); });
    const res = await h(req({}), { params: {} });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('/home');
    spy.mockRestore();
  });

  it('passes a normal response through', async () => {
    const h = handle(async () => NextResponse.json({ ok: true }));
    expect(await (await h(req({}), { params: {} })).json()).toEqual({ ok: true });
  });
});

describe('readJson', () => {
  it('reads an object and refuses other bodies with 400', async () => {
    expect(await readJson(req({}, 'POST', '{"a":1}'))).toEqual({ a: 1 });
    await expect(readJson(req({}, 'POST', 'not json'))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(req({}, 'POST', '[1,2]'))).rejects.toMatchObject({ status: 400 });
  });
});

describe('sameOrigin', () => {
  it('accepts the same host and refuses others', () => {
    expect(sameOrigin(req({ origin: 'http://localhost:3117', host: 'localhost:3117' }))).toBe(true);
    expect(sameOrigin(req({ origin: 'https://evil.test', host: 'localhost:3117' }))).toBe(false);
    expect(sameOrigin(req({ host: 'localhost:3117' }))).toBe(false);
    expect(sameOrigin(req({ origin: 'null', host: 'localhost:3117' }))).toBe(false);
  });

  it('accepts X-Forwarded-Host', () => {
    expect(sameOrigin(req({ origin: 'https://a.test', host: 'localhost:3118', 'x-forwarded-host': 'a.test' }))).toBe(true);
  });

  it('accepts the public URL', () => {
    vi.stubEnv('WAYPOINT_PUBLIC_URL', 'https://wp.shares.zrok.io');
    try {
      expect(sameOrigin(req({ origin: 'https://wp.shares.zrok.io', host: 'localhost:3118' }))).toBe(true);
      expect(publicBase(req({ host: 'localhost:3118' }))).toBe('https://wp.shares.zrok.io');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('builds the base from the forwarded headers without a public URL', () => {
    expect(publicBase(req({ host: 'localhost:3118', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'a.test' }))).toBe('https://a.test');
    expect(publicBase(req({ host: 'localhost:3118' }))).toBe('http://localhost:3118');
  });
});
```

Create `tests/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { clearLimit, clientIp, hitLimit } from '@/lib/auth/rate-limit';

const key = () => `test:${randomBytes(6).toString('hex')}`;

describe('hitLimit', () => {
  it('allows max tries in the window, then refuses with a wait time', async () => {
    const k = key();
    const t0 = new Date('2026-10-16T10:00:00Z');
    for (let i = 0; i < 3; i++) expect((await hitLimit(k, 3, 60_000, t0)).ok).toBe(true);
    const no = await hitLimit(k, 3, 60_000, new Date(t0.getTime() + 10_000));
    expect(no.ok).toBe(false);
    expect(no.retryAfterSec).toBe(50);
  });

  it('starts a new window after the old one ends', async () => {
    const k = key();
    const t0 = new Date('2026-10-16T10:00:00Z');
    for (let i = 0; i < 3; i++) await hitLimit(k, 3, 60_000, t0);
    expect((await hitLimit(k, 3, 60_000, new Date(t0.getTime() + 60_000))).ok).toBe(true);
  });

  it('clears a key', async () => {
    const k = key();
    const t0 = new Date();
    for (let i = 0; i < 3; i++) await hitLimit(k, 3, 60_000, t0);
    await clearLimit(k);
    expect((await hitLimit(k, 3, 60_000, t0)).ok).toBe(true);
  });
});

describe('clientIp', () => {
  it('takes the first X-Forwarded-For entry', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers())).toBe('local');
  });
});
```

Create `tests/middleware.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';

const run = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  middleware(new NextRequest(new URL(path, 'http://localhost:3117'), { method: init.method ?? 'GET', headers: { host: 'localhost:3117', ...init.headers } }));

const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';

describe('middleware', () => {
  it('sends a signed-out page request to /login', () => {
    const res = run('/');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3117/login?next=%2F');
  });

  it('lets a page request with a session cookie through', () => {
    expect(passes(run('/', { headers: { cookie: `${SESSION_COOKIE}=abc` } }))).toBe(true);
  });

  it('lets the public pages through', () => {
    expect(passes(run('/login'))).toBe(true);
    expect(passes(run('/invite/abc'))).toBe(true);
    expect(passes(run('/reset/abc'))).toBe(true);
  });

  it('lets API reads through; the route checks the session', () => {
    expect(passes(run('/api/state'))).toBe(true);
  });

  it('refuses a cross-origin write', async () => {
    const res = run('/api/jobs/refresh', { method: 'POST', headers: { origin: 'https://evil.test' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'This request came from another site. It was refused.' });
  });

  it('refuses a write with no Origin', () => {
    expect(run('/api/auth/login', { method: 'POST' }).status).toBe(403);
  });

  it('lets a same-origin write through', () => {
    expect(passes(run('/api/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3117' } }))).toBe(true);
  });

  it('accepts the public URL', () => {
    vi.stubEnv('WAYPOINT_PUBLIC_URL', 'https://wp.shares.zrok.io');
    try {
      const res = run('/api/countries', { method: 'POST', headers: { origin: 'https://wp.shares.zrok.io', host: 'localhost:3118' } });
      expect(passes(res)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/auth-http.test.ts tests/rate-limit.test.ts tests/middleware.test.ts`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Add the env keys**

In `src/lib/env.ts`, add these 2 keys to the `schema` object:

```ts
  WAYPOINT_PUBLIC_URL: z.preprocess(empty, z.url({ error: 'must be a full URL, for example https://name.shares.zrok.io' }).optional()),
  WAYPOINT_SHARED_MONTHLY_USD: z.preprocess(empty, z.coerce.number().nonnegative().default(5)),
```

At the end of the file, add:

```ts
/** Tests change process.env with vi.stubEnv. This makes env() read it again. */
export function resetEnvForTests(): void {
  cached = null;
}
```

- [ ] **Step 4: Write the modules**

Create `src/lib/auth/cookie-name.ts`:

```ts
/** Browsers share cookies across ports on one host, so a second copy of the
 *  app on another port would read the session of this one. The name is
 *  port-specific for that reason. Edge-safe: the middleware imports it. */
export const SESSION_COOKIE = process.env.PORT && process.env.PORT !== '3117' ? `waypoint_user_${process.env.PORT}` : 'waypoint_user';
```

In `src/lib/user.ts`, delete the `SESSION_COOKIE` constant and its comment. Run `grep -rn "SESSION_COOKIE" src` and change each import to `@/lib/auth/cookie-name`.

Create `src/lib/auth/http.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';

/** An error with an HTTP status. `handle` sends it to the client as { error }. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type RouteContext = { params: Record<string, string> };

/**
 * The wrapper for every API route. An HttpError becomes JSON with its status.
 * A Prisma "record not found" (P2025) becomes 404. Any other error is logged
 * and becomes a 500 with a fixed message, so paths and stack details stay on
 * the server.
 */
export function handle<C = RouteContext>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if ((e as { code?: string } | null)?.code === 'P2025') return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      console.error('[api]', req.method, req.nextUrl.pathname, e);
      return NextResponse.json({ error: 'Something went wrong. The server log has the details.' }, { status: 500 });
    }
  };
}

/** The JSON body as an object. Any other body is a 400. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'The request body must be a JSON object.');
  return body as Record<string, unknown>;
}
```

Create `src/lib/auth/origin.ts`:

```ts
/**
 * Same-origin checks. Edge-safe (the middleware imports this file), so it
 * reads process.env directly and not through env().
 *
 * Behind zrok, the Host header can be localhost:<port> while the browser
 * sends the public URL as Origin. WAYPOINT_PUBLIC_URL names that URL.
 */

const first = (v: string | null) => (v ?? '').split(',')[0].trim();

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** True when the Origin header names this app. A missing Origin is false. */
export function sameOrigin(req: Request): boolean {
  const origin = hostOf(req.headers.get('origin') ?? undefined);
  if (!origin) return false;
  const allowed = [first(req.headers.get('host')), first(req.headers.get('x-forwarded-host')), hostOf(process.env.WAYPOINT_PUBLIC_URL)];
  return allowed.some((h) => !!h && h === origin);
}

/** The base URL for links that the admin sends (invites, password resets). */
export function publicBase(req: Request): string {
  const configured = process.env.WAYPOINT_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const proto = first(req.headers.get('x-forwarded-proto')) || new URL(req.url).protocol.replace(':', '');
  const host = first(req.headers.get('x-forwarded-host')) || first(req.headers.get('host')) || new URL(req.url).host;
  return `${proto}://${host}`;
}
```

Create `src/lib/auth/rate-limit.ts`:

```ts
import { db } from '../db';

export const FIFTEEN_MINUTES = 15 * 60_000;

/**
 * Counts one try against `key`. Refuses when `max` tries are already in the
 * current window. The counts are in the database, so a restart keeps them.
 */
export async function hitLimit(key: string, max: number, windowMs: number, now = new Date()): Promise<{ ok: boolean; retryAfterSec: number }> {
  const result = await db.$transaction(async (tx) => {
    const row = await tx.rateLimit.findUnique({ where: { key } });
    if (!row || now.getTime() - row.windowStart.getTime() >= windowMs) {
      await tx.rateLimit.upsert({ where: { key }, create: { key, count: 1, windowStart: now }, update: { count: 1, windowStart: now } });
      return { ok: true, retryAfterSec: 0 };
    }
    if (row.count >= max) {
      return { ok: false, retryAfterSec: Math.ceil((row.windowStart.getTime() + windowMs - now.getTime()) / 1000) };
    }
    await tx.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return { ok: true, retryAfterSec: 0 };
  });
  // A false X-Forwarded-For makes a new key for each try. Remove old rows
  // on about 1 call in 100, so that the table stays small.
  if (Math.random() < 0.01) {
    await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * 3600_000) } } });
  }
  return result;
}

export async function clearLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

/** The first X-Forwarded-For entry. The tunnel sets it. It can be false, so
 *  sign-in also counts tries for each email. */
export function clientIp(headers: Headers): string {
  return (headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
}
```

Create `src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { sameOrigin } from '@/lib/auth/origin';

/**
 * Two jobs, and nothing that needs the database:
 * 1. Refuse a cross-origin POST, PUT, PATCH or DELETE to /api/ (CSRF).
 * 2. Send a page request without a session cookie to /login.
 * The route handlers check the session itself (requireUser).
 */

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_PAGES = [/^\/login$/, /^\/invite\/[^/]+$/, /^\/reset\/[^/]+$/];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (WRITES.has(req.method) && !sameOrigin(req)) {
      return NextResponse.json({ error: 'This request came from another site. It was refused.' }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (PUBLIC_PAGES.some((r) => r.test(pathname))) return NextResponse.next();
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const login = new URL('/login', req.url);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/auth-http.test.ts tests/rate-limit.test.ts tests/middleware.test.ts tests/env.test.ts`
Expected: PASS. If `tests/env.test.ts` fails because a test compares the whole parsed object, add the 2 new keys (`WAYPOINT_SHARED_MONTHLY_USD: 5`, no `WAYPOINT_PUBLIC_URL`) to its expected value.

Add 2 tests to `tests/env.test.ts`, in its existing style: `WAYPOINT_SHARED_MONTHLY_USD` is `5` when it is not set and `2.5` when it is `"2.5"`; `WAYPOINT_PUBLIC_URL: "not a url"` makes `parseEnv` throw an `EnvError` whose message contains `WAYPOINT_PUBLIC_URL`.

- [ ] **Step 6: Run all checks, then commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

```bash
git add src/lib/env.ts src/lib/auth/http.ts src/lib/auth/origin.ts src/lib/auth/rate-limit.ts src/lib/auth/cookie-name.ts src/middleware.ts src/lib/user.ts tests/auth-http.test.ts tests/rate-limit.test.ts tests/middleware.test.ts tests/env.test.ts
git add -u src
git commit -m "Add the route wrapper, origin check, rate limits and middleware"
```

---

### Task 4: Sessions, guards, sign-in and the login page

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/auth/guard.ts`, `src/lib/auth/users.ts`
- Create: `src/app/api/auth/login/route.ts`; modify `src/app/api/auth/signout/route.ts`
- Create: `src/app/login/page.tsx`, `src/components/LoginForm.tsx`
- Modify: every route under `src/app/api/` (the list is in Step 7), `src/lib/user.ts`, `src/components/api.ts`, `src/components/Waypoint.tsx`
- Delete: `src/lib/access.ts`, `src/app/api/auth/local/route.ts`, `src/app/api/auth/linkedin/start/route.ts`, `src/app/api/auth/linkedin/callback/route.ts`, `src/components/SignIn.tsx`
- Create: `tests/helpers/http.ts`
- Test: `tests/auth-session.test.ts`, `tests/api-auth.test.ts`

**Interfaces:**
- Consumes: `hashToken`, `newToken` (Task 2); `hashPassword`, `verifyPassword`, `burnPasswordCheck`, `passwordProblem` (Task 2); `HttpError`, `handle`, `readJson`, `hitLimit`, `clearLimit`, `clientIp`, `FIFTEEN_MINUTES`, `SESSION_COOKIE` (Task 3).
- Produces (`session.ts`): `SESSION_MS = 30 days`, `TOUCH_MS = 1 hour`, `createSession(userId: string, userAgent: string | null): Promise<string>` (returns the token), `readSession(req: Request): Promise<{ user: User; session: Session } | null>`, `endSession(id: string): Promise<void>`, `endUserSessions(userId: string, exceptSessionId?: string): Promise<void>`, `isHttps(req: Request): boolean`, `setSessionCookie(res: NextResponse, token: string, req: Request): void`, `clearSessionCookie(res: NextResponse, req: Request): void`.
- Produces (`guard.ts`): `requireSession(req): Promise<{ user: User; session: Session }>` (401), `requireUser(req): Promise<User>` (401), `requireAdmin(req): Promise<User>` (401, or 403 for a member).
- Produces (`users.ts`): `normEmail(v: unknown): string`, `createUser(input: { email: string; name: string; password: string; role?: 'admin' | 'member' }): Promise<User>`, `setPassword(userId: string, password: string, keepSessionId?: string): Promise<void>`.
- Produces (`tests/helpers/http.ts`): `ORIGIN`, `TEST_PASSWORD`, `makeUser(role?)`, `request(path, init?)`, `ctx(params?)`.
- Produces: `POST /api/auth/login` `{ email, password }` → `{ ok: true }` and the cookie; `POST /api/auth/signout` → `{ ok: true }`.
- Produces (`src/components/api.ts`): `class ApiError extends Error { status: number }`; `api()` throws it.

- [ ] **Step 1: Write the session, user and guard modules**

Create `src/lib/auth/session.ts`:

```ts
import type { NextResponse } from 'next/server';
import type { Session, User } from '@prisma/client';
import { db } from '../db';
import { SESSION_COOKIE } from './cookie-name';
import { hashToken, newToken } from './tokens';

export const SESSION_MS = 30 * 24 * 3600_000;
/** Each request moves the expiry forward, but writes at most one time each hour. */
export const TOUCH_MS = 3600_000;
/** The browser keeps the cookie for 400 days (the browser maximum). The
 *  database row decides when the session ends. */
const COOKIE_MAX_AGE_SEC = 400 * 24 * 3600;

export async function createSession(userId: string, userAgent: string | null): Promise<string> {
  const { token, hash } = newToken();
  await db.session.create({
    data: { tokenHash: hash, userId, expiresAt: new Date(Date.now() + SESSION_MS), userAgent: userAgent?.slice(0, 300) ?? null },
  });
  return token;
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The session of this request, or null. Ends a session that expired or whose user is disabled. */
export async function readSession(req: Request): Promise<{ user: User; session: Session } | null> {
  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
  if (!token) return null;
  const found = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!found) return null;
  const { user, ...session } = found;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || user.disabledAt) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (now - session.lastSeenAt.getTime() >= TOUCH_MS) {
    session.lastSeenAt = new Date(now);
    session.expiresAt = new Date(now + SESSION_MS);
    await db.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt } });
  }
  return { user, session };
}

export async function endSession(id: string): Promise<void> {
  await db.session.deleteMany({ where: { id } });
}

export async function endUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await db.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}

/** Behind a tunnel the browser uses https, but Next.js sees plain http. */
export function isHttps(req: Request): boolean {
  const fwd = (req.headers.get('x-forwarded-proto') ?? '').split(',')[0].trim();
  return fwd === 'https' || new URL(req.url).protocol === 'https:';
}

export function setSessionCookie(res: NextResponse, token: string, req: Request): void {
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isHttps(req), path: '/', maxAge: COOKIE_MAX_AGE_SEC });
}

export function clearSessionCookie(res: NextResponse, req: Request): void {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: isHttps(req), path: '/', maxAge: 0 });
}
```

Create `src/lib/auth/guard.ts`:

```ts
import { HttpError } from './http';
import { readSession } from './session';

/** The one check that all API routes use. */
export async function requireSession(req: Request) {
  const s = await readSession(req);
  if (!s) throw new HttpError(401, 'Sign in to continue.');
  return s;
}

export async function requireUser(req: Request) {
  return (await requireSession(req)).user;
}

export async function requireAdmin(req: Request) {
  const user = await requireUser(req);
  if (user.role !== 'admin') throw new HttpError(403, 'Only the admin can do this.');
  return user;
}
```

Create `src/lib/auth/users.ts`:

```ts
import type { User } from '@prisma/client';
import { db } from '../db';
import { COUNTRIES } from '../countries';
import { HttpError } from './http';
import { hashPassword, passwordProblem } from './password';
import { endUserSessions } from './session';

export const normEmail = (v: unknown) => String(v ?? '').trim().toLowerCase();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Makes a user with a checked password and the default country list. */
export async function createUser(input: { email: string; name: string; password: string; role?: 'admin' | 'member' }): Promise<User> {
  const email = normEmail(input.email);
  const name = input.name.trim().slice(0, 120);
  if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!name) throw new HttpError(400, 'Enter your name.');
  const problem = passwordProblem(input.password, { email, name });
  if (problem) throw new HttpError(400, problem);
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: input.role ?? 'member',
        countries: { create: COUNTRIES.map((c, i) => ({ cc: c.cc, rank: i, on: true })) },
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'An account with this email already exists.');
    throw e;
  }
}

/** Sets a new password and ends all sessions of the user except `keepSessionId`. */
export async function setPassword(userId: string, password: string, keepSessionId?: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const problem = passwordProblem(password, user);
  if (problem) throw new HttpError(400, problem);
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  await endUserSessions(userId, keepSessionId);
}
```

- [ ] **Step 2: Write the test helper**

Create `tests/helpers/http.ts`:

```ts
import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createUser } from '@/lib/auth/users';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';

export const ORIGIN = 'http://localhost:3117';
export const TEST_PASSWORD = 'violet kettle drums 4417';

/** A new user with a random email and one session. */
export async function makeUser(role: 'admin' | 'member' = 'member') {
  const email = `u-${randomBytes(6).toString('hex')}@test.local`;
  const user = await createUser({ email, name: 'Test User', password: TEST_PASSWORD, role });
  const token = await createSession(user.id, 'vitest');
  return { user, token, cookie: `${SESSION_COOKIE}=${token}` };
}

/** A request as the browser sends it: same Origin and Host, JSON or form body. */
export function request(
  path: string,
  init: { method?: string; cookie?: string; body?: unknown; form?: FormData; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers({ origin: ORIGIN, host: 'localhost:3117', ...init.headers });
  if (init.cookie) headers.set('cookie', init.cookie);
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.body);
  }
  return new NextRequest(new URL(path, ORIGIN), { method: init.method ?? 'GET', headers, body });
}

export const ctx = (params: Record<string, string> = {}) => ({ params });

/** The value of the session cookie that a response sets, or null. */
export function cookieFrom(res: Response): string | null {
  const set = res.headers.get('set-cookie') ?? '';
  const m = set.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return m ? m[1] : null;
}
```

- [ ] **Step 3: Write the failing tests**

Create `tests/auth-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { createSession, endUserSessions, readSession, TOUCH_MS } from '@/lib/auth/session';
import { hashToken } from '@/lib/auth/tokens';
import { makeUser, request } from './helpers/http';

const reqWith = (token: string) => request('/api/state', { cookie: `${SESSION_COOKIE}=${token}` });

describe('sessions', () => {
  it('stores only the hash of the token', async () => {
    const { user, token } = await makeUser();
    const rows = await db.session.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('reads the session from the cookie', async () => {
    const { user, token } = await makeUser();
    const s = await readSession(reqWith(token));
    expect(s?.user.id).toBe(user.id);
    expect(await readSession(reqWith('wrong-token'))).toBeNull();
    expect(await readSession(request('/api/state'))).toBeNull();
  });

  it('ends an expired session', async () => {
    const { token } = await makeUser();
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await readSession(reqWith(token))).toBeNull();
    expect(await db.session.findUnique({ where: { tokenHash: hashToken(token) } })).toBeNull();
  });

  it('ends the session of a disabled user', async () => {
    const { user, token } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    expect(await readSession(reqWith(token))).toBeNull();
  });

  it('moves the expiry forward at most one time each hour', async () => {
    const { token } = await makeUser();
    const where = { tokenHash: hashToken(token) };
    const old = new Date(Date.now() - TOUCH_MS - 1000);
    await db.session.update({ where, data: { lastSeenAt: old, expiresAt: new Date(Date.now() + 1000 * 3600) } });
    await readSession(reqWith(token));
    const touched = await db.session.findUniqueOrThrow({ where });
    expect(touched.lastSeenAt.getTime()).toBeGreaterThan(old.getTime());
    expect(touched.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600_000);
    await readSession(reqWith(token));
    const again = await db.session.findUniqueOrThrow({ where });
    expect(again.lastSeenAt.getTime()).toBe(touched.lastSeenAt.getTime());
  });

  it('ends all other sessions of a user', async () => {
    const { user, token } = await makeUser();
    const second = await createSession(user.id, 'other');
    const keep = await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    await endUserSessions(user.id, keep.id);
    expect(await readSession(reqWith(token))).not.toBeNull();
    expect(await readSession(reqWith(second))).toBeNull();
  });
});
```

Create `tests/api-auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as signout } from '@/app/api/auth/signout/route';
import { GET as state } from '@/app/api/state/route';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { cookieFrom, ctx, makeUser, request, TEST_PASSWORD } from './helpers/http';

const ip = () => `198.51.100.${Math.floor(Math.random() * 250)}-${randomBytes(3).toString('hex')}`;
const tryLogin = (email: string, password: string, from = ip()) =>
  login(request('/api/auth/login', { method: 'POST', body: { email, password }, headers: { 'x-forwarded-for': from } }), ctx());

describe('POST /api/auth/login', () => {
  it('signs in and sets a safe cookie', async () => {
    const { user } = await makeUser();
    const res = await tryLogin(user.email, TEST_PASSWORD);
    expect(res.status).toBe(200);
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain(`${SESSION_COOKIE}=`);
    expect(set.toLowerCase()).toContain('httponly');
    expect(set.toLowerCase()).toContain('samesite=lax');
    expect(set).toContain('Path=/');
    expect(set).not.toContain(user.id);
    const token = cookieFrom(res)!;
    const s = await state(request('/api/state', { cookie: `${SESSION_COOKIE}=${token}` }), ctx());
    expect(s.status).toBe(200);
  });

  it('sets Secure behind an https tunnel', async () => {
    const { user } = await makeUser();
    const res = await login(
      request('/api/auth/login', { method: 'POST', body: { email: user.email, password: TEST_PASSWORD }, headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': ip() } }),
      ctx(),
    );
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('email case: ignores case and spaces in the email', async () => {
    const { user } = await makeUser();
    expect((await tryLogin(`  ${user.email.toUpperCase()} `, TEST_PASSWORD)).status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { user } = await makeUser();
    const a = await tryLogin(user.email, 'wrong password 1234');
    const b = await tryLogin('nobody-here@test.local', 'wrong password 1234');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
  });

  it('disabled user: refuses sign-in, and the open session gets 401', async () => {
    const { user, cookie } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    expect((await tryLogin(user.email, TEST_PASSWORD)).status).toBe(401);
    const s = await state(request('/api/state', { cookie }), ctx());
    expect(s.status).toBe(401);
    expect(await s.json()).toEqual({ error: 'Sign in to continue.' });
  });

  it('allows 10 tries for each email in 15 minutes', async () => {
    const { user } = await makeUser();
    for (let i = 0; i < 10; i++) expect((await tryLogin(user.email, 'wrong password 1234')).status).toBe(401);
    const res = await tryLogin(user.email, TEST_PASSWORD);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Try again in \d+ minute/);
  });

  it('allows 10 tries for each IP address in 15 minutes', async () => {
    const from = ip();
    for (let i = 0; i < 10; i++) await tryLogin(`nobody-${i}@test.local`, 'wrong password 1234', from);
    const { user } = await makeUser();
    expect((await tryLogin(user.email, TEST_PASSWORD, from)).status).toBe(429);
  });

  it('refuses a body that is not JSON', async () => {
    const res = await login(request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' } }), ctx());
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/signout', () => {
  it('ends the session and clears the cookie', async () => {
    const { cookie } = await makeUser();
    const res = await signout(request('/api/auth/signout', { method: 'POST', cookie }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await state(request('/api/state', { cookie }), ctx())).status).toBe(401);
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `npx vitest run tests/auth-session.test.ts tests/api-auth.test.ts`
Expected: FAIL. `tests/auth-session.test.ts` fails on `TOUCH_MS` only if Step 1 is not done; the API test fails with "Cannot find module '@/app/api/auth/login/route'".

- [ ] **Step 5: Write the sign-in and sign-out routes**

Create `src/app/api/auth/login/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { burnPasswordCheck, verifyPassword } from '@/lib/auth/password';
import { clearLimit, clientIp, FIFTEEN_MINUTES, hitLimit } from '@/lib/auth/rate-limit';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { normEmail } from '@/lib/auth/users';

const WRONG = 'The email or password is not correct.';

export const POST = handle(async (req) => {
  const body = await readJson(req);
  const email = normEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  const byIp = await hitLimit(`login:ip:${clientIp(req.headers)}`, 10, FIFTEEN_MINUTES);
  const byEmail = await hitLimit(`login:email:${email}`, 10, FIFTEEN_MINUTES);
  if (!byIp.ok || !byEmail.ok) {
    const mins = Math.max(1, Math.ceil(Math.max(byIp.retryAfterSec, byEmail.retryAfterSec) / 60));
    throw new HttpError(429, `Too many tries. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }

  const user = email ? await db.user.findUnique({ where: { email } }) : null;
  let ok = false;
  if (user?.passwordHash) ok = await verifyPassword(user.passwordHash, password);
  else await burnPasswordCheck(password);
  // A disabled user gets the same answer, so the response does not show the account state.
  if (!user || !ok || user.disabledAt) throw new HttpError(401, WRONG);

  await clearLimit(`login:email:${email}`);
  const token = await createSession(user.id, req.headers.get('user-agent'));
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, token, req);
  return res;
});
```

Replace `src/app/api/auth/signout/route.ts` with:

```ts
import { NextResponse } from 'next/server';
import { handle } from '@/lib/auth/http';
import { clearSessionCookie, endSession, readSession } from '@/lib/auth/session';

export const POST = handle(async (req) => {
  const s = await readSession(req);
  if (s) await endSession(s.session.id);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, req);
  return res;
});
```

- [ ] **Step 6: Remove the old sign-in**

```bash
git rm src/lib/access.ts src/app/api/auth/local/route.ts src/app/api/auth/linkedin/start/route.ts src/app/api/auth/linkedin/callback/route.ts src/components/SignIn.tsx
```

In `src/lib/user.ts`, delete `ensureUser`, `currentUser` and `requireUser`, and remove the imports that only they used (`cookies`, `COUNTRIES`). Keep `profileSummary`.

- [ ] **Step 7: Move every route to `handle` and `requireUser(req)`**

Change these files. In each one: wrap each exported handler as `export const GET = handle(async (req, { params }) => { ... })` (use `handle<{ params: { id: string } }>` where the route has `[id]`), replace `await requireUser()` with `await requireUser(req)` imported from `@/lib/auth/guard`, and rename an unused `_req` parameter to `req`. Keep the logic of each handler as it is, including its own `try`/`catch` blocks.

| File | Handlers |
|---|---|
| `src/app/api/claude/route.ts` | GET |
| `src/app/api/countries/route.ts` | POST |
| `src/app/api/jobs/[id]/route.ts` | GET, PATCH |
| `src/app/api/jobs/[id]/resume/route.ts` | POST |
| `src/app/api/jobs/[id]/resume/refine/route.ts` | POST, DELETE |
| `src/app/api/jobs/refresh/route.ts` | POST |
| `src/app/api/outreach/route.ts` | POST |
| `src/app/api/outreach/[id]/route.ts` | PATCH |
| `src/app/api/profile/import/route.ts` | POST |
| `src/app/api/resume/[id]/route.ts` | GET |
| `src/app/api/state/route.ts` | GET |

Replace `src/app/api/state/route.ts` with:

```ts
import { NextResponse } from 'next/server';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { buildState } from '@/lib/state';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json({ signedIn: true, ...(await buildState(user.id)) });
});
```

In `src/app/api/countries/route.ts`, read the body with `readJson(req)`. Check that `cc` is a string. Use `db.countryPref.updateMany({ where: { userId: user.id, cc }, data: { on: !!on } })` and return `404` (`throw new HttpError(404, 'Not found.')`) when the count is 0. Today an unknown `cc` causes a 500.

In `src/app/api/outreach/[id]/route.ts` and `src/app/api/jobs/[id]/route.ts` PATCH, read the body with `readJson(req)`.

Run: `grep -rn "requireUser()\|from '@/lib/access'\|auth/local\|auth/linkedin" src`
Expected: no output.

- [ ] **Step 8: Write the login page and the client changes**

In `src/components/api.ts`, replace the `api` function with:

```ts
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = Json>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const text = await res.text();
  let data: Json = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) throw new ApiError(data.error || `${res.status} ${res.statusText}`, res.status);
  return data as T;
}
```

Also add `export const put = <T = Json>(url: string, body: unknown) => api<T>(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });` after `patch`.

Create `src/app/login/page.tsx`:

```tsx
import LoginForm from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

/** Only a local path is a safe place to go after sign-in. */
function safeNext(v: unknown): string {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/';
}

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return <LoginForm next={safeNext(searchParams.next)} />;
}
```

Create `src/components/LoginForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { post } from './api';

const input = { width: '100%', background: '#2A3242', borderColor: '#3A4252', color: '#F4F1EA' };

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/login', { email, password });
      window.location.assign(next);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-left">
        <div className="display wordmark" style={{ padding: 0 }}>Waypoint</div>
        <h1 className="display">One warm introduction at a time.</h1>
        <p className="login-lede">Waypoint is for invited users. Ask the admin for an invite link if you do not have an account.</p>
      </div>
      <form className="login-right" onSubmit={submit}>
        <div className="mono" style={{ fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C9C2B3' }}>Sign in</div>
        <label className="stack" style={{ gap: 8 }}>
          <span style={{ fontSize: 15, color: '#C9C2B3' }}>Email</span>
          <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
        </label>
        <label className="stack" style={{ gap: 8 }}>
          <span style={{ fontSize: 15, color: '#C9C2B3' }}>Password</span>
          <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
        </label>
        {error && <p role="alert" style={{ color: '#E7835A', fontSize: 15, margin: 0 }}>{error}</p>}
        <button className="login-cta" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="login-note">Forgot your password? Ask the admin for a reset link.</p>
      </form>
    </div>
  );
}
```

In `src/components/Waypoint.tsx`:
1. Delete the `SignIn` import and the `if (!signedIn) { return <SignIn ... /> }` block, and the `signedIn` constant.
2. Import `ApiError` from `./api`. In the first `useEffect`, change the catch to: `refresh().catch((e) => { if (e instanceof ApiError && e.status === 401) window.location.assign('/login'); else setToast(String(e.message)); });`
3. There is no sign-out button today. Task 11 adds one in Settings.

- [ ] **Step 9: Run the tests and the build**

Run: `npx vitest run tests/auth-session.test.ts tests/api-auth.test.ts`
Expected: PASS, 15 tests.

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

Run: `npx next build`
Expected: the build completes. It checks the types of the route exports. If it reports that a route's second argument type is not valid, give that route's `handle` call the explicit type `handle<{ params: { id: string } }>`.

- [ ] **Step 10: Commit**

```bash
git add -A src tests/helpers tests/auth-session.test.ts tests/api-auth.test.ts
git commit -m "Add database sessions, sign-in and the login page; remove the passcode"
```

---

### Task 5: `npm run user:create-admin`

**Files:**
- Create: `src/lib/auth/admin-setup.ts`, `scripts/create-admin.ts`
- Modify: `package.json` (script), `prisma/seed.ts`
- Test: `tests/admin-setup.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `passwordProblem` (Task 2); `normEmail` (Task 4); `applyMigrations` (Task 1, tests only).
- Produces: `setupAdmin(input: { email: string; name: string; password: string }, client?: PrismaClient): Promise<{ action: 'created' | 'updated'; userId: string }>` and `currentAdmin(client?: PrismaClient): Promise<{ email: string; name: string } | null>`.

`setupAdmin` takes a client, so that its test uses its own database. The shared test database has users from other test files, and "the oldest user" is not fixed there.

- [ ] **Step 1: Write the failing test**

Create `tests/admin-setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { verifyPassword } from '@/lib/auth/password';
import { currentAdmin, setupAdmin } from '@/lib/auth/admin-setup';
import { applyMigrations } from './setup/migrate';

async function withDb(fn: (c: PrismaClient) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'wp-admin-'));
  const c = new PrismaClient({ datasourceUrl: `file:${join(dir, 'a.db')}` });
  try {
    await applyMigrations(c);
    await fn(c);
  } finally {
    await c.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
}

const PW = 'amber lantern forest 9021';

describe('setupAdmin', () => {
  it('makes the first admin in an empty database', async () => {
    await withDb(async (c) => {
      expect(await currentAdmin(c)).toBeNull();
      const r = await setupAdmin({ email: ' Me@Example.com ', name: 'Me', password: PW }, c);
      expect(r.action).toBe('created');
      const u = await c.user.findUniqueOrThrow({ where: { id: r.userId } });
      expect(u).toMatchObject({ email: 'me@example.com', role: 'admin' });
      expect(await verifyPassword(u.passwordHash!, PW)).toBe(true);
      expect(await c.countryPref.count({ where: { userId: u.id } })).toBeGreaterThan(0);
    });
  });

  it('sets the password of the migrated admin and ends its sessions', async () => {
    await withDb(async (c) => {
      const old = await c.user.create({ data: { email: 'you@local', name: 'Your Name', role: 'admin' } });
      await c.session.create({ data: { tokenHash: 'h', userId: old.id, expiresAt: new Date(Date.now() + 1e6) } });
      expect(await currentAdmin(c)).toEqual({ email: 'you@local', name: 'Your Name' });
      const r = await setupAdmin({ email: 'me@example.com', name: 'Me', password: PW }, c);
      expect(r).toEqual({ action: 'updated', userId: old.id });
      const u = await c.user.findUniqueOrThrow({ where: { id: old.id } });
      expect(u.email).toBe('me@example.com');
      expect(await verifyPassword(u.passwordHash!, PW)).toBe(true);
      expect(await c.session.count({ where: { userId: old.id } })).toBe(0);
    });
  });

  it('makes the oldest user the admin when no admin exists', async () => {
    await withDb(async (c) => {
      const a = await c.user.create({ data: { email: 'a@x.test', name: 'A', createdAt: new Date('2024-01-01') } });
      await c.user.create({ data: { email: 'b@x.test', name: 'B', createdAt: new Date('2025-01-01') } });
      const r = await setupAdmin({ email: 'a@x.test', name: 'A', password: PW }, c);
      expect(r).toEqual({ action: 'updated', userId: a.id });
      expect((await c.user.findUniqueOrThrow({ where: { id: a.id } })).role).toBe('admin');
    });
  });

  it('refuses a weak password and a bad email', async () => {
    await withDb(async (c) => {
      await expect(setupAdmin({ email: 'me@example.com', name: 'Me', password: 'short' }, c)).rejects.toThrow(/12 characters/);
      await expect(setupAdmin({ email: 'not-an-email', name: 'Me', password: PW }, c)).rejects.toThrow(/valid email/);
    });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/admin-setup.test.ts`
Expected: FAIL, "Cannot find module '@/lib/auth/admin-setup'".

- [ ] **Step 3: Write the module and the script**

Create `src/lib/auth/admin-setup.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { db } from '../db';
import { COUNTRIES } from '../countries';
import { hashPassword, passwordProblem } from './password';
import { normEmail } from './users';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function currentAdmin(client: PrismaClient = db): Promise<{ email: string; name: string } | null> {
  return client.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { email: true, name: true } });
}

/**
 * Sets up the admin account:
 * - If an admin exists (the migration made the oldest user the admin), set its email, name and password.
 * - Else, if users exist, make the oldest user the admin.
 * - Else, make a new admin.
 * A new password ends all sessions of the admin.
 */
export async function setupAdmin(input: { email: string; name: string; password: string }, client: PrismaClient = db) {
  const email = normEmail(input.email);
  const name = input.name.trim().slice(0, 120);
  if (!EMAIL.test(email)) throw new Error('Enter a valid email address.');
  if (!name) throw new Error('Enter a name.');
  const problem = passwordProblem(input.password, { email, name });
  if (problem) throw new Error(problem);
  const passwordHash = await hashPassword(input.password);

  const target =
    (await client.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } })) ??
    (await client.user.findFirst({ orderBy: { createdAt: 'asc' } }));

  if (target) {
    await client.user.update({ where: { id: target.id }, data: { email, name, passwordHash, role: 'admin', disabledAt: null } });
    await client.session.deleteMany({ where: { userId: target.id } });
    return { action: 'updated' as const, userId: target.id };
  }
  const user = await client.user.create({
    data: { email, name, passwordHash, role: 'admin', countries: { create: COUNTRIES.map((c, i) => ({ cc: c.cc, rank: i, on: true })) } },
  });
  return { action: 'created' as const, userId: user.id };
}
```

Create `scripts/create-admin.ts`:

```ts
import { createInterface } from 'node:readline';
import { currentAdmin, setupAdmin } from '../src/lib/auth/admin-setup';
import { db } from '../src/lib/db';

/**
 * Sets up the admin account. Run it after `prisma migrate deploy`:
 *   npm run user:create-admin
 * It asks for the email, the name and the password. The password does not show.
 */

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
const writer = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
const write = writer._writeToOutput.bind(rl);
writer._writeToOutput = (s: string) => (muted ? process.stdout.write(s.includes('\n') ? '\n' : '') : write(s));

const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

async function askHidden(q: string): Promise<string> {
  process.stdout.write(q);
  muted = true;
  const answer = await ask('');
  muted = false;
  return answer;
}

async function main() {
  const now = await currentAdmin();
  const email = (await ask(`Admin email${now ? ` [${now.email}]` : ''}: `)).trim() || now?.email || '';
  const name = (await ask(`Name${now ? ` [${now.name}]` : ''}: `)).trim() || now?.name || '';
  const password = await askHidden('Password (12 characters or more): ');
  const again = await askHidden('Type the password again: ');
  if (password !== again) throw new Error('The 2 passwords are not the same.');
  const r = await setupAdmin({ email, name, password });
  console.log(r.action === 'created' ? `Made the admin account ${email.trim().toLowerCase()}.` : `Updated the admin account ${email.trim().toLowerCase()}. Its old sessions are ended.`);
}

main()
  .catch((e) => {
    console.error(`Error: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await db.$disconnect();
  });
```

In `package.json` `scripts`, add after `"secret:new"`:

```json
    "user:create-admin": "tsx --env-file=.env scripts/create-admin.ts",
```

In `prisma/seed.ts`, delete the user upsert, the country preference loop and the sample profile block (all code that uses `user.id`). Keep the sample jobs. Change the comment at the top: the seed adds sample jobs only, and `npm run user:create-admin` makes the admin. Run `npm run typecheck` to find code that still refers to the deleted variables.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/admin-setup.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Try the script on this worktree's database copy**

Run: `printf 'admin@test.local\nAdmin\nlinen orchard copper 77\nlinen orchard copper 77\n' | npm run user:create-admin`
Expected: "Updated the admin account admin@test.local. Its old sessions are ended." (The migration made the existing user the admin.) This sets a password on the worktree copy only.

- [ ] **Step 6: Run all checks, then commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add src/lib/auth/admin-setup.ts scripts/create-admin.ts package.json prisma/seed.ts tests/admin-setup.test.ts
git commit -m "Add npm run user:create-admin"
```

---

### Task 6: A Claude credential, a cap and usage rows for each user

**Files:**
- Create: `src/lib/claude/usage.ts`, `src/lib/claude/credential.ts`
- Modify: `src/lib/claude/failures.ts`, `src/lib/claude/types.ts`, `src/lib/claude/index.ts`, `src/lib/claude/api.ts`, `src/lib/claude/cli.ts`, `src/lib/cache.ts`
- Modify (callers): `src/lib/analysis.ts`, `src/lib/queue.ts`, `src/lib/cv.ts`, `src/lib/state.ts`, `src/app/api/outreach/route.ts`, `src/app/api/claude/route.ts`, and the UI code that reads `state.claude.mode`
- Modify (tests): `tests/claude-index.test.ts`, `tests/claude-api.test.ts`, `tests/claude-cli.test.ts`, `tests/cache.test.ts`
- Test: `tests/claude-credential.test.ts`

**Interfaces:**
- Consumes: `readSecret`, `secretHint` (Task 2); `env().WAYPOINT_SHARED_MONTHLY_USD`, `resetEnvForTests` (Task 3); `cliBinary()` (part 1).
- Produces (`usage.ts`): `type UsageSource = 'own' | 'shared' | 'cli'`, `monthStart(now?: Date): Date`, `nextReset(now?: Date): Date`, `recordUsage(userId: string, credential: UsageSource, kind: string, usage: Usage): Promise<void>`, `monthSpend(userId: string, credential?: UsageSource, now?: Date): Promise<number>`, `sharedSpendByUser(now?: Date): Promise<Map<string, number>>`.
- Produces (`credential.ts`): `type ClaudeMode = 'own' | 'shared' | 'cli' | 'none'`, `type ClaudeStatus`, `credentialFor(userId: string): Promise<Credential | null>`, `claudeStatus(userId: string): Promise<ClaudeStatus>`, `failureKey(cred: Credential, userId: string): string`.
- Produces (`types.ts`): `type CallContext = { userId: string; kind: string }`, `class NoCredentialError`.
- Changes: `askJson(req, ctx: CallContext, credential?)`, `askJsonCached(kind, version, req, ctx: CallContext)`, `askApi(key, req, opts: { failureKey: string; client?: Anthropic })`. `detectMode` and `serverCredential` are removed.

- [ ] **Step 1: Write the failing test**

Create `tests/claude-credential.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

vi.mock('@/lib/claude/cli', async (orig) => ({ ...(await orig<typeof import('@/lib/claude/cli')>()), cliBinary: vi.fn(() => '/usr/bin/claude') }));
vi.mock('@/lib/claude/api', () => ({ askApi: vi.fn() }));

import { db } from '@/lib/db';
import { resetEnvForTests } from '@/lib/env';
import { saveSecret } from '@/lib/secrets';
import { askApi } from '@/lib/claude/api';
import { askJson, ClaudeCallError, claudeStatus, credentialFor, NoCredentialError } from '@/lib/claude';
import { monthSpend, monthStart, nextReset, recordUsage } from '@/lib/claude/usage';

const user = (role: 'admin' | 'member' = 'member') =>
  db.user.create({ data: { email: `c-${randomBytes(6).toString('hex')}@test.local`, name: 'C', role } });
const usage = (costUsd: number) => ({ model: 'claude-sonnet-5', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd });

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-shared-key');
  vi.stubEnv('WAYPOINT_SHARED_MONTHLY_USD', '5');
  resetEnvForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  vi.mocked(askApi).mockReset();
});

describe('credentialFor', () => {
  it('uses the own key first', async () => {
    const u = await user();
    await saveSecret(u.id, 'anthropic', 'sk-ant-own-key-1234');
    expect(await credentialFor(u.id)).toEqual({ kind: 'api', key: 'sk-ant-own-key-1234', source: 'own' });
  });

  it('uses the shared key under the cap', async () => {
    const u = await user();
    await recordUsage(u.id, 'shared', 'analysis', usage(4.99));
    expect(await credentialFor(u.id)).toEqual({ kind: 'api', key: 'sk-ant-shared-key', source: 'shared' });
  });

  it('member over the cap: no credential, never the CLI', async () => {
    const u = await user('member');
    await recordUsage(u.id, 'shared', 'analysis', usage(5));
    expect(await credentialFor(u.id)).toBeNull();
    const s = await claudeStatus(u.id);
    expect(s.mode).toBe('none');
    expect(s.capReached).toBe(true);
    expect(s.detail).toMatch(/limit/);
  });

  it('admin over the cap: the CLI', async () => {
    const u = await user('admin');
    await recordUsage(u.id, 'shared', 'analysis', usage(6));
    expect(await credentialFor(u.id)).toEqual({ kind: 'cli' });
  });

  it('without a shared key: member none, admin CLI', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    resetEnvForTests();
    expect(await credentialFor((await user('member')).id)).toBeNull();
    expect(await credentialFor((await user('admin')).id)).toEqual({ kind: 'cli' });
  });

  it('does not count the spend of last month or of other users', async () => {
    const u = await user();
    const other = await user();
    await db.llmUsage.create({
      data: { userId: u.id, credential: 'shared', model: 'm', kind: 'k', inputTokens: 1, outputTokens: 1, costUsd: 50, createdAt: new Date(monthStart().getTime() - 1000) },
    });
    await recordUsage(other.id, 'shared', 'analysis', usage(50));
    expect(await monthSpend(u.id, 'shared')).toBe(0);
    expect((await credentialFor(u.id))?.kind).toBe('api');
  });

  it('gives no credential to a disabled user', async () => {
    const u = await user('admin');
    await db.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
    expect(await credentialFor(u.id)).toBeNull();
  });

  it('resets on the first day of the next month (UTC)', () => {
    expect(nextReset(new Date('2026-10-16T12:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(monthStart(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('askJson', () => {
  const req = { system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }), effort: 'low' as const };

  it('writes one usage row with the credential and the kind', async () => {
    const u = await user();
    vi.mocked(askApi).mockResolvedValue({ data: { ok: true }, raw: '{"ok":true}', usage: usage(0.01) });
    await askJson(req, { userId: u.id, kind: 'analysis' });
    const rows = await db.llmUsage.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ credential: 'shared', kind: 'analysis', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    expect(vi.mocked(askApi).mock.calls[0][2]).toMatchObject({ failureKey: 'shared' });
  });

  it('writes a usage row for a failed call that used tokens', async () => {
    const u = await user();
    vi.mocked(askApi).mockRejectedValue(new ClaudeCallError('bad', usage(0.02)));
    await expect(askJson(req, { userId: u.id, kind: 'reply' })).rejects.toThrow('bad');
    expect(await monthSpend(u.id, 'shared')).toBeCloseTo(0.02);
  });

  it('throws NoCredentialError without a credential', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    resetEnvForTests();
    const u = await user('member');
    await expect(askJson(req, { userId: u.id, kind: 'analysis' })).rejects.toBeInstanceOf(NoCredentialError);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/claude-credential.test.ts`
Expected: FAIL, "Cannot find module '@/lib/claude/usage'".

- [ ] **Step 3: Write the usage module**

Create `src/lib/claude/usage.ts`:

```ts
import { db } from '../db';
import type { Usage } from './types';

export type UsageSource = 'own' | 'shared' | 'cli';

/** Months are UTC months, so the reset date is the same for all users. */
export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const nextReset = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

export async function recordUsage(userId: string, credential: UsageSource, kind: string, usage: Usage): Promise<void> {
  await db.llmUsage.create({
    data: {
      userId,
      credential,
      kind,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      costUsd: usage.costUsd,
    },
  });
}

/** The cost in USD of the user's calls this month, for one credential or for all. */
export async function monthSpend(userId: string, credential?: UsageSource, now = new Date()): Promise<number> {
  const r = await db.llmUsage.aggregate({
    where: { userId, createdAt: { gte: monthStart(now) }, ...(credential ? { credential } : {}) },
    _sum: { costUsd: true },
  });
  return r._sum.costUsd ?? 0;
}

/** The shared-key cost of each user this month, for the admin list. */
export async function sharedSpendByUser(now = new Date()): Promise<Map<string, number>> {
  const rows = await db.llmUsage.groupBy({
    by: ['userId'],
    where: { credential: 'shared', createdAt: { gte: monthStart(now) } },
    _sum: { costUsd: true },
  });
  return new Map(rows.map((r) => [r.userId, r._sum.costUsd ?? 0]));
}
```

- [ ] **Step 4: Make the failure banners per credential**

Replace `src/lib/claude/failures.ts` with:

```ts
/**
 * The last auth and quota failure of each credential, for the banners in the
 * UI. The key is "cli", "shared" or "own:<userId>", so a bad own key of one
 * user does not show a banner to the others. A version check passes even
 * after `claude login` expires, so a failure shows only when a call runs.
 * The flag stays until a call with that credential succeeds or the user
 * presses "recheck".
 */
type Failure = { message: string; at: number };

const auth = new Map<string, Failure>();
const quota = new Map<string, Failure>();

export const claudeAuthFailure = (key: string) => auth.get(key) ?? null;
export const claudeQuotaFailure = (key: string) => quota.get(key) ?? null;
export const setAuthFailure = (key: string, message: string) => { auth.set(key, { message, at: Date.now() }); };
export const setQuotaFailure = (key: string, message: string) => { quota.set(key, { message, at: Date.now() }); };
export const clearFailures = (key: string) => { auth.delete(key); quota.delete(key); };
```

In `src/lib/claude/cli.ts`, change each `setAuthFailure(x)` to `setAuthFailure('cli', x)`, each `setQuotaFailure(x)` to `setQuotaFailure('cli', x)` and each `clearFailures()` to `clearFailures('cli')`.

In `src/lib/claude/api.ts`:
1. Change the signature to `export async function askApi<T>(key: string, req: AskRequest<T>, opts: { failureKey: string; client?: Anthropic }): Promise<AskResult<T>>`. Use `opts.client` where the code used `client`.
2. Pass `opts.failureKey` as the first argument of each `setAuthFailure`, `setQuotaFailure` and `clearFailures` call.
3. Key the client `Map` on the SHA-256 hash of the API key, not on the key (part 1 deferred this): `const id = createHash('sha256').update(key).digest('hex');` with `import { createHash } from 'node:crypto';`.

- [ ] **Step 5: Write the credential module**

In `src/lib/claude/types.ts`, add:

```ts
/** Who the call is for and what it is. `kind` goes to LlmUsage (analysis, referral, note, reply, refine, ...). */
export type CallContext = { userId: string; kind: string };

export class NoCredentialError extends Error {
  constructor() {
    super('Add an API key in Settings to use Claude.');
  }
}
```

Create `src/lib/claude/credential.ts`:

```ts
import { db } from '../db';
import { env } from '../env';
import { readSecret, secretHint } from '../secrets';
import { cliBinary } from './cli';
import { claudeAuthFailure, claudeQuotaFailure } from './failures';
import type { Credential } from './types';
import { monthSpend, nextReset } from './usage';

/**
 * Which account pays for a call (spec 2.8):
 * 1. the user's own API key,
 * 2. ANTHROPIC_API_KEY, while the user's cost on it this month is below
 *    WAYPOINT_SHARED_MONTHLY_USD,
 * 3. the claude CLI with the admin's Pro subscription, for the admin only.
 *    A Pro subscription is for one person, so a member never uses it.
 */

export type ClaudeMode = 'own' | 'shared' | 'cli' | 'none';

export type ClaudeStatus = {
  mode: ClaudeMode;
  detail: string;
  keyHint: string | null;
  sharedAvailable: boolean;
  capUsd: number;
  sharedSpentUsd: number;
  capReached: boolean;
  resetsAt: string;
  authFailure: { message: string; at: number } | null;
  quotaFailure: { message: string; at: number } | null;
};

export async function credentialFor(userId: string): Promise<Credential | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, disabledAt: true } });
  if (!user || user.disabledAt) return null;
  const own = await readSecret(userId, 'anthropic');
  if (own) return { kind: 'api', key: own, source: 'own' };
  const shared = env().ANTHROPIC_API_KEY;
  if (shared && (await monthSpend(userId, 'shared')) < env().WAYPOINT_SHARED_MONTHLY_USD) return { kind: 'api', key: shared, source: 'shared' };
  if (user.role === 'admin' && cliBinary()) return { kind: 'cli' };
  return null;
}

export const failureKey = (cred: Credential, userId: string) => (cred.kind === 'cli' ? 'cli' : cred.source === 'shared' ? 'shared' : `own:${userId}`);

const usd = (n: number) => `$${n.toFixed(2)}`;
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

export async function claudeStatus(userId: string): Promise<ClaudeStatus> {
  const capUsd = env().WAYPOINT_SHARED_MONTHLY_USD;
  const sharedAvailable = !!env().ANTHROPIC_API_KEY;
  const [sharedSpentUsd, keyHint, cred] = await Promise.all([monthSpend(userId, 'shared'), secretHint(userId, 'anthropic'), credentialFor(userId)]);
  const reset = nextReset();
  const capReached = sharedAvailable && sharedSpentUsd >= capUsd;
  const base = { keyHint, sharedAvailable, capUsd, sharedSpentUsd, capReached, resetsAt: reset.toISOString() };

  if (!cred) {
    const detail = capReached
      ? `You used this month's limit of ${usd(capUsd)} on the shared key. It resets on ${day(reset)}. Add your own API key in Settings to continue now.`
      : 'Add an API key in Settings to use Claude.';
    return { ...base, mode: 'none', detail, authFailure: null, quotaFailure: null };
  }

  const key = failureKey(cred, userId);
  const failures = { authFailure: claudeAuthFailure(key), quotaFailure: claudeQuotaFailure(key) };
  if (cred.kind === 'cli') return { ...base, ...failures, mode: 'cli', detail: 'Claude Code CLI · the admin subscription' };
  if (cred.source === 'own') return { ...base, ...failures, mode: 'own', detail: `Your API key (ends in ${keyHint ?? '????'})` };
  return { ...base, ...failures, mode: 'shared', detail: `The shared API key · ${usd(sharedSpentUsd)} of ${usd(capUsd)} used this month` };
}
```

- [ ] **Step 6: Change `askJson` and `askJsonCached`**

In `src/lib/claude/index.ts`:
1. Delete `ClaudeMode`, `cachedMode`, `serverCredential` and `detectMode`.
2. Change the exports: remove `clearClaudeAuthFailure` and `clearClaudeQuotaFailure`; add `clearFailures`, and these lines:

```ts
export { NoCredentialError } from './types';
export type { CallContext } from './types';
export { credentialFor, claudeStatus, failureKey } from './credential';
export type { ClaudeMode, ClaudeStatus } from './credential';
```

3. Replace the start of `askJson` (up to the CLI part) with:

```ts
export async function askJson<T>(req: AskRequest<T>, ctx: CallContext, credential?: Credential | null): Promise<AskResult<T>> {
  const cred = credential === undefined ? await credentialFor(ctx.userId) : credential;
  if (!cred) throw new NoCredentialError();
  const source = cred.kind === 'cli' ? 'cli' : cred.source;
  let usage: Usage | undefined;
  try {
    const result = cred.kind === 'api' ? await askApi(cred.key, req, { failureKey: failureKey(cred, ctx.userId) }) : await askCliJson(req);
    usage = result.usage;
    return result;
  } catch (e) {
    usage = (e as { usage?: Usage }).usage;
    throw e;
  } finally {
    // A failed write of the usage row must not hide the reply or the error.
    if (usage) await recordUsage(ctx.userId, source, ctx.kind, usage).catch((err) => console.error('[claude] could not record usage:', (err as Error).message));
  }
}
```

4. Move the existing CLI part (the first `askCli` call, `tryParse`, the repair and `addUsage`) into a new function `async function askCliJson<T>(req: AskRequest<T>): Promise<AskResult<T>>` with no other change. Import `credentialFor` and `failureKey` from `./credential`, `recordUsage` from `./usage`, and `NoCredentialError`, `CallContext` from `./types`.
5. Change the comment at the top of the file: the credential is per user now (see `credential.ts`), and each call writes one `LlmUsage` row.

In `src/lib/cache.ts`, change `askJsonCached` to `askJsonCached<T>(kind: CacheKind, version: string, req: AskRequest<T>, ctx: CallContext): Promise<T>` and pass `ctx` to `askJson(req, ctx)`. A cache hit writes no usage row.

- [ ] **Step 7: Change the callers**

Make these exact changes:

| File | Change |
|---|---|
| `src/lib/analysis.ts` `analyseJob` | Replace `const { mode } = await detectMode(); if (mode === 'none') {` with `if (!(await credentialFor(userId))) {`. Pass `{ userId, kind: 'analysis' }` as the 4th argument of `askJsonCached`. |
| `src/lib/queue.ts` `queueAnalysis` | Replace the `detectMode()` line with `if (!(await credentialFor(userId))) return analysisProgress(userId);` |
| `src/lib/cv.ts` `refineCv` | Replace `const { mode, detail } = await detectMode();` with `const { mode, detail } = await claudeStatus(app.userId);`. Pass `{ userId: app.userId, kind: 'refine' }` as the 2nd argument of `askJson`. |
| `src/app/api/outreach/route.ts` | In `draftReferral`: `const cred = await credentialFor(app.userId);`, `mode === 'none'` → `!cred`, and pass `{ userId: app.userId, kind: 'referral' }` to `askJsonCached`. In the `alumni` action: the same with `user.id` and kind `'note'`. In the `replied` action: the same with `user.id`, and pass `{ userId: user.id, kind: 'reply' }` to `askJson`. |
| `src/lib/state.ts` | Replace `detectMode()` in the `Promise.all` with `claudeStatus(userId)`. Replace `claude: { ...claude, authFailure: claudeAuthFailure(), quotaFailure: claudeQuotaFailure() }` with `claude`. |
| `src/app/api/claude/route.ts` | After `requireUser(req)`: `const cred = await credentialFor(user.id); if (cred) clearFailures(failureKey(cred, user.id)); return NextResponse.json(await claudeStatus(user.id));` |

Then run `grep -rn "claude.mode\|claude?.mode\|'api'" src/components`. The mode `'api'` does not exist now. Where the UI tests `mode === 'api'`, use `mode === 'own' || mode === 'shared'`. Where it shows the "Claude is not connected" text for `'none'`, show `claude.detail` in its place.

- [ ] **Step 8: Fix the part 1 tests**

Update `tests/claude-index.test.ts`, `tests/claude-api.test.ts`, `tests/claude-cli.test.ts` and `tests/cache.test.ts` to the new signatures:
- `askApi(key, req, client)` → `askApi(key, req, { failureKey: 'shared', client })`.
- Failure getters take a key: `claudeAuthFailure()` → `claudeAuthFailure('shared')` for API tests and `claudeAuthFailure('cli')` for CLI tests.
- `askJson(req, credential)` → `askJson(req, { userId: <a user id>, kind: 'test' }, credential)`. Make the user with `db.user.create` and a random email, because `recordUsage` needs a real user row.
- `askJsonCached(kind, v, req)` → `askJsonCached(kind, v, req, { userId, kind: 'test' })`.
- Delete the tests of `detectMode` and `serverCredential`. `tests/claude-credential.test.ts` covers the credential order now.

Do the same in `tests/live/claude-cli.live.test.ts` and `tests/live/claude-api.live.test.ts`.

- [ ] **Step 9: Run all checks, then commit**

Run: `npx vitest run tests/claude-credential.test.ts`
Expected: PASS, 11 tests.

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

```bash
git add -A src tests
git commit -m "Pick the Claude credential for each user, with a monthly cap and usage rows"
```

---

### Task 7: Invites, reset links and the user admin

**Files:**
- Create: `src/lib/auth/invites.ts`
- Create: `src/app/api/invites/[token]/route.ts`
- Create: `src/app/api/admin/invites/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[id]/route.ts`, `src/app/api/admin/users/[id]/reset/route.ts`
- Test: `tests/api-invites.test.ts`, `tests/api-admin.test.ts`

**Interfaces:**
- Consumes: `newToken`, `hashToken` (Task 2); `HttpError`, `handle`, `readJson`, `hitLimit`, `clientIp`, `FIFTEEN_MINUTES`, `publicBase` (Task 3); `createSession`, `setSessionCookie`, `endUserSessions`, `requireAdmin`, `createUser`, `setPassword`, `normEmail` (Task 4); `sharedSpendByUser` (Task 6).
- Produces (`invites.ts`): `INVITE_MS = 7 days`, `type TokenInfo = { kind: 'invite' | 'reset'; email: string | null; name: string | null }`, `createInvite(adminId: string, email?: string | null): Promise<string>`, `createReset(adminId: string, userId: string): Promise<string>`, `inspectToken(token: string): Promise<TokenInfo | null>`, `redeemInvite(token: string, input: { email?: unknown; name: unknown; password: unknown }): Promise<User>`, `redeemReset(token: string, password: unknown): Promise<User>`.
- Produces (routes): `GET /api/invites/[token]` → `TokenInfo`; `POST /api/invites/[token]` `{ name?, email?, password }` → `{ ok: true }` and a session cookie; `POST /api/admin/invites` `{ email? }` → `{ url, expiresAt }`; `GET /api/admin/users` → `{ users: AdminUserRow[] }`; `PATCH /api/admin/users/[id]` `{ disabled: boolean }` → `{ ok: true }`; `POST /api/admin/users/[id]/reset` → `{ url, expiresAt }`.
- `AdminUserRow = { id, email, name, role, disabled: boolean, createdAt: string, lastSeenAt: string | null, sharedSpentUsd: number }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api-invites.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { createInvite, createReset } from '@/lib/auth/invites';
import { hashToken } from '@/lib/auth/tokens';
import { GET as inspect, POST as redeem } from '@/app/api/invites/[token]/route';
import { POST as login } from '@/app/api/auth/login/route';
import { GET as state } from '@/app/api/state/route';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { cookieFrom, ctx, makeUser, request, TEST_PASSWORD } from './helpers/http';

const NEW_PW = 'quiet harbour lights 5150';
const mail = () => `n-${randomBytes(6).toString('hex')}@test.local`;
const ip = () => `192.0.2.${randomBytes(2).toString('hex')}`;
const get = (token: string, from = ip()) => inspect(request(`/api/invites/${token}`, { headers: { 'x-forwarded-for': from } }), ctx({ token }));
const post = (token: string, body: unknown, from = ip()) =>
  redeem(request(`/api/invites/${token}`, { method: 'POST', body, headers: { 'x-forwarded-for': from } }), ctx({ token }));

describe('invites', () => {
  it('stores only the hash and expires in 7 days', async () => {
    const { user: admin } = await makeUser('admin');
    const token = await createInvite(admin.id, null);
    const row = await db.invite.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(row.kind).toBe('invite');
    const days = (row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
  });

  it('makes an account, signs it in, and works one time', async () => {
    const { user: admin } = await makeUser('admin');
    const token = await createInvite(admin.id, null);
    expect(await (await get(token)).json()).toEqual({ kind: 'invite', email: null, name: null });
    const email = mail();
    const res = await post(token, { name: 'New Person', email, password: NEW_PW });
    expect(res.status).toBe(200);
    const cookie = `${SESSION_COOKIE}=${cookieFrom(res)}`;
    const s = await (await state(request('/api/state', { cookie }), ctx())).json();
    expect(s.user.email).toBe(email);
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    expect(u.role).toBe('member');
    expect((await get(token)).status).toBe(404);
    expect((await post(token, { name: 'X', email: mail(), password: NEW_PW })).status).toBe(404);
  });

  it('uses the email fixed in the invite', async () => {
    const { user: admin } = await makeUser('admin');
    const email = mail();
    const token = await createInvite(admin.id, email);
    expect((await (await get(token)).json()).email).toBe(email);
    await post(token, { name: 'Fixed', email: 'other@test.local', password: NEW_PW });
    expect(await db.user.findUnique({ where: { email } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { email: 'other@test.local' } })).toBeNull();
  });

  it('keeps the link after a weak password, so the user can try again', async () => {
    const { user: admin } = await makeUser('admin');
    const token = await createInvite(admin.id, null);
    const bad = await post(token, { name: 'W', email: mail(), password: 'short' });
    expect(bad.status).toBe(400);
    expect((await get(token)).status).toBe(200);
  });

  it('one invite makes one account', async () => {
    const { user: admin } = await makeUser('admin');
    const token = await createInvite(admin.id, null);
    const [a, b] = await Promise.all([
      post(token, { name: 'A', email: mail(), password: NEW_PW }),
      post(token, { name: 'B', email: mail(), password: NEW_PW }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
  });

  it('refuses an expired invite', async () => {
    const { user: admin } = await makeUser('admin');
    const token = await createInvite(admin.id, null);
    await db.invite.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await get(token)).status).toBe(404);
  });

  it('existing email in another case: refuses the invite', async () => {
    const { user: admin } = await makeUser('admin');
    const { user } = await makeUser();
    await expect(createInvite(admin.id, user.email.toUpperCase())).rejects.toMatchObject({ status: 409 });
    const token = await createInvite(admin.id, null);
    expect((await post(token, { name: 'Dup', email: ` ${user.email.toUpperCase()} `, password: NEW_PW })).status).toBe(409);
  });

  it('allows 20 tries for each IP address in 15 minutes', async () => {
    const from = ip();
    for (let i = 0; i < 20; i++) await get(`no-such-token-${i}`, from);
    expect((await get('no-such-token-x', from)).status).toBe(429);
  });
});

describe('reset links', () => {
  it('sets the password, ends old sessions and signs in', async () => {
    const { user: admin } = await makeUser('admin');
    const { user, cookie: oldCookie } = await makeUser();
    const token = await createReset(admin.id, user.id);
    expect(await (await get(token)).json()).toEqual({ kind: 'reset', email: user.email, name: user.name });
    const res = await post(token, { password: NEW_PW });
    expect(res.status).toBe(200);
    expect((await state(request('/api/state', { cookie: oldCookie }), ctx())).status).toBe(401);
    const ok = await login(request('/api/auth/login', { method: 'POST', body: { email: user.email, password: NEW_PW }, headers: { 'x-forwarded-for': ip() } }), ctx());
    expect(ok.status).toBe(200);
    const old = await login(request('/api/auth/login', { method: 'POST', body: { email: user.email, password: TEST_PASSWORD }, headers: { 'x-forwarded-for': ip() } }), ctx());
    expect(old.status).toBe(401);
  });

  it('a new reset link ends the older one', async () => {
    const { user: admin } = await makeUser('admin');
    const { user } = await makeUser();
    const first = await createReset(admin.id, user.id);
    const second = await createReset(admin.id, user.id);
    expect((await post(second, { password: NEW_PW })).status).toBe(200);
    expect((await get(first)).status).toBe(404);
  });
});
```

Create `tests/api-admin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { POST as invite } from '@/app/api/admin/invites/route';
import { GET as users } from '@/app/api/admin/users/route';
import { PATCH as patchUser } from '@/app/api/admin/users/[id]/route';
import { POST as reset } from '@/app/api/admin/users/[id]/reset/route';
import { GET as state } from '@/app/api/state/route';
import { recordUsage } from '@/lib/claude/usage';
import { ctx, makeUser, request } from './helpers/http';

describe('admin routes', () => {
  it('refuse a member with 403 and a signed-out request with 401', async () => {
    const { cookie } = await makeUser('member');
    expect((await invite(request('/api/admin/invites', { method: 'POST', cookie, body: {} }), ctx())).status).toBe(403);
    expect((await users(request('/api/admin/users', { cookie }), ctx())).status).toBe(403);
    expect((await users(request('/api/admin/users'), ctx())).status).toBe(401);
  });

  it('make an invite link with the public base URL', async () => {
    const { cookie } = await makeUser('admin');
    const res = await invite(request('/api/admin/invites', { method: 'POST', cookie, body: {} }), ctx());
    const body = await res.json();
    expect(body.url).toMatch(/^http:\/\/localhost:3117\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('list users with their shared-key cost this month, and no secrets', async () => {
    const { cookie } = await makeUser('admin');
    const { user } = await makeUser('member');
    await recordUsage(user.id, 'shared', 'analysis', { model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 1.25 });
    const body = await (await users(request('/api/admin/users', { cookie }), ctx())).json();
    const row = body.users.find((u: { id: string }) => u.id === user.id);
    expect(row).toMatchObject({ email: user.email, role: 'member', disabled: false, sharedSpentUsd: 1.25 });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    expect(JSON.stringify(body)).not.toContain('$argon2');
  });

  it('disable a user, which ends the sessions at once; enable again', async () => {
    const { cookie } = await makeUser('admin');
    const { user, cookie: memberCookie } = await makeUser('member');
    const off = await patchUser(request(`/api/admin/users/${user.id}`, { method: 'PATCH', cookie, body: { disabled: true } }), ctx({ id: user.id }));
    expect(off.status).toBe(200);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await state(request('/api/state', { cookie: memberCookie }), ctx())).status).toBe(401);
    await patchUser(request(`/api/admin/users/${user.id}`, { method: 'PATCH', cookie, body: { disabled: false } }), ctx({ id: user.id }));
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).disabledAt).toBeNull();
  });

  it('do not disable an admin, and give 404 for an unknown user', async () => {
    const { user: admin, cookie } = await makeUser('admin');
    expect((await patchUser(request(`/api/admin/users/${admin.id}`, { method: 'PATCH', cookie, body: { disabled: true } }), ctx({ id: admin.id }))).status).toBe(400);
    expect((await patchUser(request('/api/admin/users/nope', { method: 'PATCH', cookie, body: { disabled: true } }), ctx({ id: 'nope' }))).status).toBe(404);
  });

  it('make a reset link', async () => {
    const { cookie } = await makeUser('admin');
    const { user } = await makeUser('member');
    const body = await (await reset(request(`/api/admin/users/${user.id}/reset`, { method: 'POST', cookie }), ctx({ id: user.id }))).json();
    expect(body.url).toMatch(/\/reset\/[A-Za-z0-9_-]{43}$/);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/api-invites.test.ts tests/api-admin.test.ts`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write the invites module**

Create `src/lib/auth/invites.ts`:

```ts
import type { Invite, User } from '@prisma/client';
import { db } from '../db';
import { HttpError } from './http';
import { hashToken, newToken } from './tokens';
import { createUser, normEmail, setPassword } from './users';

export const INVITE_MS = 7 * 24 * 3600_000;

const GONE = 'This link is not valid. It expired or was used. Ask the admin for a new link.';

export type TokenInfo = { kind: 'invite' | 'reset'; email: string | null; name: string | null };

async function live(token: string): Promise<(Invite & { user: User | null }) | null> {
  if (!token || token.length > 100) return null;
  const row = await db.invite.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  if (row.kind === 'reset' && !row.user) return null;
  return row;
}

export async function createInvite(adminId: string, email?: string | null): Promise<string> {
  const fixed = email ? normEmail(email) : null;
  if (fixed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fixed)) throw new HttpError(400, 'Enter a valid email address.');
  if (fixed && (await db.user.findUnique({ where: { email: fixed } }))) throw new HttpError(409, 'An account with this email already exists.');
  const { token, hash } = newToken();
  await db.invite.create({ data: { tokenHash: hash, kind: 'invite', email: fixed, createdById: adminId, expiresAt: new Date(Date.now() + INVITE_MS) } });
  return token;
}

export async function createReset(adminId: string, userId: string): Promise<string> {
  await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { token, hash } = newToken();
  await db.invite.create({ data: { tokenHash: hash, kind: 'reset', userId, createdById: adminId, expiresAt: new Date(Date.now() + INVITE_MS) } });
  return token;
}

export async function inspectToken(token: string): Promise<TokenInfo | null> {
  const row = await live(token);
  if (!row) return null;
  return row.kind === 'reset'
    ? { kind: 'reset', email: row.user!.email, name: row.user!.name }
    : { kind: 'invite', email: row.email, name: null };
}

/** Marks the link as used. Only one of 2 requests at the same time gets true. */
async function claim(id: string): Promise<boolean> {
  const r = await db.invite.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
  return r.count === 1;
}

const release = (id: string) => db.invite.update({ where: { id }, data: { usedAt: null } });

export async function redeemInvite(token: string, input: { email?: unknown; name: unknown; password: unknown }): Promise<User> {
  const row = await live(token);
  if (!row || row.kind !== 'invite' || !(await claim(row.id))) throw new HttpError(404, GONE);
  try {
    return await createUser({ email: row.email ?? normEmail(input.email), name: String(input.name ?? ''), password: String(input.password ?? '') });
  } catch (e) {
    // A weak password or a used email: give the link back, so the user can try again.
    await release(row.id);
    throw e;
  }
}

export async function redeemReset(token: string, password: unknown): Promise<User> {
  const row = await live(token);
  if (!row || row.kind !== 'reset' || !(await claim(row.id))) throw new HttpError(404, GONE);
  try {
    await setPassword(row.userId!, String(password ?? ''));
  } catch (e) {
    await release(row.id);
    throw e;
  }
  await db.invite.updateMany({ where: { userId: row.userId, kind: 'reset', usedAt: null }, data: { usedAt: new Date() } });
  return db.user.findUniqueOrThrow({ where: { id: row.userId! } });
}
```

- [ ] **Step 4: Write the routes**

Create `src/app/api/invites/[token]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { inspectToken, redeemInvite, redeemReset } from '@/lib/auth/invites';
import { clientIp, FIFTEEN_MINUTES, hitLimit } from '@/lib/auth/rate-limit';
import { createSession, setSessionCookie } from '@/lib/auth/session';

type Ctx = { params: { token: string } };

/** 20 tries in 15 minutes for each IP address, for the GET and the POST together. */
async function limit(req: Request) {
  const r = await hitLimit(`token:ip:${clientIp(req.headers)}`, 20, FIFTEEN_MINUTES);
  if (!r.ok) throw new HttpError(429, `Too many tries. Try again in ${Math.max(1, Math.ceil(r.retryAfterSec / 60))} minutes.`);
}

const GONE = 'This link is not valid. It expired or was used. Ask the admin for a new link.';

export const GET = handle<Ctx>(async (req, { params }) => {
  await limit(req);
  const info = await inspectToken(params.token);
  if (!info) throw new HttpError(404, GONE);
  return NextResponse.json(info);
});

export const POST = handle<Ctx>(async (req, { params }) => {
  await limit(req);
  const body = await readJson(req);
  const info = await inspectToken(params.token);
  if (!info) throw new HttpError(404, GONE);
  const user = info.kind === 'invite' ? await redeemInvite(params.token, body as { email?: unknown; name: unknown; password: unknown }) : await redeemReset(params.token, body.password);
  const token = await createSession(user.id, req.headers.get('user-agent'));
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, token, req);
  return res;
});
```

Create `src/app/api/admin/invites/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { handle, readJson } from '@/lib/auth/http';
import { createInvite, INVITE_MS } from '@/lib/auth/invites';
import { publicBase } from '@/lib/auth/origin';

export const POST = handle(async (req) => {
  const admin = await requireAdmin(req);
  const body = await readJson(req);
  const email = typeof body.email === 'string' && body.email.trim() ? body.email : null;
  const token = await createInvite(admin.id, email);
  return NextResponse.json({ url: `${publicBase(req)}/invite/${token}`, expiresAt: new Date(Date.now() + INVITE_MS).toISOString() });
});
```

Create `src/app/api/admin/users/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { handle } from '@/lib/auth/http';
import { sharedSpendByUser } from '@/lib/claude/usage';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireAdmin(req);
  const [rows, spend] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, role: true, disabledAt: true, createdAt: true, sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: 'desc' }, take: 1 } },
    }),
    sharedSpendByUser(),
  ]);
  const users = rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    disabled: !!u.disabledAt,
    createdAt: u.createdAt.toISOString(),
    lastSeenAt: u.sessions[0]?.lastSeenAt.toISOString() ?? null,
    sharedSpentUsd: spend.get(u.id) ?? 0,
  }));
  return NextResponse.json({ users });
});
```

Create `src/app/api/admin/users/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { endUserSessions } from '@/lib/auth/session';

export const PATCH = handle<{ params: { id: string } }>(async (req, { params }) => {
  await requireAdmin(req);
  const body = await readJson(req);
  if (typeof body.disabled !== 'boolean') throw new HttpError(400, 'Send { "disabled": true } or { "disabled": false }.');
  const target = await db.user.findUnique({ where: { id: params.id } });
  if (!target) throw new HttpError(404, 'Not found.');
  if (target.role === 'admin') throw new HttpError(400, 'You cannot disable an admin account.');
  await db.user.update({ where: { id: target.id }, data: { disabledAt: body.disabled ? new Date() : null } });
  if (body.disabled) await endUserSessions(target.id);
  return NextResponse.json({ ok: true });
});
```

Create `src/app/api/admin/users/[id]/reset/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { handle, HttpError } from '@/lib/auth/http';
import { createReset, INVITE_MS } from '@/lib/auth/invites';
import { publicBase } from '@/lib/auth/origin';

export const POST = handle<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireAdmin(req);
  if (!(await db.user.findUnique({ where: { id: params.id } }))) throw new HttpError(404, 'Not found.');
  const token = await createReset(admin.id, params.id);
  return NextResponse.json({ url: `${publicBase(req)}/reset/${token}`, expiresAt: new Date(Date.now() + INVITE_MS).toISOString() });
});
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/api-invites.test.ts tests/api-admin.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Run all checks, then commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add src/lib/auth/invites.ts src/app/api/invites src/app/api/admin tests/api-invites.test.ts tests/api-admin.test.ts
git commit -m "Add invite links, reset links and the user admin routes"
```

---

### Task 8: Account routes: password, sessions and own Claude key

**Files:**
- Create: `src/app/api/account/password/route.ts`, `src/app/api/account/sessions/route.ts`, `src/app/api/account/sessions/[id]/route.ts`, `src/app/api/account/claude/route.ts`
- Test: `tests/api-account.test.ts`

**Interfaces:**
- Consumes: `requireSession`, `requireUser`, `setPassword`, `verifyPassword`, `endSession`, `endUserSessions`, `clearSessionCookie`, `hitLimit`, `FIFTEEN_MINUTES` (Tasks 2–4); `saveSecret`, `deleteSecret` (Task 2); `claudeStatus`, `clearFailures` (Task 6).
- Produces: `POST /api/account/password` `{ current, next }` → `{ ok: true }`; `GET /api/account/sessions` → `{ sessions: { id, current, userAgent, createdAt, lastSeenAt }[] }`; `DELETE /api/account/sessions` → ends all sessions and clears the cookie; `DELETE /api/account/sessions/[id]` → ends one own session (404 for another user's session); `GET /api/account/claude` → `ClaudeStatus`; `PUT /api/account/claude` `{ key }` → `ClaudeStatus`; `DELETE /api/account/claude` → `ClaudeStatus`.

- [ ] **Step 1: Write the failing test**

Create `tests/api-account.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { POST as changePassword } from '@/app/api/account/password/route';
import { DELETE as endAll, GET as listSessions } from '@/app/api/account/sessions/route';
import { DELETE as endOne } from '@/app/api/account/sessions/[id]/route';
import { DELETE as removeKey, GET as claude, PUT as saveKey } from '@/app/api/account/claude/route';
import { GET as state } from '@/app/api/state/route';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE } from '@/lib/auth/cookie-name';
import { readSecret } from '@/lib/secrets';
import { ctx, makeUser, request, TEST_PASSWORD } from './helpers/http';

const NEW_PW = 'granite meadow sparrow 808';
const KEY = 'sk-ant-api03-' + 'a'.repeat(40) + 'WXYZ';
const alive = async (cookie: string) => (await state(request('/api/state', { cookie }), ctx())).status === 200;

describe('POST /api/account/password', () => {
  it('changes the password and ends the other sessions only', async () => {
    const { user, cookie } = await makeUser();
    const other = `${SESSION_COOKIE}=${await createSession(user.id, 'phone')}`;
    const res = await changePassword(request('/api/account/password', { method: 'POST', cookie, body: { current: TEST_PASSWORD, next: NEW_PW } }), ctx());
    expect(res.status).toBe(200);
    expect(await alive(cookie)).toBe(true);
    expect(await alive(other)).toBe(false);
  });

  it('refuses a wrong current password and a weak new one', async () => {
    const { cookie } = await makeUser();
    expect((await changePassword(request('/api/account/password', { method: 'POST', cookie, body: { current: 'wrong wrong wrong', next: NEW_PW } }), ctx())).status).toBe(400);
    expect((await changePassword(request('/api/account/password', { method: 'POST', cookie, body: { current: TEST_PASSWORD, next: 'short' } }), ctx())).status).toBe(400);
  });
});

describe('sessions', () => {
  it('lists the own sessions and marks the current one', async () => {
    const { user, cookie } = await makeUser();
    await createSession(user.id, 'Mozilla/5.0 (iPad)');
    const body = await (await listSessions(request('/api/account/sessions', { cookie }), ctx())).json();
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('tokenHash');
  });

  it("ends one session, and gives 404 for another user's session", async () => {
    const { user, cookie } = await makeUser();
    const b = await makeUser();
    const phone = `${SESSION_COOKIE}=${await createSession(user.id, 'phone')}`;
    const phoneRow = await db.session.findFirstOrThrow({ where: { userId: user.id, userAgent: 'phone' } });
    expect((await endOne(request(`/api/account/sessions/${phoneRow.id}`, { method: 'DELETE', cookie: b.cookie }), ctx({ id: phoneRow.id }))).status).toBe(404);
    expect(await alive(phone)).toBe(true);
    expect((await endOne(request(`/api/account/sessions/${phoneRow.id}`, { method: 'DELETE', cookie }), ctx({ id: phoneRow.id }))).status).toBe(200);
    expect(await alive(phone)).toBe(false);
    expect(await alive(cookie)).toBe(true);
  });

  it('ends all sessions and clears the cookie', async () => {
    const { user, cookie } = await makeUser();
    const other = `${SESSION_COOKIE}=${await createSession(user.id, 'phone')}`;
    const res = await endAll(request('/api/account/sessions', { method: 'DELETE', cookie }), ctx());
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await alive(cookie)).toBe(false);
    expect(await alive(other)).toBe(false);
  });
});

describe('own Claude key', () => {
  it('saves the key encrypted and never sends it back', async () => {
    const { user, cookie } = await makeUser();
    const res = await saveKey(request('/api/account/claude', { method: 'PUT', cookie, body: { key: KEY } }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyHint).toBe('WXYZ');
    expect(body.mode).toBe('own');
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify(await (await claude(request('/api/account/claude', { cookie }), ctx())).json())).not.toContain(KEY);
    expect(JSON.stringify(await (await state(request('/api/state', { cookie }), ctx())).json())).not.toContain(KEY);
    expect(await readSecret(user.id, 'anthropic')).toBe(KEY);
  });

  it('refuses a value that is not an Anthropic key', async () => {
    const { cookie } = await makeUser();
    expect((await saveKey(request('/api/account/claude', { method: 'PUT', cookie, body: { key: 'hello' } }), ctx())).status).toBe(400);
  });

  it('removes the key', async () => {
    const { user, cookie } = await makeUser();
    await saveKey(request('/api/account/claude', { method: 'PUT', cookie, body: { key: KEY } }), ctx());
    const body = await (await removeKey(request('/api/account/claude', { method: 'DELETE', cookie }), ctx())).json();
    expect(body.keyHint).toBeNull();
    expect(await readSecret(user.id, 'anthropic')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/api-account.test.ts`
Expected: FAIL, the route modules do not exist.

- [ ] **Step 3: Write the routes**

Create `src/app/api/account/password/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { verifyPassword } from '@/lib/auth/password';
import { FIFTEEN_MINUTES, hitLimit } from '@/lib/auth/rate-limit';
import { setPassword } from '@/lib/auth/users';

/** A change of password ends all other sessions of the user (spec 2.1). */
export const POST = handle(async (req) => {
  const { user, session } = await requireSession(req);
  const body = await readJson(req);
  const limit = await hitLimit(`password:user:${user.id}`, 10, FIFTEEN_MINUTES);
  if (!limit.ok) throw new HttpError(429, 'Too many tries. Try again later.');
  const current = typeof body.current === 'string' ? body.current : '';
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) throw new HttpError(400, 'The current password is not correct.');
  await setPassword(user.id, typeof body.next === 'string' ? body.next : '', session.id);
  return NextResponse.json({ ok: true });
});
```

Create `src/app/api/account/sessions/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { handle } from '@/lib/auth/http';
import { clearSessionCookie, endUserSessions } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const { user, session } = await requireSession(req);
  const rows = await db.session.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: 'desc' } });
  const sessions = rows.map((s) => ({
    id: s.id,
    current: s.id === session.id,
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
  }));
  return NextResponse.json({ sessions });
});

/** Signs out everywhere, this browser too. */
export const DELETE = handle(async (req) => {
  const { user } = await requireSession(req);
  await endUserSessions(user.id);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, req);
  return res;
});
```

Create `src/app/api/account/sessions/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { handle, HttpError } from '@/lib/auth/http';
import { clearSessionCookie } from '@/lib/auth/session';

export const DELETE = handle<{ params: { id: string } }>(async (req, { params }) => {
  const { user, session } = await requireSession(req);
  const r = await db.session.deleteMany({ where: { id: params.id, userId: user.id } });
  if (r.count === 0) throw new HttpError(404, 'Not found.');
  const res = NextResponse.json({ ok: true });
  if (params.id === session.id) clearSessionCookie(res, req);
  return res;
});
```

Create `src/app/api/account/claude/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError, readJson } from '@/lib/auth/http';
import { claudeStatus, clearFailures } from '@/lib/claude';
import { deleteSecret, saveSecret } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

const KEY = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json(await claudeStatus(user.id));
});

/** Saves the user's own Anthropic API key, encrypted. The reply holds only the last 4 characters. */
export const PUT = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!KEY.test(key)) throw new HttpError(400, 'This is not an Anthropic API key. A key starts with "sk-ant-".');
  await saveSecret(user.id, 'anthropic', key);
  clearFailures(`own:${user.id}`);
  return NextResponse.json(await claudeStatus(user.id));
});

export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  await deleteSecret(user.id, 'anthropic');
  clearFailures(`own:${user.id}`);
  return NextResponse.json(await claudeStatus(user.id));
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/api-account.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run all checks, then commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add src/app/api/account tests/api-account.test.ts
git commit -m "Add account routes for the password, sessions and own Claude key"
```

---

### Task 9: Data isolation in the libraries

Task 1 moved each analysis to `JobAnalysis`. This task removes the other places where one user can see the data of another: the global `claims.yml`, the global résumé and Drive settings, and the upload check.

**Files:**
- Modify: `src/lib/user.ts`, `src/lib/analysis.ts`, `src/lib/cv.ts`, `src/lib/state.ts`, `src/app/api/jobs/refresh/route.ts`, `src/app/api/profile/import/route.ts`, `src/app/api/jobs/[id]/resume/route.ts`, `src/app/api/resume/[id]/route.ts`
- Test: `tests/isolation-libs.test.ts`

**Interfaces:**
- Consumes: `db.jobAnalysis` (Task 1); `credentialFor` (Task 6).
- Produces: `claimsFor(userId: string): Promise<ClaimsDoc | null>` and `isAdmin(userId: string): Promise<boolean>` in `src/lib/user.ts`; `buildCv(app, job)` is now `async` and returns `null` for a member; `NO_RESUME` message constant in `src/lib/cv.ts`; `checkExportUpload(file: File): Promise<Buffer>` in `src/lib/linkedin-import.ts`.

**Interim rule (until part 3 moves profiles to the database):** `data/profile/claims.yml`, `RESUME_PDF`, `RESUME_TEX` and the Drive settings in `.env` belong to the admin. Only the admin's calls read them. A member's profile comes from the LinkedIn import tables, and a member has no résumé PDF until part 3 adds templates.

- [ ] **Step 1: Write the failing test**

Create `tests/isolation-libs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

const ADMIN_DOC = { sentinel: 'admin-only-claims' };
vi.mock('@/lib/claims', async (orig) => ({
  ...(await orig<typeof import('@/lib/claims')>()),
  loadClaims: vi.fn(() => ADMIN_DOC),
}));
vi.mock('@/lib/claude/credential', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude/credential')>()),
  credentialFor: vi.fn(async () => null),
}));

import { db } from '@/lib/db';
import { claimsFor } from '@/lib/user';
import { analyseJob, jobView } from '@/lib/analysis';
import { buildCv, publishCv } from '@/lib/cv';
import { checkExportUpload } from '@/lib/linkedin-import';
import { makeUser } from './helpers/http';

const job = () =>
  db.job.create({
    data: { externalId: `iso-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Backend Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test', description: 'Java and Kotlin services.' },
  });

describe('claimsFor', () => {
  it('gives claims.yml to the admin only', async () => {
    const admin = await makeUser('admin');
    const member = await makeUser('member');
    expect(await claimsFor(admin.user.id)).toBe(ADMIN_DOC);
    expect(await claimsFor(member.user.id)).toBeNull();
  });
});

describe('analyses', () => {
  it("writes the analysis of user A only to A's row", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const j = await job();
    await analyseJob(j, a.user.id);
    const rows = await db.jobAnalysis.findMany({ where: { jobId: j.id } });
    expect(rows.map((r) => r.userId)).toEqual([a.user.id]);
    expect(rows[0].tries).toBe(1);
    const viewB = await jobView(j, b.user.id);
    expect(viewB.provisional).toBe(true);
  });

  it('does not change the global job fields', async () => {
    const a = await makeUser();
    const j = await job();
    await analyseJob(j, a.user.id);
    const after = await db.job.findUniqueOrThrow({ where: { id: j.id } });
    expect({ field: after.field, mode: after.mode, level: after.level, visa: after.visa }).toEqual({ field: j.field, mode: j.mode, level: j.level, visa: j.visa });
  });
});

describe('résumé', () => {
  beforeEach(() => {
    vi.stubEnv('RESUME_PDF', '/tmp/admin-resume.pdf');
  });

  it("never gives the admin's résumé to a member", async () => {
    const member = await makeUser('member');
    const j = await job();
    const app = await db.application.create({ data: { userId: member.user.id, jobId: j.id } });
    expect(await buildCv(app, j)).toBeNull();
    const p = await publishCv(app, j);
    expect(p.resume).toBeNull();
    expect(p.driveReason).toMatch(/No résumé/);
    vi.unstubAllEnvs();
  });
});

describe('checkExportUpload', () => {
  it('accepts a zip and a CSV file', async () => {
    const zip = new File([Buffer.from('PK\x03\x04rest-of-zip')], 'export.zip');
    expect((await checkExportUpload(zip)).subarray(0, 2).toString()).toBe('PK');
    const csv = new File(['First Name,Last Name\nA,B\n'], 'Connections.csv');
    expect((await checkExportUpload(csv)).length).toBeGreaterThan(0);
  });

  it('refuses a file with a false name and a file over 50 MB', async () => {
    const exe = new File([Buffer.from('MZ\x90\x00binary\x00\x00')], 'Connections.csv');
    await expect(checkExportUpload(exe)).rejects.toMatchObject({ status: 400 });
    const pdf = new File([Buffer.from('%PDF-1.7')], 'export.zip');
    await expect(checkExportUpload(pdf)).rejects.toMatchObject({ status: 400 });
    const big = new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'export.zip');
    await expect(checkExportUpload(big)).rejects.toMatchObject({ status: 413 });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/isolation-libs.test.ts`
Expected: FAIL, `claimsFor` and `checkExportUpload` are not exported.

- [ ] **Step 3: Add `claimsFor` and `isAdmin`**

In `src/lib/user.ts`, add:

```ts
export async function isAdmin(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  return u?.role === 'admin';
}

/**
 * The claims document of one user. Until part 3 moves profiles into the
 * database, data/profile/claims.yml is the admin's file, so only the admin
 * gets it. A member's profile comes from the LinkedIn import tables.
 */
export async function claimsFor(userId: string): Promise<ClaimsDoc | null> {
  return (await isAdmin(userId)) ? loadClaims() : null;
}
```

Import the type `ClaimsDoc` from `./claims` (the file already imports `loadClaims` from there). `claimsFor` is in `user.ts`, not in `claims.ts`, for 2 reasons: `claims.ts` stays free of the database (the `check:claims` script uses it), and the test can mock `loadClaims`, because `claimsFor` calls it through an import.

- [ ] **Step 4: Replace each global `loadClaims()` call**

Run: `grep -rn "loadClaims()" src`

Change each call that runs for a user:

| File | Change |
|---|---|
| `src/lib/user.ts` `profileSummary` | `const claims = loadClaims();` → `const claims = await claimsFor(userId);` |
| `src/lib/analysis.ts` | `function fitFromClaims(): Fit` → `function fitFromClaims(claims: ClaimsDoc | null): Fit` (delete its `loadClaims()` line). In `analyseJob`, `makeJobViewer` and `jobView`, get `const claims = await claimsFor(userId);` one time and pass it: `fitFromClaims(claims)`. |
| `src/lib/state.ts` | `projectPicks(loadClaims())` → `projectPicks(await claimsFor(userId))`. Also change `claims: claimsFailure()` to `claims: user.role === 'admin' ? claimsFailure() : null`, so that members do not see the banner about the admin's file. |
| `src/app/api/jobs/refresh/route.ts` | `searchQueries(loadClaims())` → `searchQueries(await claimsFor(user.id))` |
| `src/app/api/profile/import/route.ts` | `loadClaims()` → `(await claimsFor(userId))` |
| `src/lib/cv.ts` | See Step 5. |

`scripts/check-claims.ts` keeps `loadClaims()`. It checks the file and runs for no user.

- [ ] **Step 5: Keep the résumé and Drive for the admin**

In `src/lib/cv.ts`:

```ts
/** Until part 3 adds templates for each user, RESUME_PDF, RESUME_TEX and the
 *  Drive settings in .env are the admin's. A member gets no résumé. */
export const NO_RESUME = 'No résumé is set up for your account yet.';

export async function buildCv(app: Application, job: Job) {
  if (!(await isAdmin(app.userId))) return null;
  return buildResume(await claimsFor(app.userId), postingText(job), app.id, readSteer(app));
}
```

In `publishCv`, change the first early return to give the reason for a member:

```ts
  const resume = await buildCv(app, job);
  if (!resume || !resume.path) {
    return { resume: null, driveUrl: null, driveReason: (await isAdmin(app.userId)) ? null : NO_RESUME };
  }
```

In `refineCv`, replace `const doc = loadClaims();` with:

```ts
  if (!(await isAdmin(app.userId))) throw new CvError(NO_RESUME);
  const doc = await claimsFor(app.userId);
```

Import `isAdmin` and `claimsFor` from `./user`, and remove the `loadClaims` import. In the other files of the table, import `claimsFor` from `@/lib/user` (or `./user`).

In `src/app/api/jobs/[id]/resume/route.ts` and `src/app/api/resume/[id]/route.ts`, change the 404 message `'No CV configured. Set RESUME_PDF, and RESUME_TEX to tailor it.'` to: `(await isAdmin(user.id)) ? 'No CV configured. Set RESUME_PDF, and RESUME_TEX to tailor it.' : NO_RESUME`.

- [ ] **Step 6: Check the upload**

In `src/lib/linkedin-import.ts`, add:

```ts
import { HttpError } from './auth/http';

export const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

/**
 * Checks a LinkedIn upload before it is parsed: 50 MB or less, and the bytes
 * must be a zip archive (PK\x03\x04) or a text CSV file. The name alone
 * proves nothing.
 */
export async function checkExportUpload(file: File): Promise<Buffer> {
  if (file.size > MAX_EXPORT_BYTES) throw new HttpError(413, 'The file is larger than 50 MB.');
  const buf = Buffer.from(await file.arrayBuffer());
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  const head = buf.subarray(0, 4096);
  const isCsv = /\.csv$/i.test(file.name) && !head.includes(0) && !head.subarray(0, 5).equals(Buffer.from('%PDF-'));
  if (!isZip && !isCsv) throw new HttpError(400, 'Upload the LinkedIn export as a .zip file, or Connections.csv.');
  return buf;
}
```

In `src/app/api/profile/import/route.ts`, replace `Buffer.from(await file.arrayBuffer())` with `await checkExportUpload(file)`, outside the `try` that turns parse errors into 400s (so a 413 stays a 413).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/isolation-libs.test.ts`
Expected: PASS, 6 tests.

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass. Then run `grep -rn "loadClaims()" src`. Expected: only the definition in `src/lib/claims.ts` and the call in `claimsFor` in `src/lib/user.ts`.

- [ ] **Step 8: Commit**

```bash
git add -A src tests/isolation-libs.test.ts
git commit -m "Keep claims.yml, the résumé and Drive for the admin; check uploads"
```

---

### Task 10: Isolation tests for every API route

**Files:**
- Test: `tests/isolation.test.ts`

**Interfaces:**
- Consumes: all routes from Tasks 4, 7 and 8 and the existing routes; `makeUser`, `request`, `ctx` (Task 4).
- Produces: one test for each route. The test makes users A and B and checks that B cannot read, change or delete the rows of A, and that a request without a session gets 401.

The Claude calls are stubbed (`credentialFor` returns null), so no test spends money.

- [ ] **Step 1: Write the test**

Create `tests/isolation.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

vi.mock('@/lib/claude/credential', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude/credential')>()),
  credentialFor: vi.fn(async () => null),
}));

import { db } from '@/lib/db';
import { ctx, makeUser, request } from './helpers/http';
import * as claudeRoute from '@/app/api/claude/route';
import * as countries from '@/app/api/countries/route';
import * as jobDetail from '@/app/api/jobs/[id]/route';
import * as jobResume from '@/app/api/jobs/[id]/resume/route';
import * as refine from '@/app/api/jobs/[id]/resume/refine/route';
import * as refresh from '@/app/api/jobs/refresh/route';
import * as outreach from '@/app/api/outreach/route';
import * as outreachEvent from '@/app/api/outreach/[id]/route';
import * as profileImport from '@/app/api/profile/import/route';
import * as resumeFile from '@/app/api/resume/[id]/route';
import * as stateRoute from '@/app/api/state/route';
import * as password from '@/app/api/account/password/route';
import * as sessions from '@/app/api/account/sessions/route';
import * as sessionOne from '@/app/api/account/sessions/[id]/route';
import * as accountClaude from '@/app/api/account/claude/route';
import * as adminInvites from '@/app/api/admin/invites/route';
import * as adminUsers from '@/app/api/admin/users/route';
import * as adminUser from '@/app/api/admin/users/[id]/route';
import * as adminReset from '@/app/api/admin/users/[id]/reset/route';

type Handler = (req: ReturnType<typeof request>, c: ReturnType<typeof ctx>) => Promise<Response>;

/** User A with a job, an application, an outreach event and a contact. */
async function seedA() {
  const a = await makeUser();
  const job = await db.job.create({
    data: { externalId: `iso-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test' },
  });
  const app = await db.application.create({ data: { userId: a.user.id, jobId: job.id, status: 'sent', note: 'note of A', cvChat: '[{"role":"you","text":"secret chat of A","at":"x"}]' } });
  const event = await db.outreachEvent.create({ data: { applicationId: app.id, kind: 'request', contactName: 'Contact Of A', body: 'message of A', handled: true } });
  await db.contact.create({ data: { userId: a.user.id, firstName: 'Private', lastName: 'Connection', company: 'Acme' } });
  return { a, job, app, event };
}

describe('every route refuses a request without a session', () => {
  const routes: [string, Handler, Record<string, string>?][] = [
    ['GET /api/claude', claudeRoute.GET as Handler],
    ['POST /api/countries', countries.POST as Handler],
    ['GET /api/jobs/[id]', jobDetail.GET as Handler, { id: 'x' }],
    ['PATCH /api/jobs/[id]', jobDetail.PATCH as Handler, { id: 'x' }],
    ['POST /api/jobs/[id]/resume', jobResume.POST as Handler, { id: 'x' }],
    ['POST /api/jobs/[id]/resume/refine', refine.POST as Handler, { id: 'x' }],
    ['DELETE /api/jobs/[id]/resume/refine', refine.DELETE as Handler, { id: 'x' }],
    ['POST /api/jobs/refresh', refresh.POST as Handler],
    ['POST /api/outreach', outreach.POST as Handler],
    ['PATCH /api/outreach/[id]', outreachEvent.PATCH as Handler, { id: 'x' }],
    ['POST /api/profile/import', profileImport.POST as Handler],
    ['GET /api/resume/[id]', resumeFile.GET as Handler, { id: 'x' }],
    ['GET /api/state', stateRoute.GET as Handler],
    ['POST /api/account/password', password.POST as Handler],
    ['GET /api/account/sessions', sessions.GET as Handler],
    ['DELETE /api/account/sessions', sessions.DELETE as Handler],
    ['DELETE /api/account/sessions/[id]', sessionOne.DELETE as Handler, { id: 'x' }],
    ['GET /api/account/claude', accountClaude.GET as Handler],
    ['PUT /api/account/claude', accountClaude.PUT as Handler],
    ['DELETE /api/account/claude', accountClaude.DELETE as Handler],
    ['POST /api/admin/invites', adminInvites.POST as Handler],
    ['GET /api/admin/users', adminUsers.GET as Handler],
    ['PATCH /api/admin/users/[id]', adminUser.PATCH as Handler, { id: 'x' }],
    ['POST /api/admin/users/[id]/reset', adminReset.POST as Handler, { id: 'x' }],
  ];

  for (const [name, handler, params] of routes) {
    it(name, async () => {
      const [method, path] = name.split(' ');
      const res = await handler(request(path, { method, body: method === 'GET' ? undefined : {} }), ctx(params));
      expect(res.status).toBe(401);
    });
  }
});

describe('user B cannot reach the rows of user A', () => {
  it('GET /api/state shows B only its own data', async () => {
    await seedA();
    const b = await makeUser();
    const body = JSON.stringify(await (await stateRoute.GET(request('/api/state', { cookie: b.cookie }), ctx())).json());
    expect(body).not.toContain('note of A');
    expect(body).not.toContain('Contact Of A');
    expect(body).not.toContain('Private');
  });

  it("GET /api/jobs/[id] does not show A's referral or chat", async () => {
    const { job } = await seedA();
    const b = await makeUser();
    const res = await jobDetail.GET(request(`/api/jobs/${job.id}`, { cookie: b.cookie }), ctx({ id: job.id }));
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('message of A');
    expect(body).not.toContain('secret chat of A');
  });

  it("PATCH /api/jobs/[id] changes B's application, not A's", async () => {
    const { job, app } = await seedA();
    const b = await makeUser();
    await jobDetail.PATCH(request(`/api/jobs/${job.id}`, { method: 'PATCH', cookie: b.cookie, body: { applied: true } }), ctx({ id: job.id }));
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('sent');
  });

  it("PATCH /api/outreach/[id] on A's event is 404 and changes nothing", async () => {
    const { event } = await seedA();
    const b = await makeUser();
    const res = await outreachEvent.PATCH(request(`/api/outreach/${event.id}`, { method: 'PATCH', cookie: b.cookie, body: { body: 'changed by B' } }), ctx({ id: event.id }));
    expect(res.status).toBe(404);
    expect((await db.outreachEvent.findUniqueOrThrow({ where: { id: event.id } })).body).toBe('message of A');
  });

  it("GET /api/resume/[id] with A's application is 404", async () => {
    const { app } = await seedA();
    const b = await makeUser();
    expect((await resumeFile.GET(request(`/api/resume/${app.id}`, { cookie: b.cookie }), ctx({ id: app.id }))).status).toBe(404);
  });

  it("DELETE /api/jobs/[id]/resume/refine does not reset A's chat", async () => {
    const { job, app } = await seedA();
    const b = await makeUser();
    await refine.DELETE(request(`/api/jobs/${job.id}/resume/refine`, { method: 'DELETE', cookie: b.cookie }), ctx({ id: job.id }));
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).cvChat).toContain('secret chat of A');
  });

  it("POST /api/countries changes B's list only", async () => {
    const { a } = await seedA();
    const b = await makeUser();
    await countries.POST(request('/api/countries', { method: 'POST', cookie: b.cookie, body: { cc: 'DE', on: false } }), ctx());
    expect((await db.countryPref.findFirstOrThrow({ where: { userId: a.user.id, cc: 'DE' } })).on).toBe(true);
    expect((await db.countryPref.findFirstOrThrow({ where: { userId: b.user.id, cc: 'DE' } })).on).toBe(false);
  });

  it("POST /api/profile/import does not delete A's contacts", async () => {
    const { a } = await seedA();
    const b = await makeUser();
    const form = new FormData();
    form.set('file', new File(['First Name,Last Name,URL,Email Address,Company,Position,Connected On\nNew,Person,,,Beta,Dev,01 Jan 2025\n'], 'Connections.csv'));
    const res = await profileImport.POST(request('/api/profile/import', { method: 'POST', cookie: b.cookie, form }), ctx());
    expect(res.status).toBe(200);
    expect(await db.contact.count({ where: { userId: a.user.id } })).toBe(1);
  });

  it("POST /api/outreach on a job uses B's application only", async () => {
    const { job, app } = await seedA();
    const b = await makeUser();
    await outreach.POST(request('/api/outreach', { method: 'POST', cookie: b.cookie, body: { jobId: job.id, action: 'replied', incoming: 'Thanks!' } }), ctx());
    expect(await db.outreachEvent.count({ where: { applicationId: app.id } })).toBe(1);
  });

  it("DELETE /api/account/sessions/[id] on A's session is 404", async () => {
    const { a } = await seedA();
    const b = await makeUser();
    const s = await db.session.findFirstOrThrow({ where: { userId: a.user.id } });
    expect((await sessionOne.DELETE(request(`/api/account/sessions/${s.id}`, { method: 'DELETE', cookie: b.cookie }), ctx({ id: s.id }))).status).toBe(404);
    expect(await db.session.count({ where: { id: s.id } })).toBe(1);
  });

  it('admin routes refuse a member', async () => {
    const { a } = await seedA();
    const b = await makeUser();
    expect((await adminUser.PATCH(request(`/api/admin/users/${a.user.id}`, { method: 'PATCH', cookie: b.cookie, body: { disabled: true } }), ctx({ id: a.user.id }))).status).toBe(403);
    expect((await adminReset.POST(request(`/api/admin/users/${a.user.id}/reset`, { method: 'POST', cookie: b.cookie }), ctx({ id: a.user.id }))).status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: a.user.id } })).disabledAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/isolation.test.ts`
Expected: PASS. A failure here is a real leak. Do not change the test to pass. Fix the route so that it filters by `user.id`, and give `404` (not `403`) for a row of another user. If the `profile/import` test fails because the CSV header that the parser expects is different, read `src/lib/linkedin-import.ts` and use its exact `Connections.csv` header. That is a test-data fix, not a leak.

- [ ] **Step 3: Run all checks, then commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add tests/isolation.test.ts
git add -u src
git commit -m "Test that each API route keeps the data of each user apart"
```

---

### Task 11: Settings, invite and reset pages

**Files:**
- Create: `src/components/SettingsScreen.tsx`, `src/components/TokenForm.tsx`, `src/app/invite/[token]/page.tsx`, `src/app/reset/[token]/page.tsx`
- Modify: `src/components/Waypoint.tsx`, `src/components/JobsScreen.tsx`, `src/lib/state.ts`

**Interfaces:**
- Consumes: the routes of Tasks 4, 6, 7 and 8; `api`, `post`, `put`, `patch`, `del`, `copyText`, `ApiError` from `src/components/api.ts`.
- Produces: a Settings screen with 3 sections (Account, Claude, Admin for the admin only); `/invite/[token]` and `/reset/[token]` pages. Part 6 changes the layout. This task makes the features usable.

- [ ] **Step 1: Add the role to the state**

In `src/lib/state.ts`, add `role: user.role` to the `user` object that `buildState` returns.

- [ ] **Step 2: Write the token page**

Create `src/components/TokenForm.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { api, post } from './api';

type Info = { kind: 'invite' | 'reset'; email: string | null; name: string | null };
const input = { width: '100%', background: '#2A3242', borderColor: '#3A4252', color: '#F4F1EA' };

/** The page for an invite link or a reset link. On success the server signs the user in. */
export default function TokenForm({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Info>(`/api/invites/${encodeURIComponent(token)}`).then(setInfo, (e) => setError((e as Error).message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) {
      setError('The 2 passwords are not the same.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post(`/api/invites/${encodeURIComponent(token)}`, info?.kind === 'invite' ? { name, email, password } : { password });
      window.location.assign('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const title = info?.kind === 'reset' ? 'Set a new password' : 'Make your account';

  return (
    <div className="login">
      <div className="login-left">
        <div className="display wordmark" style={{ padding: 0 }}>Waypoint</div>
        <h1 className="display">{info ? title : 'Waypoint'}</h1>
        {info?.kind === 'reset' && <p className="login-lede">For {info.email}. A new password signs you out on all other devices.</p>}
      </div>
      <form className="login-right" onSubmit={submit}>
        {!info && !error && <p>Checking the link…</p>}
        {info?.kind === 'invite' && (
          <>
            <label className="stack" style={{ gap: 8 }}>
              <span style={{ fontSize: 15, color: '#C9C2B3' }}>Name</span>
              <input className="field" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} style={input} />
            </label>
            <label className="stack" style={{ gap: 8 }}>
              <span style={{ fontSize: 15, color: '#C9C2B3' }}>Email</span>
              {info.email ? (
                <input className="field" value={info.email} readOnly style={input} />
              ) : (
                <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
              )}
            </label>
          </>
        )}
        {info && (
          <>
            <label className="stack" style={{ gap: 8 }}>
              <span style={{ fontSize: 15, color: '#C9C2B3' }}>Password (12 characters or more)</span>
              <input className="field" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
            </label>
            <label className="stack" style={{ gap: 8 }}>
              <span style={{ fontSize: 15, color: '#C9C2B3' }}>Type the password again</span>
              <input className="field" type="password" autoComplete="new-password" minLength={12} required value={again} onChange={(e) => setAgain(e.target.value)} style={input} />
            </label>
            <button className="login-cta" type="submit" disabled={busy}>{busy ? 'Saving…' : info.kind === 'reset' ? 'Set the password' : 'Make the account'}</button>
          </>
        )}
        {error && <p role="alert" style={{ color: '#E7835A', fontSize: 15, margin: 0 }}>{error}</p>}
      </form>
    </div>
  );
}
```

Create `src/app/invite/[token]/page.tsx`:

```tsx
import TokenForm from '@/components/TokenForm';

export const dynamic = 'force-dynamic';

export default function InvitePage({ params }: { params: { token: string } }) {
  return <TokenForm token={params.token} />;
}
```

Create `src/app/reset/[token]/page.tsx` with the same content, and the function name `ResetPage`.

- [ ] **Step 3: Write the Settings screen**

Create `src/components/SettingsScreen.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, copyText, del, patch, post, put } from './api';

type Status = { mode: 'own' | 'shared' | 'cli' | 'none'; detail: string; keyHint: string | null; sharedAvailable: boolean; capUsd: number; sharedSpentUsd: number; capReached: boolean; resetsAt: string };
type SessionRow = { id: string; current: boolean; userAgent: string | null; createdAt: string; lastSeenAt: string };
type UserRow = { id: string; email: string; name: string; role: string; disabled: boolean; createdAt: string; lastSeenAt: string | null; sharedSpentUsd: number };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
const device = (ua: string | null) => {
  if (!ua) return 'Unknown device';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return ua.slice(0, 40);
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card stack" style={{ gap: 16, padding: 20, marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsScreen({ state, setToast }: { state: any; setToast: (s: string) => void }) {
  const isAdmin = state?.user?.role === 'admin';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [claude, setClaude] = useState<Status | null>(null);
  const [key, setKey] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [link, setLink] = useState<{ url: string; expiresAt: string; label: string } | null>(null);

  const load = useCallback(async () => {
    const [s, c] = await Promise.all([api<{ sessions: SessionRow[] }>('/api/account/sessions'), api<Status>('/api/account/claude')]);
    setSessions(s.sessions);
    setClaude(c);
    if (isAdmin) setUsers((await api<{ users: UserRow[] }>('/api/admin/users')).users);
  }, [isAdmin]);

  useEffect(() => {
    load().catch((e) => setToast((e as Error).message));
  }, [load, setToast]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) setToast(done);
      await load();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const signOut = async () => {
    await post('/api/auth/signout');
    window.location.assign('/login');
  };

  return (
    <div className="stack" style={{ maxWidth: 760, gap: 0 }}>
      <div className="screen-head"><h1 className="display">Settings</h1></div>

      <Section title="Account">
        <div>{state?.user?.name} · {state?.user?.email}</div>
        <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); run(() => post('/api/account/password', { current, next }), 'Password changed. Your other devices are signed out.').then(() => { setCurrent(''); setNext(''); }); }}>
          <div className="label">Change password</div>
          <input className="field" type="password" autoComplete="current-password" placeholder="Current password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input className="field" type="password" autoComplete="new-password" placeholder="New password (12 characters or more)" minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} />
          <button className="btn btn-dark" type="submit">Change password</button>
        </form>
        <div className="label">Signed-in devices</div>
        {sessions.map((s) => (
          <div key={s.id} className="row" style={{ gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span>{device(s.userAgent)}{s.current ? ' (this device)' : ''} · last used {when(s.lastSeenAt)}</span>
            {!s.current && <button className="btn" onClick={() => run(() => del(`/api/account/sessions/${s.id}`), 'Signed out that device.')}>Sign out</button>}
          </div>
        ))}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <button className="btn" onClick={signOut}>Sign out</button>
          <button className="btn" onClick={async () => { await del('/api/account/sessions'); window.location.assign('/login'); }}>Sign out on all devices</button>
        </div>
      </Section>

      <Section title="Claude">
        {claude && (
          <>
            <div>{claude.detail}</div>
            {claude.sharedAvailable && (
              <div className="mono" style={{ fontSize: 14 }}>
                Shared key this month: ${claude.sharedSpentUsd.toFixed(2)} of ${claude.capUsd.toFixed(2)} · resets {new Date(claude.resetsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}
              </div>
            )}
            {claude.keyHint ? (
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <span>Your API key ends in {claude.keyHint}.</span>
                <button className="btn" onClick={() => run(() => del('/api/account/claude'), 'Removed your API key.')}>Remove key</button>
              </div>
            ) : (
              <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); run(() => put('/api/account/claude', { key }), 'Saved your API key.').then(() => setKey('')); }}>
                <div className="label">Your own Anthropic API key</div>
                <input className="field" type="password" autoComplete="off" placeholder="sk-ant-…" required value={key} onChange={(e) => setKey(e.target.value)} />
                <button className="btn btn-dark" type="submit">Save key</button>
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>The key is stored encrypted. Waypoint shows only its last 4 characters.</div>
              </form>
            )}
          </>
        )}
      </Section>

      {isAdmin && (
        <Section title="Admin">
          <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await post<{ url: string; expiresAt: string }>('/api/admin/invites', { email: inviteEmail }); setLink({ ...r, label: 'Invite link' }); setInviteEmail(''); }); }}>
            <div className="label">Invite a user</div>
            <input className="field" type="email" placeholder="Email (optional)" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <button className="btn btn-dark" type="submit">Make an invite link</button>
          </form>
          {link && (
            <div className="stack" style={{ gap: 8 }}>
              <div>{link.label}. Send it to the user. It works one time, until {when(link.expiresAt)}.</div>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <code className="mono" style={{ wordBreak: 'break-all', fontSize: 13 }}>{link.url}</code>
                <button className="btn" onClick={async () => setToast((await copyText(link.url)) ? 'Copied.' : 'Copy the link from the screen.')}>Copy</button>
              </div>
            </div>
          )}
          <div className="label">Users</div>
          {users.map((u) => (
            <div key={u.id} className="row" style={{ gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <span>
                {u.name} · {u.email} · {u.role}{u.disabled ? ' · disabled' : ''}
                <br />
                <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>shared key ${u.sharedSpentUsd.toFixed(2)} this month · last seen {when(u.lastSeenAt)}</span>
              </span>
              <span className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={() => run(async () => { const r = await post<{ url: string; expiresAt: string }>(`/api/admin/users/${u.id}/reset`); setLink({ ...r, label: `Reset link for ${u.email}` }); })}>Reset link</button>
                {u.role !== 'admin' && (
                  <button className="btn" onClick={() => run(() => patch(`/api/admin/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? 'User enabled.' : 'User disabled and signed out.')}>{u.disabled ? 'Enable' : 'Disable'}</button>
                )}
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add Settings to the app**

In `src/components/Waypoint.tsx`:
1. Add `'settings'` to the `Screen` type, and add `{ key: 'settings', label: 'Settings', short: 'Settings' }` as the last entry of the navigation list.
2. Import `SettingsScreen` and render it with the other screens: `{screen === 'settings' && <SettingsScreen state={state} setToast={setToast} />}`.
3. Change the Claude line at about line 118 to: `{state.claude.mode === 'none' ? 'Claude not connected' : `Claude: ${state.claude.mode === 'cli' ? 'your subscription' : state.claude.mode === 'own' ? 'your API key' : 'shared key'}`}`.
4. Where the banner shows for `state.claude.mode === 'none'` (if there is one), show `state.claude.detail` and a button that opens Settings: `onClick={() => go('settings')}`.

In `src/components/JobsScreen.tsx` at about line 100, change `state.claude.mode === 'cli' ? 'your subscription' : 'API key'` to `state.claude.mode === 'cli' ? 'your subscription' : state.claude.mode === 'own' ? 'your API key' : 'the shared key'`.

- [ ] **Step 5: Run the checks and the build**

Run: `npm test && npm run typecheck && npm run lint && npx next build`
Expected: all pass. The build lists `/login`, `/invite/[token]` and `/reset/[token]`.

- [ ] **Step 6: Check the pages in a browser**

Run the built app on a free port with the worktree database: `PORT=3199 npx next start -p 3199` (in the background). Then:
1. Open `http://localhost:3199/`. Expected: a redirect to `/login?next=%2F`.
2. Sign in as `admin@test.local` with the password from Task 5 Step 5. Expected: the Jobs screen.
3. Open Settings. Make an invite link. Open it in a private window, and make a member account. Expected: the member is signed in, Settings has no Admin section, and the Claude section says "Add an API key in Settings to use Claude." (there is no `ANTHROPIC_API_KEY` in this worktree's `.env`).
4. As the admin, disable the member. Reload the member window. Expected: the login page.
5. Stop the server.

If no browser tool is available, do steps 1–4 with `curl` and a cookie jar, and say so in the report.

If sign-in works but `/` sends you back to `/login`, the middleware reads a different cookie name than the routes set. The middleware reads `process.env.PORT` at run time. Report this as BLOCKED with the cookie names that you see. Do not work around it.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsScreen.tsx src/components/TokenForm.tsx src/app/invite src/app/reset src/components/Waypoint.tsx src/components/JobsScreen.tsx src/lib/state.ts
git commit -m "Add the Settings screen and the invite and reset pages"
```

---

### Task 12: Health check, tunnel and docs

**Files:**
- Create: `src/app/api/health/route.ts`
- Modify: `scripts/remote.sh`, `.env.example`, `README.md`, `SETUP_WITH_CLAUDE.md`
- Test: `tests/api-health.test.ts`

**Interfaces:**
- Produces: `GET /api/health` → `{ app: 'waypoint', status: 'ok' }` with no session. Part 4 adds the worker state to it.

- [ ] **Step 1: Write the failing test**

Create `tests/api-health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';
import { ctx, request } from './helpers/http';

describe('GET /api/health', () => {
  it('answers without a session and shows no user data', async () => {
    const res = await GET(request('/api/health'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ app: 'waypoint', status: 'ok' });
  });
});
```

Run: `npx vitest run tests/api-health.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Write the route**

Create `src/app/api/health/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

/** Public. scripts/remote.sh uses it to prove that the tunnel reaches this app. */
export const GET = handle(async () => {
  await db.$queryRawUnsafe('SELECT 1');
  return NextResponse.json({ app: 'waypoint', status: 'ok' });
});
```

Run: `npx vitest run tests/api-health.test.ts`
Expected: PASS.

- [ ] **Step 3: Remove basic auth and the passcode from `scripts/remote.sh`**

Accounts now protect the app (spec 2.4). Make these changes:
1. In the header comment, change the `zrok` lines to: "a fixed https://<name>.shares.zrok.io URL. Needs `zrok2 enable` once and a reserved name (`zrok2 create name <name>`). WAYPOINT_ZROK_NAME (default waypoint), WAYPOINT_ZROK_NAMESPACE (default public)." Remove the text about the `user:password` file.
2. Delete the 2 `ZROK_AUTH=` lines.
3. In `start_tunnel`, delete the `--basic-auth "$(cat "$ZROK_AUTH")"` argument and the comment above it.
4. In `preflight`, delete the `[ -s "$ZROK_AUTH" ] || ...` line, and delete the whole `if [ "$TUNNEL" = cloudflared ] && [ -z "$(envv WAYPOINT_ACCESS_CODE)" ]` block with its comment.
5. In `start`, change the check from `tunnel_get "$(cat "$RUN/url")/api/state" | grep -q '"signedIn"'` to `tunnel_get "$(cat "$RUN/url")/api/health" | grep -q '"app":"waypoint"'`.
6. In `start`, delete the `passcode:` line and the `login:` line. For cloudflared keep `echo; echo "This URL is new every start."`. Add after the `case`: `echo "  Sign in with your Waypoint account. Make the admin with: npm run user:create-admin"`.

Run: `bash -n scripts/remote.sh && grep -n "ZROK_AUTH\|ACCESS_CODE\|basic-auth" scripts/remote.sh`
Expected: no syntax error and no grep output.

- [ ] **Step 4: Update `.env.example`**

1. Delete the `WAYPOINT_ACCESS_CODE` lines and the `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` and `LINKEDIN_REDIRECT_URI` lines with their comments. Delete `WAYPOINT_EMAIL`. Keep `WAYPOINT_NAME` (the Drive file names use it) and change its comment to say that.
2. Add after `WAYPOINT_SECRET_KEY`:

```bash
# The public URL of this copy, for example https://waypoint.shares.zrok.io.
# Invite and reset links use it, and the CSRF check accepts it as an Origin.
# WAYPOINT_PUBLIC_URL=

# The monthly limit in USD for each user on the shared ANTHROPIC_API_KEY.
# A user with their own key in Settings does not use the shared key.
# WAYPOINT_SHARED_MONTHLY_USD=5
```

3. Change the comment of `ANTHROPIC_API_KEY`: it is the shared key. A user's own key (Settings) comes first. Without any key, only the admin can use Claude, through the `claude` CLI.

- [ ] **Step 5: Update the docs**

In `README.md`:
1. Replace the text about the passcode and LinkedIn sign-in with a section "Accounts". Content: Waypoint is for a small invited group. Run `npm run user:create-admin` one time to make the admin. The admin makes invite links and password reset links in Settings → Admin. There is no email sending: the admin sends each link. A link works one time, for 7 days. Passwords are 12 characters or more.
2. Update the credential-order row that part 1 added: own key (Settings), then `ANTHROPIC_API_KEY` up to `WAYPOINT_SHARED_MONTHLY_USD` each month for each user, then the `claude` CLI for the admin only.
3. Remove `WAYPOINT_ACCESS_CODE` and `WAYPOINT_ZROK_AUTH_FILE` everywhere.

In `SETUP_WITH_CLAUDE.md` section 0 (the upgrade path that part 1 added), add these steps after `migrate deploy`:

```markdown
6. Add the public URL to `.env` (append one line; do not overwrite the file):
   `WAYPOINT_PUBLIC_URL=https://<name>.shares.zrok.io`
7. Set the admin password: `npm run user:create-admin`. The migration made your
   existing account the admin. The script asks for the email, the name and the password.
8. Remove `WAYPOINT_ACCESS_CODE`, `WAYPOINT_ZROK_AUTH_FILE` and the `LINKEDIN_*` lines
   from `.env`. They do nothing now.
9. Restart with `./scripts/start.sh restart`. The zrok share now has no basic auth.
   Sign in with the admin email and password.
```

Run: `grep -rn "ACCESS_CODE\|ZROK_AUTH_FILE\|auth/local\|auth/linkedin" --include=*.md --include=*.ts --include=*.tsx --include=*.sh --include=.env.example . | grep -v node_modules | grep -v docs/superpowers`
Expected: no output.

- [ ] **Step 6: Run all checks, then commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add src/app/api/health tests/api-health.test.ts scripts/remote.sh .env.example README.md SETUP_WITH_CLAUDE.md
git commit -m "Add a health check; remove basic auth and the passcode from the tunnel docs"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| 2.1 `passwordHash` (argon2id), `role`, `disabledAt` | 1, 2 |
| 2.1 `npm run user:create-admin`; migration makes the current user the admin | 1, 5 |
| 2.1 Invites: 32 bytes, SHA-256 only, 7 days, one use; name and password | 2, 7 |
| 2.1 Passwords 12+ and the 10,000 list | 2 |
| 2.1 Reset links from the admin | 7 |
| 2.1 Own password change ends other sessions | 8 |
| 2.1 Disable ends sessions at once | 4, 7 |
| 2.2 Admin-only actions; YAML import and export for all | 6, 7 (YAML import and export: part 3) |
| 2.3 Session table, cookie, 30 days, hourly touch, `requireUser`, `requireAdmin`, middleware, session list, port-specific cookie | 3, 4, 8 |
| 2.4 Remove the passcode, LinkedIn OIDC, basic auth, `/api/auth/local` | 4, 12 |
| 2.5 Sign-in and token rate limits; CSRF Origin check | 3, 4, 7 |
| 2.5 Upload limits | 9 (LinkedIn 50 MB). Résumé 10 MB and YAML 1 MB: part 3, where those uploads start. |
| 2.6 `JobAnalysis`, data owners, 2-user test for each route, 404 for other users' rows | 1, 9, 10 |
| 2.6 User files in `data/users/<userId>/` | Part 3 (no route writes a user file in part 2; only the admin builds résumés) |
| 2.7 AES-256-GCM secrets, last 4 only | 2, 8 |
| 2.8 Credential order, cap, admin-only CLI, `LlmUsage`, use in Settings and Admin | 6, 7, 8, 11 |
| 6.8 No AI output of A reaches B; cap for each user | 1, 6, 9, 10 |
| 7.6 Settings: Account, Claude, Admin | 11 (Job search, Integrations, Data: parts 3 and 6) |
| 9 No credential → heuristic and a banner; cap reached → banner with the reset date; failures for each credential | 6, 11 |
| 11 `WAYPOINT_SHARED_MONTHLY_USD`; removed keys | 3, 12 |

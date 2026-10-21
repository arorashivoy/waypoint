# Part 4: Worker, Caching, Hosting and Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all slow work (feed refresh, job analysis, CV compile, Claude imports) from the web requests into a database task queue that a separate worker process runs, and add the caches, health checks, logs, backups and `systemd` units that the Pi needs to run Waypoint without a person.

**Architecture:** A `Task` table is the queue. The web routes only add tasks and read their state. `scripts/worker.ts` takes one task at a time with an atomic update, runs the handler for its kind, and writes a heartbeat. The client polls `GET /api/tasks/:id` through one helper. Board fetches, model replies and CV PDFs are cached. Three `systemd` user units (web, worker, tunnel) and a backup timer are files in `deploy/systemd/`; `scripts/deploy.sh` updates and restarts them.

**Tech Stack:** Next.js 14, Prisma 5 with SQLite, zod 4, Vitest, tsx (runs the worker), `pino@9.5.0` (logs), `tar@7.4.3` (backup archives), Node 22.

**Spec:** `docs/superpowers/specs/2026-10-15-production-ready-design.md`, section 4 (all of it), section 9 (rows "Shared key cap reached", "Board fetch fails", "Worker stops"), section 11 (`WAYPOINT_BACKUP_REMOTE`, `WAYPOINT_ZROK_NAME`, `WAYPOINT_ZROK_NAMESPACE`).

## Global Constraints

- Only `src/lib/exec.ts` starts processes. Each new program gets an exact argument template and an environment allowlist there. The lint rule that blocks `child_process` stays.
- No text from a user, a posting, a file or a model becomes a command or an argument outside the fixed templates in `exec.ts`.
- All Claude calls use Sonnet. Do not change `src/lib/claude/model.ts`.
- One task at a time in the worker. Retries after 1, 5 and 30 minutes.
- A `running` task older than 10 minutes goes back to `queued`. Heartbeat each 30 seconds.
- `LlmCache` size limit: 50 MB, least recently used rows go first.
- `FeedFetch`: skip a board fetched in the last 6 hours unless the user forces it. Send `If-None-Match` and `If-Modified-Since`.
- Backups: each night at 03:00; keep 14 daily and 8 weekly copies; `VACUUM INTO 'data/backups/<date>.db'`; `data/users/` into a `.tar.gz` with Node.
- `/api/health` needs no sign-in and returns no personal data, names or versions. Disk check: more than 1 GB free.
- Logs: JSON lines through `pino`; each request has an ID; passwords, tokens, keys and cookies are removed.
- Write all prose, comments, UI text and commit messages in ASD-STE100.
- Do not install or start the `systemd` units, and do not run `scripts/deploy.sh`, on this machine. The live app runs here on port 3118. Do not use ports 3117 or 3118 in a server you start. Do not touch `data/waypoint.db` or the live checkout `/home/shivoy/waypoint-shivoy`.
- Do not run `next build`. Use `npm run typecheck`, `npm run lint` and `npm test`.
- Each new API route goes into the 401 table in `tests/isolation.test.ts`.
- Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01NBiMk6SSfnPwe8wAW7MFwo`.

## Review Focus

1. **The worker stops in the middle of a task.** Expected: after 10 minutes the task is `queued` again and runs one more time; 2 workers never take the same task. (Task 1 test `claimNext gives each task to one caller`, Task 1 test `requeueStale`.)
2. **A double tap on "Build CV" or "Refresh".** Expected: the second tap gets the ID of the task that is already `queued` or `running`, not a second task. (Task 1 test `enqueue returns the open task with the same dedupeKey`.)
3. **A user reads the task ID of another user.** Expected: 404, the same reply as for an ID that does not exist. (Task 3 test.)
4. **A restore while the app runs, or an archive with `../` or an absolute path.** Expected: the restore refuses, and nothing changes. (Task 11 tests.)
5. **A board that replies 304, or fails.** Expected: the jobs in the database stay; a failure does not change the stored `etag`; the other boards continue. (Task 5 tests.)

---

### Task 1: Task queue tables and queue functions

**Files:**
- Create: `prisma/migrations/3_worker/migration.sql`
- Modify: `prisma/schema.prisma` (models `Task`, `WorkerHeartbeat`, `FeedFetch`; relation `User.tasks` with `onDelete: Cascade`)
- Create: `src/lib/tasks/queue.ts`
- Test: `tests/tasks-queue.test.ts`, `tests/db.test.ts` (pragma checks)

**Interfaces:**
- Produces:
  - `type TaskKind = 'refresh' | 'analysis' | 'cv' | 'resume-import' | 'github-import' | 'maintenance'`
  - `type TaskStatus = 'queued' | 'running' | 'done' | 'failed'`
  - `enqueue(input: { kind: TaskKind; userId: string | null; payload: unknown; dedupeKey?: string; runAt?: Date }): Promise<{ id: string; created: boolean }>`
  - `claimNext(now?: Date): Promise<TaskRow | null>` — `TaskRow` is the Prisma `Task` row with `payload` parsed.
  - `completeTask(id: string, result: unknown): Promise<void>`
  - `failTask(id: string, error: string, now?: Date): Promise<'queued' | 'failed'>`
  - `deferTask(id: string, until: Date): Promise<void>` — back to `queued`, `attempts` unchanged.
  - `requeueStale(now?: Date): Promise<number>`
  - `beat(pid: number, now?: Date): Promise<void>`, `lastBeat(): Promise<Date | null>`
  - `RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const`, `STALE_MS = 600_000`

Schema decisions:
- `Task`: `id` (cuid), `kind`, `userId` (nullable, for `maintenance`), `payload` (text JSON), `result` (text JSON, nullable), `status` (default `queued`), `runAt` (default now), `attempts` (default 0), `lastError` (nullable, at most 500 characters), `dedupeKey` (nullable), `startedAt` (nullable), `createdAt`, `updatedAt`. Indexes: `[status, runAt]`, `[userId, kind, status]`, `[dedupeKey, status]`.
- `WorkerHeartbeat`: `id` (always `'worker'`), `pid`, `beatAt`, `startedAt`.
- `FeedFetch`: `board` (id, a stable key such as `greenhouse:stripe` or `adzuna:DE:react developer`), `etag`, `lastModified`, `fetchedAt`, `status` (`ok`, `not-modified` or `failed`), `error` (nullable, at most 200 characters).

Retry ruling: a failure with `attempts` 1, 2 or 3 sets `runAt = now + RETRY_DELAYS_MS[attempts - 1]` and `status = queued`. The 4th failure sets `status = failed`. (The spec gives 3 delays and says "after 3 failures"; this reads it as 3 failed retries.)

- [ ] **Step 1: Write the failing tests** in `tests/tasks-queue.test.ts`:
  - `enqueue creates a queued task` — status `queued`, attempts 0, `created: true`.
  - `enqueue returns the open task with the same dedupeKey` — 2 calls with `dedupeKey: 'cv:u1:j1'` give the same `id`, the second has `created: false`. After `completeTask`, a third call makes a new task.
  - `claimNext gives each task to one caller` — 1 queued task, `Promise.all([claimNext(), claimNext()])` gives exactly one non-null row; its status is `running`, `attempts` is 1, `startedAt` is set.
  - `claimNext skips a task whose runAt is in the future` and `takes the oldest runAt first`.
  - `failTask retries after 1, 5 and 30 minutes, then fails` — loop claim/fail 4 times with a fixed `now`; check `runAt - now` equals 60 000, 300 000, 1 800 000, then status `failed` and `lastError` is set.
  - `deferTask keeps attempts` — claim (attempts 1), defer, claim again: attempts 2 only because of the second claim, `runAt` equals the given date.
  - `requeueStale` — a task `running` with `startedAt` 11 minutes ago goes to `queued`; one with `startedAt` 9 minutes ago stays.
  - `beat and lastBeat` — `lastBeat()` is null, then equals the given date.
  - `a deleted user takes their tasks` — delete the user; the task count is 0.
- [ ] **Step 2: Run** `npx vitest run tests/tasks-queue.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Add the models and write the migration** with `npx prisma migrate dev --create-only --name 3_worker` against a scratch `DATABASE_URL` in the scratchpad, then rename the folder to `3_worker`. Check the SQL by eye: only `CREATE TABLE` and `CREATE INDEX`.
- [ ] **Step 4: Implement `src/lib/tasks/queue.ts`.** `claimNext` is atomic: select the ID of the first `queued` task with `runAt <= now` (order `runAt`, `createdAt`), then `updateMany({ where: { id, status: 'queued' }, data: { status: 'running', attempts: { increment: 1 }, startedAt: now } })`; if the count is 0, try the next candidate (at most 5 times), else return null. `enqueue` with a `dedupeKey` runs in one `$transaction` that first looks for a `queued` or `running` task with that key.
- [ ] **Step 5: Add to `tests/db.test.ts`** a test `each connection has WAL, busy_timeout 5000 and foreign keys on`: `PRAGMA journal_mode` is `wal`, `PRAGMA busy_timeout` is 5000, `PRAGMA foreign_keys` is 1. If one fails, set it in `dbReady` in `src/lib/db.ts` and fix the comment there.
- [ ] **Step 6: Run** `npx vitest run tests/tasks-queue.test.ts tests/db.test.ts tests/migrations.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** `Add the task queue tables and the queue functions`.

### Task 2: The worker process

**Files:**
- Create: `src/lib/tasks/worker.ts`, `src/lib/tasks/handlers.ts`, `scripts/worker.ts`
- Modify: `package.json` (script `"worker": "tsx --env-file=.env scripts/worker.ts"`)
- Test: `tests/tasks-worker.test.ts`

**Interfaces:**
- Consumes: Task 1 queue functions.
- Produces:
  - `type Handler = (task: TaskRow) => Promise<unknown>` — the return value becomes `Task.result`.
  - `class TaskDeferred extends Error { constructor(public until: Date, message: string) }`
  - `registerHandler<P>(kind: TaskKind, schema: z.ZodType<P>, h: (payload: P, task: TaskRow) => Promise<unknown>): void` and the `handlers` map in `handlers.ts`. Later tasks add their handler there. The worker checks the payload with the schema before it calls the handler (spec 4.3: each JSON column has a zod schema). A payload that fails the schema fails the task at once, with no retry.
  - `runOnce(now?: Date): Promise<'ran' | 'idle'>`
  - `startWorker(opts: { signal: AbortSignal; idleMs?: number; beatMs?: number }): Promise<void>` — idle poll 2000 ms, heartbeat 30 000 ms, `requeueStale` each 60 000 ms, `maintenance` task enqueued each hour (dedupeKey `maintenance`).

- [ ] **Step 1: Write the failing tests:**
  - `runOnce runs the handler and stores the result` — register a test kind handler that returns `{ n: 1 }`; status `done`, `result` parses to `{ n: 1 }`.
  - `a handler error goes to failTask` — status `queued`, `lastError` holds the message, cut to 500 characters.
  - `TaskDeferred goes to deferTask` — `runAt` equals `until`, attempts after one run is 1 and stays 1 after the defer.
  - `a task of an unknown kind fails at once` — status `failed` after one run (no retries), `lastError` names the kind.
  - `a payload that fails the schema fails at once` — status `failed` after one run, the handler is not called.
  - `runOnce returns idle when nothing is due`.
  - `startWorker stops when the signal aborts` — it resolves within 3 s and writes at least one heartbeat. Use `idleMs: 10`, `beatMs: 10`.
  - `a running task finishes before startWorker resolves` — abort while a slow handler (200 ms) runs; the task ends `done`.
- [ ] **Step 2: Run** `npx vitest run tests/tasks-worker.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `worker.ts` and `handlers.ts` (empty map plus `maintenance`, which calls `pruneCacheBySize` from Task 8 once that exists; until then `maintenance` returns `{}`). `scripts/worker.ts` checks `env()` first (exit 1 with the message on `EnvError`), logs the start, connects `SIGTERM` and `SIGINT` to an `AbortController`, and awaits `startWorker`.
- [ ] **Step 4: Run** the tests. Expected: PASS. Then run `timeout 8 npm run worker` with a scratch `DATABASE_URL` and a scratch `WAYPOINT_SECRET_KEY`; expected: it starts, writes a heartbeat, and stops on the timeout signal with exit code 124 and no stack trace.
- [ ] **Step 5: Commit** `Add the worker loop and its entry script`.

### Task 3: Task status API and the client helper

**Files:**
- Create: `src/app/api/tasks/[id]/route.ts`, `src/lib/tasks/view.ts`, `src/lib/client/tasks.ts` (or the folder the client `post()` helper is in; put it next to `post`)
- Modify: `tests/isolation.test.ts`
- Test: `tests/api-tasks.test.ts`, `tests/client-tasks.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/tasks/:id` → `{ id, kind, status, attempts, runAt, error: string | null, result: unknown | null }`. `error` is `lastError` only when `status` is `failed`, else null.
  - `taskView(row): TaskView` in `view.ts`.
  - `runTask<T>(start: () => Promise<{ taskId: string }>, opts?: { intervalMs?: number; timeoutMs?: number; onProgress?: (v: TaskView) => void }): Promise<T>` — polls each 1500 ms; resolves with `result` on `done`; throws `Error(error)` on `failed`; throws `Error('The task did not finish in time. It still runs; check again later.')` after `timeoutMs` (default 15 minutes).

- [ ] **Step 1: Write the failing tests:**
  - `owner reads the task` — 200 with the fields above.
  - `another user gets 404` and `an unknown ID gets 404` — the same body.
  - `a maintenance task (userId null) gets 404 for a member`.
  - `signed out gets 401` (row in the isolation table).
  - `runTask resolves with the result` and `runTask throws the task error` — with a fake `fetch` that returns `queued`, `running`, then `done` or `failed`; use fake timers.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the route with `requireUser` and `findFirst({ where: { id, userId: user.id } })`, and the client helper.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `Add the task status route and the client poll helper`.

### Task 4: Job analysis through the queue

**Files:**
- Modify: `src/lib/queue.ts` (replace the in-memory queue), `src/lib/state.ts`, `src/lib/tasks/handlers.ts`, `src/components/Waypoint.tsx` only if the shape changes
- Test: `tests/tasks-analysis.test.ts`

**Interfaces:**
- Consumes: `enqueue`, `registerHandler`, `TaskDeferred`; `analyseJob(job, userId)` and `makeJobViewer` from `src/lib/analysis.ts`; `credentialFor(userId)`.
- Produces:
  - `queueAnalysis(userId: string, limit = 25): Promise<Progress>` — same selection and order as today; one `analysis` task per job with payload `{ jobId, batch }` and `dedupeKey: analysis:<userId>:<jobId>`. `batch` is a new cuid for each call.
  - `analysisProgress(userId: string): Promise<Progress>` — `Progress` keeps the shape `{ running, done, total, failed }`, counted over the tasks of the latest batch of that user. `running` is true while one of them is `queued` or `running`.
  - Handler `analysis`: loads the job (if it is gone, return `{ skipped: 'gone' }`), runs `analyseJob`. If the shared key cap stops the call, throw `TaskDeferred` with `until` = the first day of the next month 00:00 UTC (section 9).

- [ ] **Step 1: Write the failing tests:**
  - `queueAnalysis makes one task per job and no duplicates` — call it 2 times; the task count equals the count of jobs selected the first time.
  - `analysisProgress counts the latest batch` — 3 tasks, mark 1 `done` and 1 `failed`: `{ running: true, done: 2, total: 3, failed: 1 }`.
  - `the handler runs analyseJob` (mock `analyseJob`) and `a cap error defers the task to the next month`.
  - `no credential means no tasks` — `credentialFor` mocked to null; the result is `{ running: false, done: 0, total: 0, failed: 0 }`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `buildState` awaits `analysisProgress`. Remove `CONCURRENCY` and the in-process `Promise.all`. Update the module comment (the reason for the old design is gone).
- [ ] **Step 4: Run** them and `npx vitest run tests/api-jobs.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Run job analysis in the worker`.

### Task 5: Feed refresh in the worker, with FeedFetch

**Files:**
- Modify: `src/lib/sources/index.ts` (`getJson`, `fetchAll`), `src/app/api/jobs/refresh/route.ts`, `src/lib/tasks/handlers.ts`, `src/components/JobsScreen.tsx`, the Settings screen component
- Create: `src/lib/sources/feed-fetch.ts`, `src/app/api/feeds/route.ts`
- Test: `tests/feed-fetch.test.ts`, `tests/api-jobs.test.ts`

**Interfaces:**
- Produces:
  - `fetchBoard(board: string, url: string, init: RequestInit, opts: { force: boolean; now?: Date }): Promise<{ status: 'ok'; json: any } | { status: 'skipped' | 'not-modified' }>` in `feed-fetch.ts`. It reads and writes `FeedFetch`.
  - `FEED_FRESH_MS = 6 * 3600_000`.
  - `fetchAll(activeCcs, queries, opts: { force: boolean })` — each board gets a stable `board` key; a `skipped` or `not-modified` board adds a report row with `got: 0` and its status.
  - `POST /api/jobs/refresh` body `{ force?: boolean }` → `{ taskId }`, `dedupeKey: refresh:<userId>`. Handler `refresh` runs today's route body (upsert jobs, then `queueAnalysis`) and returns `{ added, total, report, analysing }`.
  - `GET /api/feeds` → `[{ board, status, fetchedAt, error }]` for boards with `status = 'failed'` only. Signed-in users only.

- [ ] **Step 1: Write the failing tests** (mock `fetch`):
  - `a board fetched 5 hours ago is skipped` and `force fetches it`.
  - `the second request sends If-None-Match and If-Modified-Since` — from the stored `etag` and `lastModified`.
  - `304 keeps the jobs and sets status not-modified` — the `Job` rows of an earlier run stay, `fetchedAt` moves.
  - `a failed board records status failed and keeps its etag` and `the other boards still return jobs`.
  - `POST /api/jobs/refresh returns a taskId, and a second POST returns the same taskId`.
  - `GET /api/feeds lists only failed boards` and `401 signed out` (isolation table).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Only boards whose reply is JSON from a fixed URL go through `fetchBoard`; keep the parse code of each board as it is. `JobsScreen` calls `runTask(() => post('/api/jobs/refresh', { force }))`; the button stays "Refresh"; under the refresh report add a text button "Fetch all boards again" that sends `force: true`. Settings gets a "Job boards" card that lists the failed boards from `GET /api/feeds`, or the line "All job boards work." when the list is empty.
- [ ] **Step 4: Run** them and the full `tests/api-jobs.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Refresh the job boards in the worker and cache each board`.

### Task 6: CV build, refine and reset in the worker

**Files:**
- Modify: `src/app/api/jobs/[id]/resume/route.ts`, `src/app/api/jobs/[id]/resume/refine/route.ts`, `src/lib/resume.ts` (output folder), the route that serves the PDF file, `src/lib/tasks/handlers.ts`, `src/components/JobsScreen.tsx` (`cvCall`)
- Test: `tests/tasks-cv.test.ts`

**Interfaces:**
- Consumes: `cvView`, `publishCv`, `rethrowForUser` from `src/lib/cv.ts`; `userDir(userId)` (or the helper with that job) from `src/lib/user-files.ts`.
- Produces:
  - The 3 routes return `{ taskId }`. Payload `{ jobId, action: 'generate' | 'refine' | 'reset', message?: string }`, `dedupeKey: cv:<userId>:<jobId>`. Remove the in-memory `inFlight` map.
  - Handler `cv` returns the `cvView` object, or throws the user-facing error text that the route gives today (for example `NO_RESUME`).
  - Compiled PDFs go to `data/users/<userId>/resumes/<key>-<hash>.pdf`. The hash stays as today (rendered source plus engine), which covers the template, the content and the steer.

- [ ] **Step 1: Write the failing tests:**
  - `POST resume returns a taskId; a second POST returns the same one`.
  - `the cv handler stores the view` (mock `publishCv`), and `a missing CV fails the task with the NO_RESUME text`.
  - `the PDF path is inside the folder of the user` — the path starts with `usersRoot()/<userId>/resumes/`.
  - `another user cannot read the PDF` — the file route gives 404.
  - `refine keeps the message in the payload, at most 2000 characters` (a longer message gives 400 at the route).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `cvCall` in `JobsScreen` wraps each call with `runTask`. The busy state stays on while the task runs.
- [ ] **Step 4: Run** them and `npx vitest run tests/api-jobs.test.ts tests/isolation.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Build and refine the CV in the worker`.

### Task 7: Résumé and GitHub imports in the worker

**Files:**
- Modify: `src/app/api/profile/resume-import/route.ts`, `src/app/api/profile/github/import/route.ts`, `src/lib/profile/resume-import.ts`, `src/lib/profile/github-import.ts`, `src/lib/github.ts`, `src/lib/tasks/handlers.ts`, `src/components/profile/ImportsTab.tsx`, `src/components/profile/GithubSource.tsx`
- Test: `tests/profile-resume-import.test.ts`, `tests/profile-github-import.test.ts`, `tests/github.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/profile/resume-import` checks the upload as today (type, size, hidden `.tex` markers, pending cap), saves the file to `data/users/<userId>/uploads/<cuid>.<ext>`, and returns `{ taskId }`. Handler `resume-import` reads the file, runs the Claude part of `importResume`, deletes the file in a `finally`, and returns `{ drafts, dropped, hidden }`.
  - `POST /api/profile/github/import` checks the names and the pending cap as today, then makes one `github-import` task for each repo (payload `{ username, repo }`) and returns `{ taskIds: string[] }`. The client waits for all of them and adds the counts.
  - In `src/lib/github.ts`: a body cut at 1 MB is not written to `GithubCache` (final review M2).

- [ ] **Step 1: Write the failing tests:**
  - `resume import returns a taskId and the handler makes drafts` (mock `askJson`).
  - `a .tex with hidden markers still gets 400 before a task exists` — the task count is 0.
  - `the upload file is deleted after the task, also when Claude fails`.
  - `github import makes one task per repo`, and `a failure on one repo keeps the drafts of the others`.
  - `a reply cut at 1 MB is not cached` — the next request sends no `If-None-Match`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Split `importResume` into `checkResumeUpload` (route) and `draftsFromResume` (handler); the same for GitHub. Keep the quote rule, the scans and `untrusted()` fences as they are.
- [ ] **Step 4: Run** the 3 test files and `tests/isolation.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Run the résumé and GitHub imports in the worker`.

### Task 8: Cache size limit and ETags

**Files:**
- Modify: `src/lib/cache.ts`, `src/lib/tasks/handlers.ts` (`maintenance`), `src/app/api/state/route.ts`
- Create: `src/lib/etag.ts`
- Test: `tests/cache.test.ts`, `tests/etag.test.ts`

**Interfaces:**
- Produces:
  - `CACHE_MAX_BYTES = 50 * 1024 * 1024`
  - `pruneCacheBySize(maxBytes = CACHE_MAX_BYTES): Promise<number>` — the sum of `length(value)` over all rows; while it is above `maxBytes`, delete the rows with the oldest `usedAt` in batches of 200. Returns the count deleted. Replace `pruneCache(keep)`; update its callers.
  - `jsonWithEtag(req: Request, body: unknown, init?: ResponseInit): Response` — `ETag` is `W/"<first 27 characters of the base64url SHA-256 of the JSON>"`; if `If-None-Match` matches, return 304 with no body. Add `Cache-Control: private, no-cache`.
  - `maintenance` handler: `{ pruned: await pruneCacheBySize() }`.

Ruling: the spec splits `/api/state` into routes for each screen and adds SWR. That is UI work, and section 7 lists SWR, so part 6 does the split. Part 4 adds the ETag to `/api/state` and to `GET /api/profile`.

- [ ] **Step 1: Write the failing tests:**
  - `pruneCacheBySize removes the least recently used rows first` — 3 rows of 1 000 bytes, limit 2 500: the row with the oldest `usedAt` goes; returns 1.
  - `pruneCacheBySize does nothing under the limit`.
  - `jsonWithEtag gives 200 with an ETag, then 304 for the same If-None-Match`, and `200 when the body changes`.
  - `/api/state sends an ETag`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `Limit the model cache to 50 MB and send ETags`.

### Task 9: JSON logs with request IDs

**Files:**
- Create: `src/lib/log.ts`
- Modify: `package.json` (`pino@9.5.0`, exact), `src/lib/auth/http.ts` (`handle`), `src/lib/tasks/worker.ts`, `scripts/worker.ts`, `src/lib/sources/index.ts` (the `console.warn`), `next.config.mjs` (add `pino` to `serverComponentsExternalPackages`)
- Test: `tests/log.test.ts`, `tests/auth-http.test.ts`

**Interfaces:**
- Produces:
  - `log` (a `pino` logger, level from `LOG_LEVEL`, default `info`; `silent` when `VITEST` is set unless a test passes its own stream).
  - `makeLogger(stream?: pino.DestinationStream): pino.Logger` for tests.
  - `REDACT_PATHS` — at least: `password`, `*.password`, `token`, `*.token`, `apiKey`, `*.apiKey`, `key`, `*.key`, `secret`, `*.secret`, `cookie`, `*.cookie`, `headers.cookie`, `headers.authorization`, `req.headers.cookie`, `req.headers.authorization`. Censor `'[removed]'`.
  - `handle()` sets `x-request-id` on each response: the incoming `x-request-id` when it matches `/^[A-Za-z0-9-]{8,64}$/`, else `randomUUID()`. A 5xx logs `{ reqId, method, path, err }` (path without the query string).

- [ ] **Step 1: Write the failing tests:**
  - `the logger removes passwords, tokens, keys and cookies` — log `{ password: 'p', user: { token: 't' }, headers: { cookie: 'c', authorization: 'a' }, apiKey: 'k' }` to a memory stream; the line has none of `p`, `t`, `c`, `a`, `k` as values and has `[removed]`.
  - `each response has an x-request-id`, `a valid incoming ID is kept`, `a bad incoming ID is replaced`.
  - `a 500 logs the request ID and no query string`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace `console.error` and `console.warn` in the files above with `log`. Do not log request bodies.
- [ ] **Step 4: Run** them and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Write JSON logs with a request ID`.

### Task 10: Health checks and the environment

**Files:**
- Modify: `src/app/api/health/route.ts`, `src/lib/env.ts`, `.env.example`, `tests/isolation.test.ts`
- Create: `src/lib/health.ts`, `src/app/api/admin/health/route.ts`
- Test: `tests/api-health.test.ts`, `tests/env.test.ts`

**Interfaces:**
- Consumes: `lastBeat()` (Task 1); the function that tells if a Claude credential exists (the shared key, the CLI token, or one user key in `UserSecret`).
- Produces:
  - `runChecks(now?: Date): Promise<Checks>` with `Checks = { db: Check; worker: Check; claude: Check; disk: Check }`, `Check = { ok: boolean; detail: string }`. Worker ok: last beat within 90 s. Disk ok: `fs.statfs` on the folder of the database gives more than 1 073 741 824 free bytes.
  - `GET /api/health` → `{ app: 'waypoint', status: 'ok' | 'degraded', checks: { db: 'ok' | 'degraded', worker: …, claude: …, disk: … } }`, always HTTP 200 while the process answers. Keep `app: 'waypoint'`, because `scripts/remote.sh` looks for it.
  - `GET /api/admin/health` (admin) → `{ status, checks: Checks, tasks: { queued, running, failed } }`.
  - `env.ts` adds optional `WAYPOINT_BACKUP_REMOTE`, `WAYPOINT_ZROK_NAME`, `WAYPOINT_ZROK_NAMESPACE`, `WAYPOINT_USERS_DIR`, `LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`; default `info`).

- [ ] **Step 1: Write the failing tests:**
  - `health is ok with a fresh heartbeat` and `degraded with no heartbeat`.
  - `the public reply has no detail text` — the JSON has only the keys above; no string in it is longer than 10 characters except `app`.
  - `admin health gives details; a member gets 403; signed out gets 401` (isolation table).
  - `LOG_LEVEL must be one of the levels`, `WAYPOINT_BACKUP_REMOTE is optional`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the new keys to `.env.example` with one comment line each.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `Report the health of the database, worker, Claude and disk`.

### Task 11: Backup and restore

**Files:**
- Create: `src/lib/backup.ts`, `scripts/backup.ts`, `scripts/restore.ts`
- Modify: `src/lib/exec.ts` (programs `rclone` and `systemctl`), `package.json` (`tar@7.4.3`, exact; scripts `"backup": "tsx --env-file=.env scripts/backup.ts"`, `"restore": "tsx --env-file=.env scripts/restore.ts"`), `.gitignore` (`data/backups/`)
- Test: `tests/backup.test.ts`, `tests/exec.test.ts`

**Interfaces:**
- Produces:
  - `backupNow(opts: { dir: string; usersDir: string; now?: Date }): Promise<{ db: string; users: string }>` — writes `<dir>/<YYYY-MM-DD>.db` with `VACUUM INTO` (through `db.$executeRawUnsafe`, the path checked to match `/^[A-Za-z0-9._\/-]+$/` and quoted) and `<dir>/<YYYY-MM-DD>-users.tar.gz` with `tar.create({ gzip: true, cwd: usersDir, portable: true }, ['.'])`. If a file for that date exists, it is replaced. If a step fails, remove the partial file of that step and throw.
  - `pruneBackups(dir: string, now?: Date): Promise<string[]>` — keeps the newest 14 dates, plus the newest date in each of the 8 most recent ISO weeks; removes the rest (both files of a date go together). Returns the removed names.
  - `uploadBackup(files: string[]): Promise<void>` — only when `WAYPOINT_BACKUP_REMOTE` is set; runs the `rclone` template `['copy', '--no-traverse', <file>, <remote>]` once per file. The remote must match `/^[A-Za-z0-9_-]+:[A-Za-z0-9._\/-]*$/`, else throw before any process starts.
  - `restoreBackup(opts: { dbFile: string; usersTar?: string; dataDir: string; usersDir: string }): Promise<void>` — refuses (throws, nothing changed) when `systemctl --user is-active waypoint-web` or `waypoint-worker` prints `active`. It first copies the current database to `<dataDir>/backups/pre-restore-<ISO time>.db`. It checks every archive entry before it extracts: refuse an absolute path, a `..` segment, a symlink or a hard link. It removes `-wal` and `-shm` of the old database.
  - `exec.ts` templates: `rclone` (args from `uploadBackup` only, env allowlist `HOME`, `PATH`, `RCLONE_CONFIG`), `systemctl` (args exactly `['--user', 'is-active', 'waypoint-web' | 'waypoint-worker']`, env allowlist `HOME`, `PATH`, `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`).

- [ ] **Step 1: Write the failing tests** (temp folders and a temp database):
  - `backupNow writes a database copy that opens and has the same row counts`.
  - `backupNow packs data/users and the archive lists the files`.
  - `pruneBackups keeps 14 daily and 8 weekly` — 70 dates of fake files, one each day: 14 newest plus the weekly survivors stay; count them exactly for a fixed `now` of 2026-10-17.
  - `uploadBackup refuses a bad remote name` (no process starts) and `runs rclone once per file` (mock `run`).
  - `restore refuses while waypoint-web is active` (mock `run` to print `active`) and nothing changes.
  - `restore refuses an archive with ../, an absolute path or a symlink` and nothing changes.
  - `restore makes a pre-restore copy first`.
  - `exec refuses systemctl with any other unit name`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `scripts/backup.ts` runs `backupNow`, `pruneBackups` and `uploadBackup`, and logs the result. `scripts/restore.ts <db file> [users tar]` runs `restoreBackup` and prints "Restored. Start the units again."
- [ ] **Step 4: Run** them, `npm run lint` and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Add nightly backups and a safe restore`.

### Task 12: systemd units, the tunnel script and the deploy script

**Files:**
- Create: `deploy/systemd/waypoint-web.service`, `deploy/systemd/waypoint-worker.service`, `deploy/systemd/waypoint-tunnel.service`, `deploy/systemd/waypoint-backup.service`, `deploy/systemd/waypoint-backup.timer`, `scripts/tunnel.sh`, `scripts/deploy.sh`, `scripts/install-units.sh`
- Modify: `scripts/remote.sh` (header comment: dev mode only), `scripts/start.sh` (header: replaced by the units; keep it working)
- Test: `tests/deploy-files.test.ts`

Decisions:
- Each `.service` has `WorkingDirectory=%h/waypoint-shivoy` as written in the file; `install-units.sh <checkout path>` replaces it with the given path when it copies the units into `~/.config/systemd/user/`. The units use `EnvironmentFile=` with that checkout's `.env`, `Restart=on-failure`, `RestartSec=5`, and `WantedBy=default.target`.
- `waypoint-web`: `ExecStart=/usr/bin/env npm run start`. Ruling: the spec says `next start` with `output: 'standalone'`; `next start` does not serve a standalone build, and standalone needs extra copy steps for static files and the Prisma engine. Part 4 keeps `next start` with the normal build.
- `waypoint-worker`: `ExecStart=/usr/bin/env npm run worker`, `KillSignal=SIGTERM`, `TimeoutStopSec=90`.
- `waypoint-tunnel`: `ExecStart=%h/…/scripts/tunnel.sh` (path replaced by the install script), `After=waypoint-web.service`. `tunnel.sh` reads `WAYPOINT_ZROK_NAME` (default `waypoint`) and `WAYPOINT_ZROK_NAMESPACE` (default `public`), releases a stale share that holds the name (the `zrok_holder` logic, copied from `remote.sh`), then `exec zrok2 share public "localhost:$PORT" -n "$NS:$NAME" --headless`. No basic auth.
- `waypoint-backup.timer`: `OnCalendar=*-*-* 03:00:00`, `Persistent=true`. The service is `Type=oneshot`, `ExecStart=/usr/bin/env npm run backup`.
- `deploy.sh`: `set -euo pipefail`; in order: `git pull --ff-only`, `npm ci`, `npm run backup`, `npx prisma migrate deploy`, `npm run build`, then `systemctl --user restart waypoint-web waypoint-worker waypoint-tunnel`. A failed step stops the script before the restart. The backup before the migration is an addition to the spec: it costs one minute and makes a bad migration reversible.
- `install-units.sh` prints, and does not run, `loginctl enable-linger $USER`.

- [ ] **Step 1: Write the failing tests** in `tests/deploy-files.test.ts`:
  - `each service has Restart=on-failure, WorkingDirectory, EnvironmentFile and WantedBy=default.target`.
  - `the timer runs at 03:00 and is persistent`.
  - `deploy.sh runs the steps in the spec order, with the backup before the migration, and restart last` — check the order of the lines.
  - `deploy.sh has set -euo pipefail`.
  - `bash -n passes for tunnel.sh, deploy.sh and install-units.sh` — the test runs `bash -n <file>` with `spawnSync` from `node:child_process`. Tests do not go through `exec.ts`. If the lint rule also covers `tests/`, add one `eslint-disable-next-line` comment on the import that gives the reason.
  - `tunnel.sh has no basic auth flag`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Write the files.** Do not run `install-units.sh`, `deploy.sh` or `tunnel.sh`. If `systemd-analyze` exists, run `systemd-analyze --user verify` on copies in the scratchpad with the path placeholders replaced; report its output.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Add the systemd units and the deploy script`.

### Task 13: Part 3 follow-ups and the deploy notes

**Files:**
- Modify: `tests/migrations.test.ts`, `tests/isolation-libs.test.ts` (or the file that holds the admin claims tests), `src/app/api/account/route.ts` (DELETE), `tests/api-account-delete.test.ts`, `SETUP_WITH_CLAUDE.md`
- Create: `docs/deploy.md`

Items (from `.superpowers/sdd/2026-10-16-prod-part3-profile/final-review.md`, rows marked "CAN WAIT (4)"):
- A `2_profile` migration test with a LinkedIn position whose `startedAt` is NULL: the draft is made and has no start date.
- An admin read-back test: after `migrate:claims`, `claimsFor(adminId)` gives the same document as `loadProfileDoc(adminId)`.
- `DELETE /api/account` also deletes the `RateLimit` rows whose key contains the user ID. Test: the rows are gone after the delete; the rows of another user stay.
- A test for the rate limit for each user key on one import route.
- `docs/deploy.md` (ASD-STE100), the first deploy of the `multi-user` branch on the Pi, as numbered steps:
  1. Stop the old app (`./scripts/start.sh stop`). Back up `data/waypoint.db`, `-wal` and `-shm`.
  2. Add the new `.env` lines one at a time (list them). Do not overwrite `.env`.
  3. `npm ci`, `npx prisma migrate deploy`, `npm run user:create-admin` (if part 2 is not deployed yet).
  4. `npm run migrate:claims -- --user <admin email>`.
  5. Tell members: their old LinkedIn data is in Imports as drafts; their profile is empty until they accept; old project tags are gone.
  6. `scripts/install-units.sh <checkout path>`, `loginctl enable-linger`, `systemctl --user enable --now waypoint-web waypoint-worker waypoint-tunnel waypoint-backup.timer`.
  7. Check `curl -s localhost:$PORT/api/health`. All 4 checks must be `ok`.
  8. The worker and the web unit use the same `WorkingDirectory`. If not, set `WAYPOINT_USERS_DIR` in `.env`.
  9. Later updates: `scripts/deploy.sh`.
  10. Restore: stop the units, `npm run restore -- <file> [users tar]`, start the units.
  Add a caution: this Pi runs 2 copies; give each copy its own unit names or run the units for one copy only. (Ruling: the unit names are fixed in part 4; a second copy on the same host is out of scope.)
- `SETUP_WITH_CLAUDE.md`: one line that points to `docs/deploy.md`.

- [ ] **Step 1: Write the failing tests** for the 4 test items.
- [ ] **Step 2: Run** them. Expected: the `RateLimit` test fails; the others may pass at once (they pin behavior).
- [ ] **Step 3: Implement** the `RateLimit` delete, and write `docs/deploy.md` and the `SETUP_WITH_CLAUDE.md` line.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: all pass; lint has 0 errors.
- [ ] **Step 5: Commit** `Add the part 3 follow-up tests and the deploy notes`.

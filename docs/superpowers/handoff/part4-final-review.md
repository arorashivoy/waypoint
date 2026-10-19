# Final review: part 4 (worker, caching, operations)

Range: `78f8aae..25965f8` (28 commits, 96 files). Branch `multi-user`. Reviewer: opus, read-only.

I read the whole diff in passes: the queue and the worker, the handlers and the routes, the client
callers, the feed cache, logs and health, backup and restore, the units and the scripts, and the
docs. I ran 7 test files (`tasks-queue`, `tasks-worker`, `tasks-cv`, `tasks-analysis`, `api-tasks`,
`client-tasks`, `isolation`): 113 tests pass. I did not run deploy, install, tunnel, start, backup or
restore scripts, and I did not touch `data/`.

## Strengths

- The queue core is small and correct for one worker. `claimNext` uses a conditional `updateMany`,
  so two callers never get one task. `enqueue` with a `dedupeKey` checks and inserts in one
  transaction (`src/lib/tasks/queue.ts:38-46`).
- Each handler checks its payload with zod before it runs (`src/lib/tasks/worker.ts:200-204`).
  Each handler takes the user only from `task.userId`, never from the payload.
- The résumé upload path is built only from `task.userId` and a server-made name that a strict
  regex checks (`src/lib/tasks/handlers.ts:136-147`). The file stays while a retry can happen.
- `GET /api/tasks/[id]` scopes on `userId`. A task of another user, or a maintenance task, gives 404.
  The route is in the 401 table.
- The `FeedFetch` commit runs only after the jobs are stored, and a failed board does not start the
  6-hour skip. The Adzuna query leak in `GET /api/feeds` was caught and fixed.
- The restore fails closed, swaps the users folder through a sibling folder, removes `-wal` and
  `-shm` before the rename, and keeps `pre-restore-*` copies. The archive check refuses absolute
  paths, `..` segments and links.
- `exec.ts` gives `rclone` and `systemctl` fixed argument templates and environment allowlists.
- `handle()` adds a request ID to every reply, and it copies an immutable `Response`.
- The deploy script refuses a checkout that does not own the installed unit, and it stops the
  units before `npm ci`.

## Cross-task checks

| # | Check | Result |
|---|---|---|
| 1 | Every Claude call and compile in a web request now enqueues | **No.** 2 routes still do slow work in the request (Important 1). |
| 2 | Handlers check the payload with zod; paths come from `userId` and server names | Yes. |
| 3 | A task of user A never writes data of user B | Yes. Every write uses `task.userId`. `Job` and `FeedFetch` are global by design. |
| 4 | The worker survives a non-Error throw, a hang, and a DB error in `completeTask` | Partly. A non-Error throw is handled (`String(err)`). A hang has no time limit (Important 3). A DB error in `completeTask` runs the handler again (Important 4). An error that escapes `runOnce` leaves the task `running` with no attempt limit (Important 5). |
| 5 | No retry repeats a paid Claude call after the call succeeded | **No.** (Important 4.) |
| 6 | `runTask` callers show errors and clear the busy state | Yes. Each caller has `catch` and `finally`. One network error stops the wait (deferred minor, MUST FIX). |
| 7 | `docs/deploy.md` matches the scripts | Mostly. Step 10 omits the tunnel restart. The note "if a step fails, the units stay stopped" is wrong for a failure in the pull or the backup. Nothing says that dev mode needs `npm run worker` (Important 2). |

## Issues

### Critical

None.

### Important

1. **Two routes still call Claude or compile in the web request.**
   - `src/app/api/outreach/route.ts:47,57,155,222`: the referral flow calls `publishCv`, which runs
     `buildCv` with the compile on (`src/lib/cv.ts:68`), plus a Drive upload and 1 or 2 Claude calls.
     `maxDuration = 300` stays.
   - `src/app/api/jobs/[id]/route.ts:25`: `GET` (first open of a job) and `POST {reanalyse}` call
     `analyseJob` in the request.
   - Why: spec 4.1 puts job analysis and the résumé compile in the worker. The plan did not name these
     2 routes, so this is a plan gap, not an implementer fault. A LaTeX compile in the web process is
     the case that the worker exists to remove.
   - Fix: enqueue an `analysis` task (with `force`) from `jobs/[id]` and return the task ID, or at
     least move the `publishCv` call of the referral flow to a `cv` task and send the message after
     it ends. If this must wait, record a ruling and move it to part 5 by name.

2. **Without systemd, no worker runs.** `scripts/start.sh`, `scripts/remote.sh` and `npm run dev` do
   not start `npm run worker`. Every refresh, CV build and import stays `queued`, and the UI waits
   15 minutes and then shows "did not finish in time". The owner's own Pi procedure
   (`CLAUDE.local.md`: "the Pi rebuilds them with `npm ci` and `./scripts/start.sh`") would hit
   this on the first sync after the merge.
   - Fix: start the worker in `remote.sh` and `start.sh` (and stop it in their `stop`), or add a
     `dev:all` script. Say in `SETUP_WITH_CLAUDE.md` and `docs/deploy.md` that dev mode needs
     `npm run worker`.

3. **A slow or hung handler stops the whole queue, and the health check still says `ok`.**
   `runOnce` has no time limit (`src/lib/tasks/worker.ts:205-207`). The board fetches have no
   `AbortSignal` (`src/lib/sources/feed-fetch.ts:57`, `src/lib/sources/index.ts:64,258,332,433,471`),
   and neither do the Drive calls (`src/lib/gdrive.ts`). The Anthropic client keeps its default
   10-minute timeout with 2 retries. The heartbeat runs on its own `setInterval`
   (`worker.ts:247`), so `/api/health` reports the worker `ok` while it waits. `requeueStale` runs
   only between tasks, so it cannot free a task that the live worker holds.
   - Fix: race each handler against a limit below `STALE_MS` (for example 8 minutes) and treat the
     timeout as a normal failure. Add `AbortSignal.timeout(30_000)` to the board and Drive fetches.
     Optionally, report `degraded` when a task is `running` longer than `STALE_MS`.

4. **A retry can repeat a paid Claude call and duplicate writes.**
   - `worker.ts:206-215`: `completeTask` is inside the `try`. If it throws (for example
     `SQLITE_BUSY` after the 5-second timeout), the catch calls `failTask`, and the handler runs
     again in 1 minute, after its Claude call and its writes already succeeded.
   - `draftsFromResume` (`src/lib/profile/resume-import.ts:225-227`), `draftsFromRepo`
     (`src/lib/profile/github-import.ts:175-177`) and `refineCv` (`src/lib/cv.ts:131-175`) call
     `askJson` without the cache, and then write. A failure after the call (draft write, chat
     write, Drive upload) is a normal error, so the retry calls Claude again. The retry of a
     github or résumé task after `createDrafts` succeeded makes a second set of drafts. A refine
     adds the chat turn twice (deferred Task 6 minor).
   - `analysis` is safe: it uses `askJsonCached`, so a retry hits the cache.
   - Fix: separate the handler result from the bookkeeping. If `completeTask` fails, retry
     `completeTask` (or log it and leave the row for `requeueStale`), but never call `failTask` for
     a handler that returned. In the 3 uncached handlers, convert any error that comes after a
     successful `askJson` into `TaskFatal` (with a fixed message), or store the reply first and
     reuse it on the retry.

5. **A task that escapes `runOnce` can run forever.** `requeueStale` (`queue.ts:123-133`) puts a
   `running` task back to `queued` with no check of `attempts`, and `claimNext` adds 1 each time.
   `failTask` is the only place that sets `failed`. So a task that kills the worker process (an
   unhandled rejection, an out-of-memory), or whose error makes `failTask` itself throw (a DB error,
   or `String(err)` on an object with no prototype), comes back every 10 minutes with no end, and
   each run can spend Claude credit.
   - Fix: in `requeueStale`, set `failed` (with a fixed `lastError`) when `attempts` is more than
     `RETRY_DELAYS_MS.length`. Wrap the `catch` body of `runOnce` in its own `try` and log.

6. **Interactive tasks wait behind bulk analysis.** `claimNext` orders only by `runAt` and
   `createdAt`. One refresh queues up to 25 `analysis` tasks for each user, at 10 to 30 seconds
   each. A "Generate CV", a refine or an import that the user starts after that waits for all of
   them: several minutes, and more when 2 users refresh. A reasonable user expects the button
   that they just pressed to run first.
   - Fix: add a `priority` column (or order by `kind = 'analysis'` last) so `cv`, `resume-import`,
     `github-import` and `refresh` go before `analysis` and `maintenance`.

7. **Task failures are not logged, and the raw error goes to the client.** The `catch` in `runOnce`
   writes `lastError` but logs nothing (`worker.ts:208-216`), so `journalctl` never shows why a task
   failed. `taskView` sends `lastError` to the client for a `failed` task (`src/lib/tasks/view.ts:245`).
   For a non-fatal error this is raw text, for example a Prisma message with source paths and
   query details. `handle()` keeps exactly this kind of text on the server for a 500.
   - Fix: log each failure with the task ID, kind and `err`. Store the message of a `TaskFatal` as
     it is, but store a fixed text ("The task failed. The server log has the details.") for any
     other error.

### Minor (new in this review)

1. `deferTask` keeps `attempts`, but the next `claimNext` adds 1, so each deferral uses up a retry
   (`queue.ts:67,115-120`; the test at `tests/tasks-queue.test.ts:144` pins `attempts = 2`).
   Decrement `attempts` in `deferTask`.
2. Nothing removes `done` and `failed` rows from `Task`. Each refresh adds about 26 rows for each
   user, and `result` holds personal data (CV views, draft counts). Add a prune of rows older than
   30 days to the `maintenance` handler.
3. `scripts/deploy.sh:22-23` runs `npm run backup` after `git pull` but before `npm ci`, so the new
   backup code runs with the old `node_modules`. If a new commit adds a package to the import graph
   of `scripts/backup.ts`, the deploy stops (safely, with the units still running), and the trap
   message says the units are stopped. Run the backup before the pull.
4. The résumé upload is now deleted after a successful import (`handlers.ts:149-171`). The old code
   kept it in `imports/`. Nothing reads it, so this is fine, but it is a silent behaviour change.
5. `restoreBackup` imports `@/lib/db`, whose `dbReady` opens the target database with
   `PRAGMA journal_mode=WAL` during the swap (`src/lib/backup.ts:7`, `src/lib/db.ts:13-20`). Pass the
   client in, or import `db` lazily in `backupNow` only.
6. The backup file name uses the UTC date (`backup.ts:34-36`), but the timer runs at 03:00 local
   time. In a zone east of UTC+3, the 03:00 backup gets the date of the day before.
7. `runTask` keeps polling after the component unmounts, each 1.5 seconds for up to 15 minutes.
   Each poll is a session lookup on the Pi. Part 6 (SWR) can add an abort signal.
8. A `cv` task that runs while its user deletes the account can create `data/users/<id>/resumes`
   again through `userDir`, after `removeUserDir`.
9. `waypoint-worker.service` has `TimeoutStopSec=90`, but a Claude call or a compile can take longer.
   A deploy then kills the task, and it comes back only after 10 minutes with one attempt used.

## Rulings

I agree with all the rulings in the ledger except the 2 below, which I would amend, not reverse.

| Ruling | Judgement |
|---|---|
| `registerHandler<P>(kind, schema, h)` | Agree. |
| Retries after 1, 5, 30 min; `failed` on the 4th failure | Agree. |
| `next start` with the normal build, not standalone | Agree. `next start` cannot serve a standalone build. |
| `/api/state` split and SWR in part 6; ETags now | Agree. |
| `deploy.sh` runs the backup before the migration | Agree, but **amend**: run it before `git pull` too (Minor 3). |
| Fixed unit names; second copy out of scope | Agree. The docs caution covers it. |
| Test-only `scope` and `beatId` parameters | Agree. The cost is small and the comments say "tests only". |
| Bad result JSON shows as `failed` | Agree. |
| Cap deferral to `claudeStatus().resetsAt` | **Amend**: also keep `attempts` (Minor 1). |
| `FeedFetch` keys; global table | Agree. |
| A failed board does not start the 6-hour skip | Agree. |
| Keep "Refresh feeds" label | Agree. |
| Union of the countries of all active users | Agree. |
| `FeedFetch` writes only after jobs are stored | Agree. |
| Adzuna query key raised to Important | Agree. It was a real cross-user leak. |
| PDF route does not compile; 404 or base PDF | Agree. |
| User-facing CV errors are fatal | Agree. |
| 409 for another CV action while a task is open | Agree. |
| Résumé uploads in `imports/` | Agree. |
| GitHub dedupe key includes the user name | Agree. |
| `tar` 7.5.22 instead of 7.4.3 | Agree. A known-vulnerable pin is worse than a deviation from the constraint. |
| Restore fails closed | Agree. |
| Restore through a sibling folder | Agree. |
| Raise Task 11 minors 1, 3, 5 | Agree. |
| `@CHECKOUT@` and `@NODE_BIN@` placeholders | Agree. |
| Backup service: no `[Install]`, no `Restart=` | Agree. |
| `deploy.sh` stops the worker and web before `npm ci` | Agree. This is safer than the spec text. |
| Raise Task 12 minors 1, 2, 3 | Agree. |

## Triage of the deferred minors

MUST FIX = before the merge. CAN WAIT = part 5 (prompts and prompt safety), part 6 (UI/UX, SWR and
devices), or later.

| # | Task | Deferred minor | Triage |
|---|---|---|---|
| 1 | 1 | Dedupe transaction untested for 2 parallel calls | CAN WAIT (later) |
| 2 | 1 | No `status: 'running'` guard in complete/fail/defer; `attempts = 0` reads index -1 | CAN WAIT (later; one worker). Fix it together with Important 4. |
| 3 | 1 | Pragma test reads a file property | CAN WAIT (later) |
| 4 | 1 | `FeedFetch.error` length; `beat` `startedAt` | CAN WAIT (later) |
| 5 | 1 | Heartbeat test writes the shared row | CAN WAIT (fixed by `beatId`) |
| 6 | 2 | `failAtOnce` writes the DB directly | CAN WAIT (later) |
| 7 | 2 | Late-heartbeat race in test cleanup | CAN WAIT (later) |
| 8 | 2 | `registerHandler` overwrites; `as never` cast | CAN WAIT (later) |
| 9 | 3 | `runTask` stops polling on one network error | **MUST FIX.** Phones on the zrok tunnel lose a poll often. The task continues, but the UI shows an error, and a user who uploads the résumé again pays for a second import (no dedupe on `resume-import`). Retry a poll 3 times before it fails. |
| 10 | 3 | Timeout one interval early; unchecked `as T`; null-user row | CAN WAIT (part 6) |
| 11 | 4 | Progress lookup tie on equal `createdAt` | CAN WAIT (later) |
| 12 | 4 | `queueAnalysis` queues nothing during a cap | CAN WAIT (later) |
| 13 | 4 | `handlers.ts` / `worker.ts` import cycle | CAN WAIT (later; works because `TaskDeferred` is used only at call time) |
| 14 | 4 | Sequential enqueue for each job | CAN WAIT (later) |
| 15 | 5 | No test that a failed row does not start the skip | CAN WAIT (later) |
| 16 | 5 | "304 keeps the jobs" test asserts nothing | CAN WAIT (later) |
| 17 | 5 | Double `recordFailure`; update on a 304 with no row throws | CAN WAIT (later) |
| 18 | 5 | Skipped boards make the toast read "0 new, 0 live" | **MUST FIX.** The main screen states a false fact ("0 live") after any refresh within 6 hours of another refresh, which is the normal case with 2 users. Count the live jobs from the database, or say "boards checked less than 6 hours ago were skipped". |
| 19 | 5 | Settings load fails whole if `/api/feeds` fails | CAN WAIT (part 6) |
| 20 | 5 | "Every country is paused." literal repeated | CAN WAIT (later) |
| 21 | 6 | A retried refine can add the chat turn twice and call Claude twice | **MUST FIX**, as part of Important 4. |
| 22 | 6 | Empty refine message not refused at the route; stale comment | CAN WAIT. The route refuses an empty message now (`refine/route.ts:20`); only the comment is left. |
| 23 | 6 | `enqueueCv` check and insert not in one transaction | CAN WAIT (fixed in fix round 2) |
| 24 | 6 | Busy error (500) instead of 409 under write contention | CAN WAIT (later) |
| 25 | 7 | 2 repos with Rust give 2 drafts with slug `rust` | CAN WAIT (later; merge on accept) |
| 26 | 7 | `maxDuration = 300` no longer needed in 2 import routes | CAN WAIT (later) |
| 27 | 7 | Payload `name` stored but never read | CAN WAIT (later) |
| 28 | 7 | Route cap check does not count waiting import tasks | CAN WAIT (later; the handler checks the cap before the Claude call, so no credit is lost) |
| 29 | 7 | LinkedIn zip route keeps `maxDuration = 300` | CAN WAIT (later) |
| 30 | 8 | `/api/state` ETag changes each minute | CAN WAIT (part 6) |
| 31 | 8 | Cache size counts characters, not bytes | CAN WAIT (later) |
| 32 | 8 | Cache test rows not removed | CAN WAIT (later) |
| 33 | 8 | No ETag cross-user test; no 304 test for `/api/profile` | CAN WAIT (later) |
| 34 | 8 | Unscoped prune sorts without an index | CAN WAIT (later) |
| 35 | 9 | Weak "secret" assertion; thin redaction tests; `key` redaction too wide | CAN WAIT (later) |
| 36 | 9 | Secrets in nested error properties and `"token":"x"` text not scrubbed | CAN WAIT (part 5, with the secret handling there) |
| 37 | 10 | No test for the Claude check; degraded paths untested; cwd fallback; `WAYPOINT_USERS_DIR` read from `process.env` | CAN WAIT (later) |
| 38 | 11 | Archive read twice; add a filter on extract too | CAN WAIT (later; the admin supplies the file) |
| 39 | 11 | `SAFE_PATH` refuses a space; error should print the path | CAN WAIT (later) |
| 40 | 11 | Pre-restore copies and the rclone remote never pruned | CAN WAIT (documented) |
| 41 | 11 | Weak same-date assertion; no tests for odd path entries | CAN WAIT (later) |
| 42 | 11 | Backup files are written with mode 644 | **MUST FIX.** Each backup holds every user's password hash, encrypted secrets and private files. `mkdirSync(..., { mode: 0o700 })` does not change a folder that exists already. `chmodSync(file, 0o600)` after each write is 2 lines. |
| 43 | 11 | No recovery message if the DB rename fails after the users swap | CAN WAIT (later) |
| 44 | 11 | Doc comment `backup.ts:196-198` out of date; pre-restore users folders never pruned | CAN WAIT (later; fix the comment when you touch the file) |
| 45 | 12 | Install message; order test; no `TimeoutStopSec` for zrok | CAN WAIT (later) |
| 46 | 12 | ERR trap says the units stay stopped for a failure before the stop | CAN WAIT. Fix it with Minor 3 of this review. |
| 47 | 13 | `.env` caution is a paraphrase | CAN WAIT (later) |
| 48 | 13 | 2-copies caution does not say `deploy.sh` refuses another checkout | CAN WAIT (later) |
| 49 | 13 | Step 10 omits the tunnel restart | CAN WAIT (later) |
| 50 | 13 | Blank line in a test; long doc sentences | CAN WAIT (later) |

Deferred minors marked MUST FIX: 4 (rows 9, 18, 21, 42).

## Declined to judge

- The worker canary self-test (spec section 9, line 439): part 5 owns prompt safety.
- The `/api/state` split and SWR: ruled into part 6.
- The analysis handler marks a task `done` when Claude fails, because `analyseJob` stores a
  heuristic and counts a try. This is the old behaviour, and the try counter bounds it.
- `output: 'standalone'`: ruled out by the plan, with a sound reason.
- Live checks of the units, the timer and the tunnel: the constraints forbid running them here.
- Browser checks of the Settings card and the Jobs button: the ledger notes them as owed. I did not
  run a browser.

## Assessment

**Ready to merge? With fixes**

**Reasoning:** The queue, the handlers, user isolation, the feed cache, backup and restore are sound
and well tested. But 2 routes still do slow work in the request. Dev mode and `start.sh` run no
worker. The worker has no time limit and no bound on a task that escapes `runOnce`. A retry can
repeat a paid Claude call. Fix Important 1 to 7 (Important 1 may move to part 5 by an explicit
ruling) and the 4 MUST FIX minors before the merge.

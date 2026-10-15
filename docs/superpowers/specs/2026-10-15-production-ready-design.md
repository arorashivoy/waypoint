# Waypoint production version: design

- **Date:** 2026-10-15
- **Branch:** `prod` (from `main` at `ddbda11`)
- **Status:** approved in conversation, section by section. This file waits for a written review.

## 1. Purpose and scope

Waypoint is a prototype for one person. This design changes it into a production version for a
small group of invited users (fewer than 20), on the Raspberry Pi that runs it now.

### 1.1 Decisions from the brainstorm

| Topic | Decision |
|---|---|
| Users | A small invited group. The admin makes invite links. There is no open sign-up. |
| Host | The Raspberry Pi. No cloud host. |
| Database | SQLite, in WAL mode, with Prisma migrations. |
| Domain | The zrok reserved name (`https://<name>.shares.zrok.io`), without basic auth. |
| Approach | Change the current app in place (Next.js 14, Prisma). Not a rewrite. |
| Auth | Own module: argon2id password hashes and sessions in the database. No auth library. |
| Claude cost | The user's own key, then the server's key up to a cap for each user, then the admin's Pro subscription (admin only). |
| Model | Sonnet only, for all calls. Never Opus. |
| Profile store | Database tables for each user. `claims.yml` is an import and export format for all users. |
| Profile sources | Résumé upload (AI drafts), LinkedIn export, GitHub, in-app editor, YAML. |
| Résumé output | Built-in LaTeX templates for all users, plus an own `.tex` file for users who want one. |
| UI | Simpler job detail, Resume and Profile merged, Countries moved to Settings, an onboarding wizard. |
| Devices | Phones, tablets (iPad) and desktops, each with its own layout. |

### 1.2 Out of scope

- Open sign-up, email sending and email checks.
- A cloud host, Postgres and more than one server.
- An offline mode.
- Automatic job applications. Waypoint never submits an application.

### 1.3 Your current data

The migration keeps your current data. Your user row becomes the admin account. Your
`claims.yml` goes into the database for your account (section 3.5). Your applications, contacts,
outreach events and résumé files stay and get your `userId`.

### 1.4 Build order

The parts depend on each other in this order. Each part gets its own implementation plan.

1. Foundation: config, `exec.ts`, the Claude client, SQLite WAL and migrations (sections 4 and 6).
2. Accounts and data isolation (section 2).
3. Profile storage and imports (section 3).
4. Worker, caching, hosting and backups (section 4).
5. AI prompts and prompt safety (sections 5 and 6).
6. UI/UX and devices (sections 7 and 8).

## 2. Accounts, sessions and data isolation

### 2.1 Users and roles

- `User` gets these fields: `passwordHash` (argon2id through `@node-rs/argon2`, which has arm64
  builds), `role` (`admin` or `member`), and `disabledAt`.
- `npm run user:create-admin` creates the first admin. The first migration changes the current
  user row into the admin account and asks for a password.
- **Invites:** the admin makes an `Invite`. The token is 32 random bytes. The database keeps only
  the SHA-256 hash of the token. An invite is valid for 7 days and works one time. The new user
  sets a name and a password.
- **Passwords:** 12 characters or more. The app refuses the 10,000 most common passwords (a list
  in the repo).
- **Password reset:** there is no email. The admin makes a reset link, with the same rules as an
  invite, and sends it to the user.
- Users can change their own password. A change signs out all their other sessions.
- The admin can disable a user. A disabled user cannot sign in, and their sessions end at once.

### 2.2 Admin-only actions

Only the admin can:

- make invites and password reset links,
- disable and enable users,
- see the list of users and their use of the shared API key,
- use the Pro subscription through the `claude` CLI.

All other features, including YAML import and export, are available to every user, and each
feature works on that user's own data only.

### 2.3 Sessions

- `Session` table: `id`, `tokenHash` (SHA-256), `userId`, `expiresAt`, `createdAt`,
  `lastSeenAt`, `userAgent`.
- The cookie holds a random 32-byte token, not the user ID. It is `httpOnly`, `Secure`,
  `SameSite=Lax` and `Path=/`.
- A session lasts 30 days. Each request moves `expiresAt` forward, at most one database write each
  hour for each session.
- `requireUser()` is the one helper that all API routes use. `requireAdmin()` is used by the admin
  routes.
- Next.js middleware sends a signed-out page request to `/login`. The middleware checks only that
  the cookie exists. The route handler checks the session in the database.
- Settings shows the user's sessions. The user can end one or all of them.
- The cookie name stays port-specific (`SESSION_COOKIE` in `user.ts`), so 2 copies on one Pi do
  not share sessions.

### 2.4 Removed

- `WAYPOINT_ACCESS_CODE` and `src/lib/access.ts` (the passcode is replaced by real accounts).
- The LinkedIn OIDC sign-in (`/api/auth/linkedin/*`). It gave only a name, an email and a photo.
- The basic-auth layer on the zrok share.
- `/api/auth/local`.

### 2.5 Abuse limits

- **Sign-in:** 10 tries in 15 minutes for each IP address and for each email. The counts are in a
  `RateLimit` table, so they survive a restart. The IP address comes from `X-Forwarded-For` behind
  the tunnel. The email limit protects the account even if the IP header is false.
- **Invite and reset tokens:** 20 tries in 15 minutes for each IP address.
- **CSRF:** all POST, PUT, PATCH and DELETE requests must have an `Origin` header that matches the
  app's own origin. The cookie is `SameSite=Lax`.
- **Uploads:** 10 MB for a résumé, 50 MB for a LinkedIn `.zip`, 1 MB for a YAML file. The server
  checks the content type and the file signature (magic bytes), not only the extension.

### 2.6 Data isolation

| Data | Owner |
|---|---|
| `Job` | Global. Postings are public data. |
| `JobAnalysis(userId, jobId)` | User. It replaces `Job.analysis`, `analysedAt` and `analysisTries`. |
| Profile tables (section 3) | User |
| `Application`, `OutreachEvent` (through `Application`), `Contact`, `CountryPref` | User |
| `UserSettings` (fields, visa status, résumé template, own `.tex`) | User |
| Résumé files | User, in `data/users/<userId>/` |
| Drive tokens, GitHub token, Anthropic key | User, encrypted (section 2.7) |
| `LlmUsage` | User |
| `LlmCache` | Global and content-addressed. The prompt contains the user's profile, so a key cannot match across users. |
| `FeedFetch` | Global |

- Each API route gets a test. The test makes 2 users and checks that user B cannot read, change or
  delete rows that belong to user A. The response for a row of another user is `404`, not `403`,
  so the response does not show that the row exists.
- File paths for user files come only from the session's `userId` and IDs that the server makes.
  A user can never supply a path.

### 2.7 Secrets for each user

- The app encrypts each user's Anthropic key, GitHub token and Drive refresh token with
  AES-256-GCM. The key is `WAYPOINT_SECRET_KEY` (32 bytes, base64) in `.env`.
- Each value has its own random 12-byte IV. The database row holds the IV, the auth tag and the
  ciphertext, plus a key version number for a future key change.
- The app never sends a secret back to the browser. Settings shows only the last 4 characters.

### 2.8 Claude calls: which credential

For each call, the app uses the first of these that is available:

1. The user's own Anthropic API key.
2. `ANTHROPIC_API_KEY` from `.env`, while the user's cost this month is below
   `WAYPOINT_SHARED_MONTHLY_USD` (default 5).
3. The admin's Claude Pro subscription through the `claude` CLI. **Only for the admin.**

If none is available, the AI features show "Add an API key in Settings" and the heuristic analysis
stays in use. A member never uses the admin's subscription, because a Pro subscription is for one
person.

This changes the current order. Today the CLI comes first. In the new order, an API key in `.env`
wins over the CLI.

- `LlmUsage` keeps one row for each call: `userId`, `credential` (`own`, `shared` or `cli`),
  `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `costUsd`, `kind` and `createdAt`.
  CLI calls record tokens if the CLI JSON gives them, and a cost of 0.
- Settings shows the user's use this month. The Admin section shows the use of the shared key for
  each user.

## 3. Profile storage and imports

### 3.1 Tables

The database is the store for profile data. The tables follow the current `ClaimsDoc` shape in
`src/lib/claims.ts`. All have a `userId`, and all slugs are unique for each user.

| Table | Fields |
|---|---|
| `ProfileMeta` | `name`, `headline` |
| `Position` | current fields, plus `slug` |
| `PositionBullet` | `positionId`, `slug`, `text` (full text, for built-in templates), `match` (a phrase that finds the bullet in an own `.tex`), `order` |
| `Education` | current fields, plus `slug`, `aliases` (JSON) |
| `ProjectItem` | current fields, plus `slug`, `bullets` (JSON), `tex`, `source` (`manual`, `github`, `resume`, `linkedin` or `yaml`), `repoUrl` |
| `Claim` | `slug`, `kind`, `label`, `aliases` (JSON), `value`, `scaleMax`, `higherIsBetter` |
| `ClaimLink` | `fromId`, `toId`, `rel`, `w` |
| `ClaimEvidence` | `claimId`, `target` (for example `project:recipebert` or `position:gs-analyst/validator`), `depth`, `proof`, `since` |
| `ClaimMention` | `claimId`, `surface`, `url`, `listed` |
| `ProfileRevision` | `snapshot` (JSON of the full `ClaimsDoc`), `note`, `createdAt` |
| `ProfileDraft` | `source`, `type`, `data` (JSON), `status` (`pending`, `accepted` or `rejected`), `warnings` (JSON), `matchesId` |

### 3.2 Read and validate

- `loadProfileDoc(userId)` builds a `ClaimsDoc` from the tables. It replaces `loadClaims()` and
  `profileSummary()`. The result is cached in memory for each user. Each profile write clears the
  cache for that user.
- The validation code in `claims.ts` stays as one shared function, `checkDoc(doc)`. The app runs it
  before each profile write, on YAML import, and in `npm run check:claims`. If the check finds
  errors, the write is refused and the UI shows the errors.
- Each accepted profile change writes a `ProfileRevision`. The UI shows the history, and the user
  can restore a revision. A restore also writes a revision.

### 3.3 Imports go through drafts

No importer changes the profile directly. Each one writes `ProfileDraft` rows. The Imports tab
shows each draft with Accept, Edit and Reject. If a draft matches an item that exists (same slug,
or a similar title), the tab shows a merge view.

| Source | Steps |
|---|---|
| Résumé (PDF or `.tex`) | 1. Extract the text (`pdftotext -layout` for PDF; for `.tex`, remove the macros). 2. Find hidden text (section 6.4). 3. Run the injection scan. 4. Claude drafts positions, bullets, education, projects and claims. 5. Each claim and bullet must give a quote from the source text. The server checks that the quote exists in the text and drops a draft whose quote does not exist. |
| LinkedIn `.zip` | Positions, education and skills become drafts. `Connections.csv` goes directly into `Contact`, because contacts are not profile claims. A new import no longer replaces the profile. |
| GitHub | The user enters a username, and optionally a personal access token (encrypted) for private repos. The app reads the repos, topics, languages and the first 4 KB of each README, with ETags. The user selects repos. Claude drafts a project and its claims for each one, with the quote rule. Forks are marked, and they are not selected by default. |
| YAML | The app validates the file with `checkDoc` and shows a diff against the current profile. If the user accepts, it replaces the whole profile and writes a revision first. Every user can do this for their own profile. |

- **YAML export:** every user can download their profile as `claims.yml` at any time.

### 3.4 Editor

- Forms for positions, bullets, education, projects and claims.
- A claim form has an evidence picker: the target, the depth (`mentioned`, `used` or `built`) and
  a proof sentence of 200 characters or fewer.
- The forms check fields as the user types, with the same rules as `checkDoc`.

### 3.5 Migration of your claims.yml

`npm run migrate:claims -- --user <email> --file data/profile/claims.yml` does these steps:

1. Validate the file with `checkDoc`.
2. Write the tables for that user, in one transaction.
3. Export the tables to YAML and compare the result with the original, as parsed data. If the 2
   are different, roll back and print the difference.

After this, the `claims.yml` sync rule in `CLAUDE.local.md` does not apply to the `prod` branch.
It stays correct for `main`.

## 4. Hosting, storage, caching and the worker

### 4.1 Processes

Each process is a `systemd` user unit, with `Restart=on-failure` and start at boot
(`loginctl enable-linger`).

1. `waypoint-web`: `next start` from a build with `output: 'standalone'`.
2. `waypoint-worker`: a Node process that runs tasks from the `Task` table: feed refresh, job
   analysis, résumé compile, GitHub fetch and profile drafts.
3. `waypoint-tunnel`: `zrok2 share` on the reserved name, without basic auth. Before it starts,
   it releases a stale share that holds the name (the current `zrok_holder` logic in
   `remote.sh`).

- `scripts/remote.sh` stays for dev mode only.
- `scripts/deploy.sh` runs `git pull --ff-only`, `npm ci`, `prisma migrate deploy`,
  `npm run build`, and then restarts the 3 units. If a step fails, the script stops and does not
  restart the units.

### 4.2 Task queue

- `Task` table: `id`, `kind`, `userId`, `payload` (JSON), `status` (`queued`, `running`, `done` or
  `failed`), `runAt`, `attempts`, `lastError`, `createdAt`, `updatedAt`.
- The worker takes one task at a time with an atomic update (`status = running` where
  `status = queued`). One task at a time is enough on the Pi, and it keeps the Claude use low.
- A failed task runs again after 1, 5 and then 30 minutes. After 3 failures, its status is `failed`.
- If the worker stops, a `running` task older than 10 minutes goes back to `queued`.
- The worker writes a heartbeat row each 30 seconds.
- The UI reads the progress from this table. This replaces the in-memory queue in `queue.ts`, so
  a restart does not lose work.

### 4.3 Database

- SQLite with `journal_mode=WAL`, `busy_timeout=5000` and `foreign_keys=ON`, set on each
  connection.
- `prisma migrate` replaces `prisma db push`. Each schema change is a migration file in the repo.
- JSON columns stay as text. Each one has a TypeScript type and a `zod` schema. The app checks the
  value with the schema when it reads it.

### 4.4 Backups

- A `systemd` timer runs each night at 03:00. It runs `npm run backup`, which writes a copy of the
  database with `VACUUM INTO 'data/backups/<date>.db'` through Prisma (the Pi has no `sqlite3`
  CLI), and packs `data/users/` into a `.tar.gz` with Node.
- It keeps 14 daily and 8 weekly copies.
- Optional: `rclone` copies the backup to Google Drive if `WAYPOINT_BACKUP_REMOTE` is set.
- `npm run restore -- <file>` restores a backup. It refuses to run while `waypoint-web` or
  `waypoint-worker` is active.

### 4.5 Caching

| What | Design |
|---|---|
| Model replies | `LlmCache`, keyed on a hash of (model, prompt version, system prompt, prompt). A size limit removes the least recently used rows when the table is larger than 50 MB. |
| Job board fetches | `FeedFetch` table: `board`, `etag`, `lastModified`, `fetchedAt`, `status`. A refresh skips a board that it fetched in the last 6 hours, unless the user forces it. A request sends `If-None-Match` and `If-Modified-Since`. |
| Profile document | In memory for each user. A profile write clears it. |
| API responses | `/api/state` is split into routes for each screen. Each route sends an `ETag`. The client uses SWR: it shows cached data at once and fetches again in the background. |
| Compiled résumés | `data/users/<userId>/resumes/<hash>.pdf`. The hash covers the template, the content and the steer, so the same input does not compile again. |

### 4.6 Operations

- `GET /api/health` needs no sign-in. It returns one `ok` or `degraded` flag for each check: the
  database, the worker heartbeat, a Claude credential, and free disk space above 1 GB. It returns
  no personal data, names or versions.
- `GET /api/admin/health` (admin only) returns the details of each check.
- Logs are JSON lines through `pino` into `journald`. Each request has an ID. The logger removes
  passwords, tokens, keys and cookies.
- `src/lib/env.ts` checks the environment with `zod` at start. If a required key is missing, the
  process does not start, and the log names the key. Required: `DATABASE_URL`,
  `WAYPOINT_SECRET_KEY`.

## 5. AI prompts

### 5.1 Problems in the current prompts

1. The prompts contain values for one person: `replyPrompt` names 8 fixed countries, and the
   `field` list follows one person's interests.
2. The fit check is yes or no for each requirement, with no evidence, against a flat profile
   block. The server cannot check it.
3. Nothing finds blockers (citizenship, clearance, language, location), old postings or spam
   postings.
4. The JSON is found in free text and repaired after (`extractJson`, `text()`, `normalise()`).
5. One model is pinned, and the API path does not use prompt caching.

### 5.2 Job check

It replaces `analysePrompt`.

**Input:** the user's claims (slug, label, depth, proof), the user's countries, fields and visa
status from `UserSettings`, and the posting.

**Output** (a `zod` schema):

- `requirements[]`: `text`, `importance` (`must` or `nice`), `status` (`met`, `partial` or
  `missing`), `evidence` (claim slugs).
- `blockers[]`: `type` (`citizenship`, `clearance`, `language`, `location`, `seniority` or
  `other`) and `quote` (from the posting).
- `legitimacy[]`: flags such as `no-company`, `pay-to-apply`, `reposted`, `vague-role`.
- `level`, `mode`, `sponsor`, `visa`, `field` (from the user's field list).
- `summary`: one line, 25 words or fewer.

**Server checks:**

- A `met` or `partial` status whose evidence slugs are not in the user's profile becomes
  `missing`.
- A blocker whose quote is not in the posting is removed.

**Match score:** code computes it, not the model. `must` items weigh 3 and `nice` items weigh 1.
`met` counts 1, `partial` counts 0.5, `missing` counts 0. Each blocker removes 25 points, and the
minimum is 0. The level fit and the field fit from `match.ts` stay. The UI shows how the score was
made.

The heuristic analysis stays for users with no Claude credential, and it uses the same output
shape.

### 5.3 Résumé

- **Selection** stays the main method. The model selects and orders the user's own project, bullet
  and skill IDs. This works for the built-in templates and for an own `.tex`.
- **Wording suggestions** (new): the model can propose a new wording for a bullet, to use the
  words of the posting. Each suggestion names the claim slugs that support it. The server rejects
  a suggestion that has a number, a name or a technology that is not in the source bullet or in
  the proofs of those claims. The user accepts or rejects each suggestion. The app never applies a
  suggestion without approval.
- **Keyword report** (new): the terms of the posting that the résumé contains, and the terms that
  the user has evidence for but that the résumé does not contain.

### 5.4 Built-in templates and own .tex

- The first built-in template comes from the current `resume.cls`. The template code renders the
  profile (with the steer) into LaTeX. Every value is escaped (section 6.5).
- A user who uploads an own `.tex` file uses the current tailoring code in `resume.ts`
  (`tailorTex`, `tailorExperience`, `tailorSkills`). The bullet `match` fields find the bullets.
- `UserSettings.resumeMode` is `template` or `own-tex`.

### 5.5 Other prompts

- Profile drafts (résumé, GitHub, LinkedIn): new prompts, with the quote rule from section 3.3.
- Referral, alumni and reply prompts: the logic does not change. The prompts use the user's
  countries and settings in place of fixed values.

### 5.6 Calls and models

- **Sonnet only.** All tasks use one model ID, from one constant in `claude.ts`. The client
  refuses a call whose model ID does not start with `claude-sonnet-`, for the API and for the CLI.
  A unit test checks this.
- The CLI always gets `--model` explicitly, so the CLI default (which can be Opus on some plans)
  is never used. The CLI self-test (section 6.2) checks the model name in the CLI JSON reply.
- The model moves from `claude-sonnet-5` to the latest Sonnet (`claude-sonnet-5-5`) only after
  `npm run eval` passes on it. The plan checks the current model IDs with the `claude-api` skill.
- **API mode:** use the official `@anthropic-ai/sdk` package, not raw `fetch`. Each task sends its
  `zod` schema as a structured output (`client.messages.parse` with
  `output_config.format = zodOutputFormat(schema)`). Sonnet 5.5 refuses a forced tool call
  (`tool_choice` `any` or `tool` returns HTTP 400), so the design does not use one. Each task sets
  `output_config.effort` explicitly (`low` for labels and slots, `medium` for the job check and
  résumé work). The profile block goes first in the system prompt with `cache_control`, so a
  refresh of 50 jobs pays for the profile only one time.
- **No refusal fallback.** The server-side `fallbacks` option can send a refused request to an
  Opus model, so the app never sets it. A response with `stop_reason: "refusal"` is a failed
  call, and the task records the refusal category.
- **CLI mode:** `extractJson`, then a `zod` check, then one repair retry if the check fails.
- Each prompt has a `promptVersion`. The version is part of the cache key.

### 5.7 Prompt tests

`npm run eval`:

- About 25 fixed postings: postings that fit and do not fit, postings with blockers, spam
  postings, and injection attempts from each source (section 6.7).
- Each posting has expected labels.
- 2 profiles: the admin's profile and a synthetic profile in the repo.
- The output is the pass rate for each check.
- The run uses real Claude calls, so CI does not run it. Run it before each prompt change.

## 6. Prompt and command safety

### 6.1 Rule

All text from users, postings, messages, imports and model replies is data. It goes to Claude, and
the reply comes back. A reply can select only from actions that the app already has. It cannot add
an action or change the arguments of an action. No text from a user, a posting or a model runs a
command on the Pi.

### 6.2 Claude CLI with no tools

Today `askViaCli` runs `claude -p --append-system-prompt …` in the project folder, with the default
tools, the project's `CLAUDE.md` files and the full server environment. The new call:

- `--tools ""` (no built-in tools)
- `--strict-mcp-config` with an empty MCP config (no MCP servers)
- `--setting-sources ""` (no user, project or local settings, so no hooks and no plugins)
- `--no-session-persistence`
- `--system-prompt` (ours only), in place of `--append-system-prompt`
- `--model <sonnet id>` and `--output-format json`
- `cwd`: a new empty temporary folder for each call, deleted after the call. With the empty
  folder, `--setting-sources ""` and `--system-prompt`, no `CLAUDE.md` reaches the model
  (checked on 2026-10-15).
- Not `--bare`: it turns off the subscription login (checked on 2026-10-15: "Not logged in").
- environment: only `PATH`, `HOME`, `LANG` and `CLAUDE_CODE_OAUTH_TOKEN`
- `spawn(cmd, argsArray)`, never a shell; the prompt goes through stdin

These flags were checked with Claude Code 2.1.300 on 2026-10-15. The CLI JSON reply has a
`modelUsage` object whose keys are the model IDs that ran, and `num_turns`.

**Self-test:** when the worker starts, it sends one canary prompt that asks the model to use a
tool and to name its model. If the reply shows that a tool ran, or the model is not Sonnet, the app
turns off CLI mode and logs an error.

### 6.3 Trust tiers

| Tier | Sources | Treatment |
|---|---|---|
| Ours | Prompt text in the code | Instructions |
| The user's own words | Refine requests, settings, profile text that the user typed or accepted | Fenced as `<request>` or `<profile>`. It can steer the task. It cannot change the output schema or the rules. |
| Third party | Postings, messages, contacts, uploaded résumé text, READMEs, LinkedIn fields, YAML before review | Fenced as `<untrusted>`. Data only. |

- **Typed prompt builder:** all prompts use one `prompt()` builder. Each interpolated value must
  use a wrapper (`untrusted()`, `profile()` or `request()`). A unit test fails if a prompt module
  puts a raw string into a prompt.
- **Output schemas:** a field never holds a command, a path, a URL to fetch, a LaTeX macro or a
  file name. Fields hold IDs from a closed list, enum values, or text for display. The server maps
  each value to code that exists.
- A person approves every profile change, every wording change, and every message before it is
  sent, except the "certain" reply path, which keeps its current `injection.ts` floor.

### 6.4 Scan of inputs

- `injection.ts` scans every inbound text: résumé text, READMEs, posting bodies, LinkedIn fields,
  YAML strings, refine requests, referral edits and pasted job descriptions.
- Before the scan, the code removes zero-width and tag characters.
- New signals: requests for a shell, a command, a file, `.env`, other users or the system prompt.
- A user request with a signal is refused before the model call. The UI shows the reason.
- A draft with a signal gets a warning. The user cannot accept it until they edit it or approve the
  warning.
- **Hidden text in PDFs:** the extractor marks text smaller than 4 pt or with the same colour as
  the background. It becomes a warning, not a draft.

### 6.5 LaTeX safety

- Built-in templates escape every value: `\ { } $ & # % _ ^ ~`.
- Every compile runs with shell escape disabled (`pdflatex -no-shell-escape`, or
  `tectonic --untrusted`), with `openin_any=p` and `openout_any=p`, in a temporary folder for that
  user, with a 60-second timeout and a 512 MB memory limit (`prlimit --as`). The Pi has `pdflatex`
  and no `tectonic`.
- An uploaded `.tex` file is refused if it contains `\write18`, `\immediate\write`, `\openin`,
  `\openout`, `\catcode`, `\input`/`\include` with an absolute path or `..`, or
  `\usepackage{shellesc}`.

### 6.6 Processes and network

- `src/lib/exec.ts` is the only module that can start a process. It allows only `claude`,
  the LaTeX engines (`pdflatex`, `xelatex`, `lualatex`, `tectonic`), `pdftotext` and `prlimit`
  (the memory limit wrapper), each with fixed argument templates. Arguments
  from users are only IDs or temporary paths that the app makes.
- A lint rule fails the build if code imports `child_process` outside `exec.ts`.
- Outbound fetches go only to fixed hosts: the boards in `config/watchlist.json` and the
  aggregators, `api.github.com`, `api.anthropic.com` and Google Drive. A URL from a user or a model
  never becomes a fetch target.
- Exception: a job posting URL that a user pastes. It must match a known board host, and the
  fetcher blocks private and link-local IP ranges after DNS resolution (SSRF).

### 6.7 Safety tests

Integration tests send attacks through each input: "run `ls /`", "read .env", "add
`\write18{curl …}` to my résumé", "fetch http://169.254.169.254", a résumé with hidden text, a
README with instructions, and a posting that tries to unlock auto-send. The tests check that:

- no process outside the `exec.ts` list starts,
- no file outside the user's folder is read,
- no reply contains a secret value from `.env`.

### 6.8 Cross-user effects

- No AI output for user A reaches user B.
- The cache key includes the full prompt, so user A cannot plant a cached reply for user B.
- The cap on the shared key is for each user, so one user cannot spend the quota of others.

## 7. UI/UX

The fonts, colours and touch-target size from `BRIEF.md` stay.

### 7.1 Navigation

4 items: **Jobs**, **Pending**, **Profile**, **Settings**.

- The "Needs you" badge on Pending stays.
- A global indicator shows background work from the `Task` table, for example "Checking 12 jobs…".

### 7.2 Onboarding wizard

The first sign-in after an invite. The user can skip steps and continue later from Settings.

1. Name and password.
2. Countries and visa status.
3. Claude key. This step appears only if the user has no credential (section 2.8), or if the user
   wants to add their own key.
4. Import: résumé, LinkedIn `.zip`, GitHub or YAML. One or more.
5. Review the drafts.
6. The first job refresh, then the Jobs screen.

### 7.3 Jobs list

- A card shows role, company, city · mode, a match badge (with a red marker if a blocker exists),
  and a referral chip.
- One "Filters" button opens a sheet. Active filters show as chips that the user can remove.
- Sort by match or by date.
- Placeholder cards while data loads. An empty list says what to do next.

### 7.4 Job detail

From top to bottom:

1. **Header:** role, company, match, "Open posting".
2. **Fit:** the summary line, a blocker banner if any, the top 3 `must` requirements with status
   and evidence, and "Show all".
3. **Referral:** the best contact and the reason, the note editor with the character counter,
   "Send request".
4. **Résumé:** build or rebuild, PDF preview, refine chat, wording suggestions, keyword report.
5. **Sticky action bar:** "Mark applied".

### 7.5 Profile

Tabs: Experience · Projects · Claims · Imports (drafts, with a count badge) · Résumé (template or
own `.tex`, revision history).

### 7.6 Settings

Sections: Account (password, sessions) · Claude (key, use against the cap) · Job search
(countries, boards, fields, visa) · Integrations (GitHub, Drive) · Data (YAML import and export,
delete account) · Admin (users, invites; admin only).

### 7.7 Code structure

- Split `JobsScreen.tsx` (693 lines) and the other large screens into small components, one
  purpose each.
- UI primitives: `Button`, `Card`, `Sheet`, `Tabs`, `Field`, `Badge`, `EmptyState`, with CSS
  variables for the design tokens. No large UI library.
- SWR for each route.
- Errors and confirmations appear next to the action, not only as toasts.

### 7.8 Accessibility

- Visible focus rings.
- A label on each field.
- Keyboard access for sheets and tabs.
- Colour contrast of 4.5:1 or more for text.

## 8. Phones, tablets and desktops

### 8.1 Layouts

CSS media queries and container queries select the layout. `useIsPhone()` is removed, so the
layout does not change after the page loads.

| Layout | Width | Devices | Navigation | Jobs |
|---|---|---|---|---|
| Phone | < 640 px | iPhone, Android phones | Bottom tab bar | List, then detail on a full screen with Back |
| Tablet | 640–1023 px | iPad portrait (768–834 px), small laptops | Icon rail on the left | List, with detail as a side panel over it |
| Desktop | ≥ 1024 px | iPad landscape (1024–1366 px), laptops, monitors | Full sidebar, can collapse | Split view: list left, detail right |

| Screen | Phone | Tablet | Desktop |
|---|---|---|---|
| Pending | Stacked sections | 2 × 2 grid | 4 columns |
| Sheets (filters and others) | Bottom sheet | Side panel | Side panel |
| Profile, Settings | Tabs at the top | Section list on the left | Section list on the left |
| Forms | 1 column | 1 column (portrait) | 2 columns |

### 8.2 Input

- Every action works without hover. Hover styles apply only under `@media (hover: hover)`.
- Touch targets are 44 px or more under `@media (pointer: coarse)`.
- Keyboard shortcuts on desktop and on an iPad with a keyboard: `/` search, `j`/`k` next and
  previous job, `Esc` close a sheet.

### 8.3 iOS and Safari

- Text fields use 16 px text or more, so Safari does not zoom on focus.
- `100dvh` in place of `100vh`. The safe-area padding stays (`viewport-fit=cover`).
- The PDF preview uses `pdf.js`, because Safari on iOS shows only the first page of a PDF in an
  `iframe`. "Open" and "Download" buttons are next to the preview.
- File inputs have `accept` attributes for `.pdf`, `.tex`, `.zip` and `.yml`.
- A rotation keeps the open job and the scroll position.

### 8.4 Home-screen app (PWA)

- A web manifest, icons (192 px, 512 px, and an Apple touch icon) and a theme colour, so the app
  opens without browser bars from the home screen of iOS, iPadOS and Android.
- No service worker cache and no offline mode.

### 8.5 Device tests

- Playwright smoke tests for sign-in, the wizard, the job detail and the résumé build, on these
  profiles: iPhone 15, Pixel 7, iPad (portrait), iPad (landscape), iPad Pro 12.9", and a 1440 px
  desktop.
- The iPhone and iPad profiles use the WebKit engine.
- A manual checklist in `docs/` for a real iPhone and a real iPad: the on-screen keyboard over
  forms, the Files picker for each upload type, the home-screen app, rotation, and the PDF preview.

## 9. Error handling

| Case | Behaviour |
|---|---|
| No Claude credential | Heuristic analysis. A banner says "Add an API key in Settings". |
| Claude auth or quota failure | The current banners stay (`claudeAuthFailure`, `claudeQuotaFailure`), for each credential. |
| Shared key cap reached | The user's AI tasks wait. Settings shows the cap and the date of the reset. |
| Model output fails the schema | One repair retry. Then the task fails and the heuristic result stays. |
| LaTeX compile fails | The last good PDF stays. The UI shows the first 20 lines of the log, with no paths outside the user's folder. |
| Board fetch fails | `FeedFetch.status` records it. The other boards continue. The board shows a warning in Settings. |
| Worker stops | Tasks stay `queued`. `/api/health` reports `degraded`. `systemd` restarts the worker. |
| Profile write fails `checkDoc` | The write is refused, and the form shows each error next to its field. |

## 10. Testing

- **Unit tests** (Vitest): auth (hash, sessions, invites, rate limits), encryption, `checkDoc`,
  the YAML round trip, the match score, the server checks on model output, LaTeX escape and the
  `.tex` refusal rules, the model-ID check, and the typed prompt builder.
- **Isolation tests:** 2 users for each API route (section 2.6).
- **Safety tests:** section 6.7.
- **Prompt tests:** `npm run eval` (section 5.7), run by hand.
- **Device tests:** Playwright (section 8.5).
- CI runs unit, isolation, safety and Playwright tests on each push to `prod`.

## 11. New environment keys

| Key | Required | Purpose |
|---|---|---|
| `WAYPOINT_SECRET_KEY` | Yes | AES-256-GCM key for secrets of each user (32 bytes, base64) |
| `ANTHROPIC_API_KEY` | No | The shared key. If set, it wins over the CLI subscription (section 2.8). |
| `WAYPOINT_SHARED_MONTHLY_USD` | No (default 5) | Monthly cap for each user on the shared API key |
| `WAYPOINT_BACKUP_REMOTE` | No | `rclone` remote for backups |
| `WAYPOINT_ZROK_NAME`, `WAYPOINT_ZROK_NAMESPACE` | No | Kept from `remote.sh` |

Removed: `WAYPOINT_ACCESS_CODE`, `WAYPOINT_ZROK_AUTH_FILE`, `LINKEDIN_CLIENT_ID`,
`LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`. `RESUME_PDF` and `RESUME_TEX` move into the
admin's settings during the migration.

**Caution:** do not overwrite the Pi's `.env` during deploy. Add each new key on the Pi by hand.

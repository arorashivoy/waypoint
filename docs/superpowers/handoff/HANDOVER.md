# Waypoint handover: the Pi session owns the work from here

Written on 2026-10-21 by the cloud session at the end of its work. From now on, only the local Claude Code session on the Pi works on Waypoint. The cloud session has stopped. All of its agents are stopped, and nothing is left running.

Start Claude Code in the worktree and say: "Read docs/superpowers/handoff/HANDOVER.md and continue." This file replaces LOCAL-RESUME.md and the cloud brief in README.md. Read this file to the end before you do anything.

## 1. Who, where and the rules

- The owner is Shivoy. Start every reply with "Shivoy". Write all prose in ASD-STE100: replies, docs, code comments, UI text, commit messages and PR text. Use simple words, active voice, short sentences, one instruction in each sentence, and warnings that start with a command.
- Repository: `arorashivoy/waypoint`. Worktree: `/home/shivoy/waypoint-shivoy/.claude/worktrees/prod`, on branch `multi-user`. The folder is named `prod`, but the branch is `multi-user`. The auto mode check blocks a branch named `prod`, so do not make one.
- Draft PR #2 is `multi-user` → `main`. Never merge it, and never push to `main`. Only the owner merges and deploys.
- The live app runs from `/home/shivoy/waypoint-shivoy` (branch `main`, port 3118, zrok).
  - Never touch that folder, its `.env` or its `data/`. The one exception: you may read a copy of `data/profile/claims.yml`.
  - Never touch any `data/waypoint.db`.
  - Never use ports 3117 or 3118. UI checks use port 3150 with a scratch database.
- For runs that need a database, use a scratch SQLite file in the session scratchpad. Run tsx without `--env-file`, so the worktree `.env` is never read.
- Commit trailers: `Co-Authored-By: Claude <model name> <noreply@anthropic.com>` and `Claude-Session: <session URL>`. PR bodies end with "🤖 Generated with [Claude Code](https://claude.com/claude-code)" and the session URL.
- Safety rules that always apply:
  - The app sends every Claude call to Sonnet only (`MODEL` is `claude-sonnet-5-5`). Never set `fallbacks`.
  - Nothing that a user, a posting, a file or a model writes may run a command. Only `src/lib/exec.ts` starts processes, with fixed argument templates.
  - User, posting, import and model text render as React text only. Never use `dangerouslySetInnerHTML` or `innerHTML`.
  - Every API route uses `handle()` and `requireUser` or `requireAdmin`. A row of another user gives 404. Each route is in the 401 table in `tests/isolation.test.ts`.
- Do not run `next build` while a dev server runs on the same folder. Both use `.next`, so delete `.next` after a build before you start a dev server.
- Never deploy. The owner deploys with `scripts/deploy.sh` and `docs/deploy.md`.

## 2. First step: get the cloud work

The cloud session could not push to `multi-user`. All of its work is on `origin/claude/epic-lovelace-0vqgu7`, at the commit that adds this file. That branch is a fast-forward of `multi-user`.

```
git fetch origin
git log --oneline origin/multi-user..origin/claude/epic-lovelace-0vqgu7 | wc -l   # about 80 commits
git diff --stat origin/multi-user origin/claude/epic-lovelace-0vqgu7 -- package.json
git merge --ff-only origin/claude/epic-lovelace-0vqgu7
npm ci              # postinstall copies the pdf.js worker to public/pdfjs
npx prisma generate
git push origin multi-user
```

After this, `multi-user` holds everything, and PR #2 shows it. From then on, work on `multi-user` only. You can ignore the cloud branch.

## 3. The project and its state

The goal is a production-ready, multi-user Waypoint for a small invited group on the Pi. The spec is `docs/superpowers/specs/2026-10-15-production-ready-design.md`. It has 6 parts, and **all 6 parts are now built and reviewed**.

| Part | Plan | Ledger and final review | State |
|---|---|---|---|
| 1 Foundation | `plans/2026-10-15-prod-part1-foundation.md` | — | Done |
| 2 Accounts | `plans/2026-10-16-prod-part2-accounts.md` | — | Done |
| 3 Profile | `plans/2026-10-16-prod-part3-profile.md` | `handoff/part3-final-review.md` | Done |
| 4 Worker, hosting | `plans/2026-10-17-prod-part4-worker.md` | `handoff/part4-ledger.md`, `part4-final-review.md` | Done |
| 5 AI prompts and safety | `plans/2026-10-17-prod-part5-prompts.md` | `handoff/part5-ledger.md`, `part5-final-review.md` | Done; the Pi checks passed (`pi-steps-2026-10-20.md`, `pi-steps-2026-10-20b.md`) |
| 6 UI/UX and devices | `plans/2026-10-20-prod-part6-ui.md` | `handoff/part6-ledger.md`, `part6-final-review.md` | Done in the cloud; **the Pi checks are owed** (section 4) |

The ledgers hold every ruling, with its cost if wrong. Treat a ruling as a decision already made. If you reverse one, write down why.

### Part 6 in short

- **Look:** a dark, calm "night route" theme in mint `#A6E4C4` and lavender `#C4B6F4` on `#121019`, with glass panels, soft glows and a dot grid. The owner chose these colours.
  - The fonts are Syne (headings, scores; never under 20 px) and Onest (body). They are self-hosted in `src/app/fonts/` under the SIL OFL, so a build needs no network.
  - All tokens are in `src/app/globals.css`. The admin style page `/design` shows them, and a test checks 4.5:1 contrast for every text colour.
  - Any UI work must load the `frontend-design` skill and follow the "Visual direction" section of the part 6 plan. A UI change is done only when it works AND looks right at 390, 820 and 1440 px.
- **Calm by default:** a job row shows the role, the company and city, and the score; a fourth line appears only for a referral or a blocker. The job detail shows the summary and the top 3 requirements on a route. "Your way in" and "Your CV" are folded panels. Each screen has one main action.
- **Places:** Jobs, Pending, Profile (with a Résumé tab) and Settings (with a Job search section).
  - Phone: a floating tab bar.
  - Tablet: an icon rail, with the job as a side panel.
  - Desktop: a sidebar with a split view; from 1024 to 1279 px it is the rail.
  - Layouts come from CSS only. The open job lives in the URL.
- **Code:**
  - UI primitives are in `src/components/ui/`. The screens are in `src/components/{jobs,job,pending,profile,settings,onboarding,shell}/`.
  - Data loads with SWR hooks in `src/components/data.ts`. `/api/state` is gone; the routes are `/api/me`, `/api/jobs/list` and `/api/pending`.
  - Profile writes send the version from the moment the edit started. A stale tab gets a 409.
- **Onboarding wizard:** migration `7_onboarding` adds it for invited users. The migration marks existing users as set up, and the admin keeps `RESUME_TEX`.
- **Device tests:** `npm run test:e2e` runs Playwright on 6 profiles. The checklist and the WebKit steps are in `docs/devices.md`. The harness (`tests/e2e/setup/`) runs the app from a scratch copy with no `.env`, on 127.0.0.1 only, with random passwords.

### Test state at hand-over (cloud, Ghostscript 10.02.1)

- `npm test`: 1690 pass, 1 skip, 0 fail.
- Typecheck and lint: clean (0 errors, 0 warnings).
- `next build`: passes with the network blocked.
- `WAYPOINT_E2E_CHROMIUM_ONLY=1 npm run test:e2e`: 31 pass, 5 skip (the two-tab test runs on the desktop project only).

## 4. Owed now on the Pi (do these first)

Write the results to `docs/superpowers/handoff/pi-steps-<date>.md`, commit, and push `multi-user`.

1. **Unit tests and the build:**
   - `npm test`: all must pass on the Pi's Ghostscript 10.0.0 and TeX Live 2022.
   - `npm run typecheck` and `npm run lint`.
   - With no dev server running: `next build` with a scratch `DATABASE_URL` and a test `WAYPOINT_SECRET_KEY`. Then delete `.next`.
2. **WebKit device tests:**
   - One time: `npx playwright install webkit` and `npx playwright install-deps webkit`.
   - Then `npm run test:e2e` with no env set. The iPhone and iPad projects then use WebKit.
   - Fix any failure, or write it down with the screenshot.
3. **The manual checklist in `docs/devices.md`** on a real iPhone and iPad, through a temporary HTTPS link (as for the part 5 iPhone check, `pi-steps-2026-10-20b.md`). Check:
   - the keyboard over forms,
   - the Files picker for `.pdf`, `.tex`, `.zip` and `.yml`,
   - add to the home screen (the icon, no browser bars),
   - rotation keeps the open job,
   - the PDF preview,
   - the tab bar above the home indicator.

   Also look at every screen as a user, and write down anything ugly, busy or hard to read.
4. **Before the deploy** (the owner does the deploy):
   - Back up the database.
   - `prisma migrate deploy` applies `6_pasted_by` and `7_onboarding`, if they are not applied yet.
   - Then the owner opens Settings → Job search and saves the fields. Add Backend to keep the old order, because the fixed "Backend 0.6" field fit is gone.
   - Read `docs/deploy.md`.

## 5. Open items (not done; pick them up after section 4)

From `part6-final-review.md`, section "Minor", numbers 4 and 7–13. The fix wave closed 1, 2, 3, 5 and 6.

- M4: the CV fold says "Add an API key in Settings to use Claude." 2 times. Show it one time, above the Claude tools.
- M7: the route summary for screen readers counts only the top 3 shown. Say "Top 3: …", or count all requirements.
- M8: one action has 2 names: "Open posting" (`JobHeader.tsx`) and "Open the posting" (`ApplyBar.tsx`). Use "Open the posting".
- M9: Profile puts its sections in glass panels, and Settings puts them on the ground. Use one treatment for both.
- M10: spec 8.1 and the plan layout block still say "full sidebar from 1024 px". Update them to "rail from 1024 to 1279 px, sidebar from 1280 px".
- M11: `PdfPreview.tsx` `getDocument`: add `isEvalSupported: false` (defence in depth).
- M12: a phone in landscape (844 × 390) shows the job as a tablet panel, and the bars take about 40 % of the height. Under `(max-height: 500px)`, make the apply bar static.
- M13: dead code: `rethrowForUser` in `src/lib/cv.ts`, and anything that the Toast change left unused (`useToast`, `.toast`).

From the triage table of `part6-final-review.md` ("CAN WAIT" rows):

- The contrast test checks solid colours only.
- `TaskIndicator` is not an always-mounted live region.
- The wizard's skipped mark lives in component state, so a reload forgets it.
- No unit test covers the skip of the last wizard step.
- No e2e test covers a LaTeX compile failure.
- A renamed bullet ID leaves claim drafts pointing at the old bullet.
- The fixture test does not pin the words after the ligature words.

## 6. Parked risks (decided; the guard is named)

- **PDF hidden text, the Type3 class** (part 5 ledger lines 152–154, widened in `part6-ledger.md`, Task 12).
  - The risk: a crafted PDF with Type3 glyphs that draw a black bar over white text can put a short chosen phrase into an import draft.
  - The guards: the text stays fenced and never acts as instructions; the quote rule and the injection scan run on it; the user approves each draft.
  - 64 probe PDFs in `tests/fixtures/ligature/` pin the leak at the parked level. Do not widen it.
  - After any Ghostscript upgrade, run `npx vitest run tests/profile-extract*.test.ts` before the deploy.
- **Pasted jobs and DNS rebinding:** the guard is the allowlist of 6 fixed public board API hosts (`src/lib/net/safe-fetch.ts`).
- **A shared pasted job:** a second user's paste makes the job visible to all users in its country, at most 20 times each hour per user (part 5 ledger).

## 7. How to work

- **Process:** one plan for each piece of work. Run it task by task, with one implementer and one reviewer per task, scoped re-reviews after each fix round, at most 5 fix rounds, rulings instead of stalls, and a ledger file for each plan.
  - Use the superpowers skills if the Pi has them (`superpowers:subagent-driven-development`, `writing-plans`, `finishing-a-development-branch`).
  - The part 6 ledger shows the pattern.
- **Subagents:**
  - Model choice: Sonnet for implementers. Opus for reviews of security-sensitive work: prompts, file paths, process starts, fetch targets, PDF and LaTeX input, migrations and auth.
  - Run only one UI agent at a time, because two dev servers in one folder share `.next`.
  - Tell every agent to stage its own files by exact path. In part 6, one agent's commit swept in another agent's unfinished work.
- **Vitest** runs test files in parallel on ONE shared database:
  - Tests make their own users and rows, and never delete rows they did not make.
  - Use the `scope` / `beatId` options of the queue and worker functions.
  - Use unique test country codes (`XT` + random hex), not the 26 `X` + letter codes.
- **UI check on the Pi:**
  - Start a dev server on port 3150 with a scratch database (`prisma migrate deploy`, then `scripts/create-admin.ts` with piped input, then seed rows), and take Playwright screenshots at 390, 820 and 1440 px.
  - The e2e global setup (`tests/e2e/setup/`) shows a safe way to start the app with only the keys it needs.
  - The sign-in API allows about 8 tries in a few minutes. Sign in one time and reuse the storage state.
- **After any change that adds a dependency or touches build config:** run `next build` once with no dev server, then delete `.next`.
- **Claude calls on the Pi:** use the CLI subscription (`WAYPOINT_CLAUDE_BIN=/home/shivoy/.local/bin/claude`, no `ANTHROPIC_API_KEY`) and a scratch database.
  - For the admin profile, use a scratch admin plus `migrate:claims` from a copy of the live `claims.yml`.
  - Read each eval failure by hand before you report it.

## 8. Where things are

- Plans: `docs/superpowers/plans/`. Spec: `docs/superpowers/specs/`. Ledgers, reviews and Pi results: `docs/superpowers/handoff/`.
- Visual direction mock: `design/part6/direction.html`, with screenshots `design/part6/*.png`.
- Deploy: `docs/deploy.md`. Devices: `docs/devices.md`. Eval: `eval/README.md`.
- The git-ignored `.superpowers/` folder of the cloud session (task briefs, per-task reviews, screenshots) is not on the Pi. Everything that matters is in the ledgers and final reviews above.

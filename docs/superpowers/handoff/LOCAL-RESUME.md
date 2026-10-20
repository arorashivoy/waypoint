# Resume brief for a new local session (on the Pi)

Start Claude Code in `/home/shivoy/waypoint-shivoy/.claude/worktrees/prod` and say: "Read docs/superpowers/handoff/LOCAL-RESUME.md and continue." This file replaces the long earlier chat. It holds only what the next session needs.

## Who and where

- The owner is Shivoy. Start every reply with "Shivoy". Write all prose in ASD-STE100 (see `~/.claude/CLAUDE.md`).
- Repo `arorashivoy/waypoint`. Work only in the worktree above, branch `multi-user`, draft PR #2 (`multi-user` → `main`). The worktree folder is named `prod`, but the branch is `multi-user`; a branch named `prod` is blocked by the auto mode check.
- The live app runs on this Pi from `/home/shivoy/waypoint-shivoy` (branch `main`, port 3118, zrok). Never touch that folder, its `.env`, its `data/` (except to read a copy of `data/profile/claims.yml`), or ports 3117/3118. Never touch any `data/waypoint.db`.
- For runs that need a database, use a scratch SQLite file in the session scratchpad, and run tsx without `--env-file` so the worktree `.env` is never read (see the scripts pattern in `pi-steps-2026-10-20.md`).

## The work so far

- Goal: a production-ready, multi-user Waypoint in 6 parts (spec `docs/superpowers/specs/2026-10-15-production-ready-design.md`). Parts 1–4 are done. Part 5 (AI prompts and prompt safety, plan `docs/superpowers/plans/2026-10-17-prod-part5-prompts.md`) is done up to its final review; a cloud session did Tasks 11–14 and the part 5 final review. Part 6 (UI/UX and devices) has no plan yet.
- The cloud session continues the plan; it reads `docs/superpowers/handoff/README.md`. It cannot push to `multi-user`; it pushes to `claude/epic-lovelace-0vqgu7`, and the local session fast-forwards `multi-user` to it (`git fetch origin`, `git merge --ff-only origin/<branch>`, `npx prisma generate`) after a quick look at the commit list and `package.json`.
- The local session does only what needs the Pi: real Claude CLI runs, the real eval, browser checks on port 3150 with a scratch database, LaTeX/Ghostscript test runs, and anything that reads `.env`, the live `claims.yml` or `RESUME_TEX`. It writes the results to a file in `docs/superpowers/handoff/`, commits, and pushes `multi-user`.
- Records: `docs/superpowers/handoff/part5-ledger.md` (all rulings and deferred items), `part5-final-review.md`, `part3-final-review.md`, `part4-final-review.md`, `part4-ledger.md`, and the local results `pi-steps-2026-10-20.md` and `pi-steps-2026-10-20b.md`.

## State on 2026-10-20 (HEAD `13eb9d5` on `multi-user`, pushed)

- Tests on the Pi: 1250 of 1253 passed before `lmodern`. The owner installed `lmodern`; `tests/resume-template.test.ts` now passes 36 of 36.
- CLI canary: passed.
- Eval, second run after the fix (`pi-steps-2026-10-20b.md`): sonnet-5-5 passes on the synthetic and the admin profile; sonnet-5 fails (one real fake-blocker miss, two injection fails just over `maxRatio`). No injection worked. The cloud session makes the model move.
- Browser checks: all 5 passed. The iPhone referral copy passed on 2026-10-20 (`pi-steps-2026-10-20b.md`).

## Next steps for the local session

2. When the cloud session asks again (a message the owner pastes): fast-forward to its branch, run the steps it names, write a new `pi-steps-<date>.md`, commit, push `multi-user`, and give the owner a short message to paste back to the cloud session.
3. The eval runs: copy the pattern in `pi-steps-2026-10-20.md` — a scratch database, `WAYPOINT_CLAUDE_BIN=/home/shivoy/.local/bin/claude`, no `ANTHROPIC_API_KEY`, and for the admin profile a scratch admin user plus `migrate:claims` from a copy of the live `claims.yml`. Read each failure by hand before you report.

## Rules

- Commit trailers: `Co-Authored-By: Claude <model> <noreply@anthropic.com>` and `Claude-Session: <session URL>`. Push only to `multi-user`; never to `main`; never merge PR #2; never deploy (the owner deploys with `scripts/deploy.sh` and `docs/deploy.md`).
- The app sends every Claude call to Sonnet only. Nothing a user, posting, file or model writes may run a command; only `src/lib/exec.ts` starts processes.
- Do not run `next build` while a dev server runs on the same folder.

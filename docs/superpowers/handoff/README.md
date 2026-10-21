> **Ended on 2026-10-21.** The cloud session has stopped. The local session on the Pi owns all work now. Read `docs/superpowers/handoff/HANDOVER.md`. The text below is the old cloud brief, kept for the record.

# Handoff: production-ready Waypoint, part 5 from Task 11

Give this file to a Claude Code cloud session. It tells that session how to continue the work that a local session on the owner's Raspberry Pi started.

## 1. What to read first

1. This file, to the end.
2. `docs/superpowers/specs/2026-10-15-production-ready-design.md` — the spec. It is the binding authority.
3. `docs/superpowers/plans/2026-10-17-prod-part5-prompts.md` — the part 5 plan. Tasks 1–10 are done. Continue at Task 11.
4. `docs/superpowers/handoff/part5-ledger.md` — the part 5 ledger: every ruling, every deferred minor, every parked finding. Treat the rulings as decisions already made. Do not reverse a ruling without a strong reason. If you reverse one, record why.
5. `docs/superpowers/handoff/part5-constraints.md` and `implementer-instructions.md` — the rules that bind every task. Some lines name a scratch folder under `/tmp/claude-1001/…` on the Pi. In the cloud, use your own scratch folder in place of it.
6. For the final review only: `part3-final-review.md` and `part4-final-review.md` (their tables of deferred items marked "CAN WAIT (5)" and "CAN WAIT (6)"), and `part4-ledger.md`.

## 2. State on 2026-10-19

- Repository `arorashivoy/waypoint`, branch `multi-user`, draft PR #2 (`multi-user` → `main`). Part 5 Task 10 ends at commit `b087971`.
- Parts 1–4 are done and reviewed. Part 5 Tasks 1–10 are done and reviewed (see the ledger). Part 6 (UI/UX and devices, spec sections 7 and 8) has no plan yet.
- Test gate at `b087971`: `npm test` 71 files and 977 tests pass, `npm run typecheck` is clean, `npm run lint` has 0 errors and 2 known warnings (in `JobsScreen.tsx` and `Waypoint.tsx`; they stay).

## 3. What to do, in this order

1. **Part 5 Task 11 — CLI self-test at worker start.** Write the code and the tests with a mocked CLI. Then STOP and ask the owner (section 5): the real canary needs the Claude CLI login on the Pi.
2. **Part 5 Task 12 — pasted job URLs.** The owner asked for this feature. All of it works with mocked `fetch` and mocked `dns.lookup`. Never fetch a real board host from a test.
3. **Part 5 Task 13 — safety tests.**
4. **Part 5 Task 14 — prompt eval.** Do Steps 1–2 (fixtures, `scripts/eval.ts`, `--dry-run`, commit). Step 3 (real calls and the model move) is local: STOP and ask the owner.
5. **Part 5 final review.** Follow the method in section 4: one whole-branch review on the most capable model over the part 5 range (`git merge-base` is the commit before `e2c7c04`; use `da0be55..HEAD`). Point the reviewer at the ledger's "minor (deferred)" and "parked" lines. Then one fix wave and one scoped re-review.
6. **Browser checks owed (local).** STOP and ask the owner (section 5).
7. **Finish part 5.** Push `multi-user`, and update the PR #2 description with a part 5 section, in the same style as parts 1–4. Report to the owner: a summary, the full list "Rulings I made" (every `Ruling:` line of the ledger, in order, each with its cost if wrong), the deploy notes, and the options to integrate (keep draft PR #2 open is the expected choice).
8. **Part 6.** Write the part 6 plan with the superpowers writing-plans skill from spec sections 7 and 8, plus every "CAN WAIT (6)" item in the part 3 and part 4 final reviews and the part 5 deferred minors that name part 6. Ask the owner to review the plan before you code it. Then run it the same way.
   - **Use the `frontend-design` skill for part 6 (owner's order, 2026-10-20).** The owner finds the current UI very poor. Load `frontend-design` before you write the plan, and use it to set one clear visual direction: type, colour, spacing, layout for phone, tablet and desktop, and states (empty, loading, error). Put that direction in the plan as its own first task, and tell each implementer subagent that touches the UI to load `frontend-design` too. A part 6 task is not done when it only works; it must also look good. The owner reviews the visual direction with the plan.

## 4. How to work

- Use the superpowers skills: `superpowers:subagent-driven-development` to run a plan (one implementer subagent and one reviewer for each task, scoped re-reviews for each fix round, at most 5 fix rounds, rulings instead of stalls, a ledger file for each plan), `superpowers:writing-plans` for part 6, `superpowers:finishing-a-development-branch` at the end of a part.
- Keep a ledger. Continue `docs/superpowers/handoff/part5-ledger.md` in the git-ignored workspace that the skill makes (`.superpowers/sdd/2026-10-17-prod-part5-prompts/progress.md`); copy the file into the workspace first, then add lines below "Task 10: complete". Before you end the session, copy it back to `docs/superpowers/handoff/part5-ledger.md` and commit it, so the next session has it.
- Model choice for subagents: Sonnet for implementers, Opus for reviews of security-sensitive tasks (prompts, file paths, process starts, fetch targets, PDF and LaTeX input), Haiku or Sonnet for small scoped re-reviews.
- Vitest runs test files in parallel on ONE shared database. Tests make their own users and rows, never delete rows they did not make, use the `scope` / `beatId` test options of the queue and worker functions, and use test country codes `X` + a letter (a new user gets every real country turned on).

## 5. Stop and ask the owner — tasks that need the Pi

The cloud copy has no `.env`, no `data/` folder (no database, no `claims.yml`, no résumé files), no Claude CLI login, no API key, and maybe no LaTeX, Ghostscript or poppler. The owner's Pi has all of them, and it also runs the live app. When a task needs one of the items below, do not fake it, do not create a stand-in secret, and do not skip it in silence. Finish all the other work you can, commit and push, then stop and send the owner a message:

> I need you to run a local step on the Pi: <what, and why>. Run it in your local Claude Code session, and tell me when it is done. Then I continue with <next step>.

| Task | What needs the Pi | What the cloud session does first |
|---|---|---|
| 11 | One real canary run of the Claude CLI (the subscription login is on the Pi). | All code and mocked tests. |
| 14 Step 3 | `npm run eval` with real Claude calls (the owner allows the CLI subscription, which costs no API credit), the admin's profile from the Pi database, and the model move to `claude-sonnet-5-5` only if the eval passes. | Fixtures, `scripts/eval.ts`, `--dry-run`. |
| Browser checks | Headless Chromium on the Pi with a scratch database (port 3150, never 3117 or 3118): the Settings "Job search" card at 360 px (Task 1); the job check screens at 390 and 1440 px (Task 5); the wording suggestions block (Task 8); copying a referral on a real iPhone (Task 9); and later the part 6 device checks. | Nothing; list them in the message. |
| PDF and LaTeX checks | If `gs`, `pdftotext`, `pdftoppm` or `pdflatex` is missing in the cloud, the tests that need them skip. Then ask the owner to run `npm test` on the Pi and send the result. | Say which tests skipped. |
| Anything that reads `.env`, `data/waypoint.db`, `data/profile/claims.yml`, `RESUME_TEX` or `RESUME_PDF` | Only the Pi has them. | Write the code; ask for the run. |
| Deploy | Never deploy from the cloud. `scripts/deploy.sh`, `install-units.sh`, `systemctl`, `zrok2` and `loginctl` run only on the Pi, by the owner. | Keep `docs/deploy.md` correct. |

After the owner says the local step is done, pull `multi-user` (the local session may have pushed commits), read the new ledger lines, and continue.

## 6. Rules that always apply

- Write all prose — replies, docs, code comments, UI text, commit messages, PR text — in ASD-STE100 (simple words, active voice, short sentences, one instruction in each sentence, warnings that start with a command). Start every reply to the owner with the name "Shivoy".
- The app sends every Claude call to Sonnet only. Never change `src/lib/claude/model.ts` to anything that is not `claude-sonnet-…`. Never set `fallbacks`.
- Nothing that a user, a posting, a file or a model writes may run a command. Only `src/lib/exec.ts` starts processes, with fixed argument templates.
- Commit trailers: `Co-Authored-By: Claude <model name> <noreply@anthropic.com>` and `Claude-Session: <the URL of your session>`. PR bodies end with "🤖 Generated with [Claude Code](https://claude.com/claude-code)" and the session URL.
- Push only to `multi-user`. Never push to `main`, and never merge PR #2. A branch named `prod` is blocked by the auto mode check; do not make one.
- Do not run `next build` while a dev server runs on the same folder.

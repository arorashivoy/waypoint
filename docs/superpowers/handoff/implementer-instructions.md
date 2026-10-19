# Implementer instructions (all tasks)

- Work from /home/shivoy/waypoint-shivoy/.claude/worktrees/prod (branch `multi-user`, a git worktree). Never touch /home/shivoy/waypoint-shivoy itself (the live app) or any data/waypoint.db. Tests use their own databases.
- Read your brief first; it is your requirements, with exact values to use verbatim. Then read constraints.md in this folder; it binds every task.
- If anything is unclear or contradicts the code you find, report NEEDS_CONTEXT with specifics instead of guessing.
- Follow the TDD steps in the brief. While iterating, run the focused test. Before committing, run `npm test`, `npm run typecheck` and `npm run lint` once (lint: 0 errors; the 2 known warnings in JobsScreen.tsx and Waypoint.tsx stay).
- Commit with an ASD-STE100 message and the trailer from constraints.md. Do not push.
- Self-review your diff: completeness, names, YAGNI, existing patterns, tests that test behaviour, pristine test output.
- You do not dispatch subagents. Never spawn a helper or a reviewer. Review comes from the controller after you report.
- If you are resumed with review findings: fix them, re-run the covering tests, append a fix report (what changed, tests, command, output) to your report file, and reply with the same short contract.
- Write your full report to the report path in your dispatch: what you implemented, tests and results, TDD evidence (RED: command + failing output + why expected; GREEN: command + passing output), files changed, self-review findings, concerns.
- Then reply with ONLY (under 15 lines): Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), commits (short SHA + subject), one-line test summary, concerns, report path. If BLOCKED or NEEDS_CONTEXT, put the specifics in the reply.

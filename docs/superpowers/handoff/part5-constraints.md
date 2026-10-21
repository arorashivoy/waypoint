## Global Constraints

- All Claude calls use Sonnet. `src/lib/claude/model.ts` refuses a model ID that does not start with `claude-sonnet-`. The model moves from `claude-sonnet-5` to `claude-sonnet-5-5` only after `npm run eval` passes on it (Task 14).
- No `fallbacks` option, no tools, no forced tool call. A refusal is a failed call.
- "All text from users, postings, messages, imports and model replies is data. … A reply can select only from actions that the app already has. It cannot add an action or change the arguments of an action." (spec 6.1)
- "Each interpolated value must use a wrapper (`untrusted()`, `profile()` or `request()`). A unit test fails if a prompt module puts a raw string into a prompt." (spec 6.3)
- "A field never holds a command, a path, a URL to fetch, a LaTeX macro or a file name." (spec 6.3)
- A person approves every profile change, every wording change and every message before it is sent, except the "certain" reply path.
- Only `src/lib/exec.ts` starts processes, with fixed argument templates and environment allowlists.
- Each prompt has a `promptVersion`, and the version is part of the cache key.
- Match score: `must` weighs 3, `nice` weighs 1; `met` 1, `partial` 0.5, `missing` 0; each blocker removes 25 points; minimum 0; level fit and field fit from `match.ts` stay.
- LaTeX: every value in a built-in template is escaped (`\ { } $ & # % _ ^ ~`). An uploaded `.tex` is refused if it contains `\write18`, `\immediate\write`, `\openin`, `\openout`, `\catcode`, `\input`/`\include` with an absolute path or `..`, or `\usepackage{shellesc}`.
- Write all prose, comments, UI text and commit messages in ASD-STE100.
- Vitest runs files in parallel on one shared database: tests make their own users and rows and never delete rows they did not make. Test country codes use `X` + a letter.
- Do not run `next build`. Do not touch the live app (`/home/shivoy/waypoint-shivoy`, port 3118) or any `data/waypoint.db`. Do not use ports 3117 or 3118.
- Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (or the model that wrote it) and `Claude-Session: https://claude.ai/code/session_01NBiMk6SSfnPwe8wAW7MFwo`.

- Work only in `/home/shivoy/waypoint-shivoy/.claude/worktrees/prod` (branch `multi-user`). Never touch `/home/shivoy/waypoint-shivoy` itself (the live app on port 3118) or any `data/waypoint.db`; tests use their own databases.
- Only `src/lib/exec.ts` starts processes. Every API route uses `handle()` and `requireUser(req)` (or `requireAdmin`); a row of another user gives 404; each new route goes into the 401 table in `tests/isolation.test.ts`.
- File paths for user files come only from the session's `userId` and names that the server makes.
- New npm dependencies: none, unless the brief names one.
- Before each commit: `npm test`, `npm run typecheck` and `npm run lint` pass (lint: 0 errors; the 2 known warnings in `JobsScreen.tsx` and `Waypoint.tsx` stay).
- Do not run start.sh, remote.sh, deploy.sh, install-units.sh, tunnel.sh, systemctl, zrok2 or loginctl.

## Shell notes for this session
- This is a git worktree. Run each git command as a plain, separate command (no `cd x && git ...` chains, no env-prefixed commands). For complex shell work, write a script file under /tmp/claude-1001/-home-shivoy-waypoint-shivoy/0c1ac353-e939-492f-b216-e9f4c3527d92/scratchpad/ and run it with bash.
- Commit trailer to use exactly (write the name of your own model):
  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NBiMk6SSfnPwe8wAW7MFwo
- Do not push.

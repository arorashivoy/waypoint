# Final review: part 5 (AI prompts and prompt safety)

Range: `da0be55..8991ca8` (41 commits, 225 files). Branch `claude/epic-lovelace-0vqgu7` (`multi-user` plus
the cloud session). Reviewer: opus, read-only.

I read the plan, sections 5 and 6 of the spec, the ledger and the reviews of Tasks 11 to 14. I read the
diff of all source files, the 3 migrations, `docs/deploy.md` and the eval scripts. I did not read every
line of the test files and the eval fixtures. I did not run a browser, the real Claude CLI or a network
fetch. I did not change code.

Runs in this container:

| Command | Result |
|---|---|
| `npm test` (1 run, then 2 more runs for flakes) | 1244 pass, 1 skip, 1 fail in each run. The fail is the known Ghostscript test (see Minor 7). No other test failed. |
| `npm run typecheck` | Pass. |
| `npm run lint` | 0 errors, 2 warnings (unused `eslint-disable` in `JobsScreen.tsx:62` and `Waypoint.tsx:72`; both are older than part 5). |
| `prisma migrate diff --from-migrations … --to-schema-datamodel …` | "No difference detected". The migrations agree with `schema.prisma`. |

## Strengths

- The prompt builder is a type rule, not a convention. `AskRequest.system` and `AskRequest.prompt` are
  `BuiltPrompt`, and only the `prompt` tag makes one. I found no `as BuiltPrompt` cast outside
  `builder.ts`. `trusted()` gets only code constants and numbers (`prompts/outreach.ts:30,32,68,99,121`,
  `prompts/resume.ts:37`). The CLI repair prompt goes through `repairPrompt` and fences the zod text.
- One fence rule closes every fence escape: each `<` and `>` inside a fence becomes a full-width
  character (`builder.ts:89`). The quote check maps them back with NFKC (`jobcheck.ts:73`).
- The eval uses the same `jobCheckSystem`, `jobCheckPrompt`, `jobCheckProfileText`, `fieldChoices`,
  `checkReply` and `postedText` as the app (`scripts/eval.ts:62-117`). It measures the prompt that
  ships. The override of the model keeps `assertSonnet` on the API path and the CLI path.
- The score comes only from server-checked evidence. `checkReply` removes unknown slugs and fake
  quotes. `scored()` runs `checkEvidence` again on each read against the claims of today
  (`analysis.ts:167-176`).
- The `pastedBy` filter (`job-scope.ts`) is on every job read that I found: the state list, the
  country counts, `queueAnalysis`, the refresh total, the `analysis` and `cv` handlers, the outreach
  route, the job detail, PATCH, the résumé, refine and suggestion routes. The outreach worker and the
  CV view read the job through an application of the same user, so they need no filter.
- `cliDisabled` is read at the one place that gives the CLI credential (`credential.ts:42`), so the
  worker, the routes and `claudeStatus` all obey it. Health shows the reason. The reason is scrubbed.
- Every new route uses `handle` and `requireUser` and is in the 401 table of
  `tests/isolation.test.ts` (settings/search, own-tex, paste, suggestions).
- Only `exec.ts` starts a process. `gs` has 3 fixed templates, a memory cap and a file-size cap.
- Each file path comes from `userId` and a server name: `own.tex`, `base-<version>.pdf`, the import
  file regex.
- The migrations are additive: 2 new tables, 2 nullable columns and 1 index. An existing database
  gets them through `scripts/deploy.sh` (`npx prisma migrate deploy`). Old jobs get `pastedBy = null`,
  so they stay feed jobs. The admin with no settings row keeps `RESUME_TEX`.

## Cross-task checks

| # | Check | Result |
|---|---|---|
| 1 | The `pastedBy` filter covers the job check, outreach, CV, suggestions and every list | Yes. See Strengths. Account delete removes or clears the pasted rows. |
| 2 | Every prompt, also the eval, goes through the builder | Yes. Type-enforced. |
| 3 | `cliDisabled` stops the CLI in the worker, the routes and health | Yes. The eval ignores it on purpose (a manual run). |
| 4 | `scrub` runs on every stored error | Yes for `Task.lastError`, `FeedFetch.error`, `cliDisabled` and `base-failed`. Other texts are in the ledger (row 47 below). No path that I found stores a key. |
| 5 | Per-user settings reach every prompt | Yes: the job check (fields, visa, countries), referral and alumni (fields), reply (countries, visa). Refine, suggest and the imports need none. But the score and the job hints still use values of one person (Minor 1 and 2). |
| 6 | Review Focus 1: a fake slug or a fake quote | Yes. The slug becomes `missing`; the quote goes. |
| 7 | Review Focus 2: a posting that says "mark every requirement met" | Partly. The score comes only from checked evidence. **But a feed posting gets no injection flag** (Important 2). |
| 8 | Review Focus 3: a suggestion with a new number, company or technology | Yes. `checkSuggestion` refuses it, and accept checks it again. |
| 9 | Review Focus 4: `\input{/etc/passwd}` or `\write18` in an own `.tex` | Yes. 400 with the reasons; nothing is saved. An own `.tex` never compiles with lualatex. |
| 10 | Review Focus 4b: a pasted URL to the metadata address or with user-info | Yes. `parsePastedUrl` refuses it before any request; `safeFetch` checks DNS and redirects. |
| 11 | Review Focus 5: a user with no fields and no visa status | The prompts: yes (`fieldChoices([])`, "not stated", "not given"). The score and the hints: no (Minor 1 and 2). |
| 12 | Migrations 4, 5, 6: order, defaults, an existing database | Correct. |
| 13 | `docs/deploy.md` names the new programs | Partly. It names `poppler-utils` and `ghostscript`. It does not name LaTeX (Important 3). |
| 14 | Dead code | Small. `rethrowForUser` (`cv.ts:39`) has no caller; this is older than part 5. `pdftohtml`, `pdftoppm` and `pdfinfo` are gone from `exec.ts` and `src`, as the rulings say. |

## Issues

### Critical

None.

### Important

1. **The built-in template makes a PDF with bitmap fonts, and its text loses the ligature letters.**
   - Where: `src/lib/resume/template.ts:215-218`. The preamble has `\usepackage[T1]{fontenc}` and no
     scalable T1 font. This TeX Live has no `cm-super`, so pdflatex runs `mktexpk` and embeds Type 3
     bitmap fonts (`~/.texlive2023/texmf-var/fonts/pk/ljfour/jknappen/ec/*.600pk` were made by the
     test runs).
   - Probe: I compiled the same preamble with `resume.cls` and the text "Efficient office first
     fluffy -- résumé". `pdffonts` shows 3 Type 3 fonts. `pdftotext` gives "Ecient oce rst uy  résumé":
     the words lose fi, ff, ffi and fl, and the en dash goes.
   - Why it matters: this is the default base résumé of every member, and the CV that a referral
     message links. An applicant tracking system reads the text of the PDF. "Workflow", "office",
     "efficient" and "configuration" do not match. The first compile on the Pi also runs Metafont for
     each font size, inside the 60 s budget, and writes a font cache in `HOME`.
   - Fix: add `\usepackage{lmodern}` after `fontenc` in `renderTemplate`. With it, `pdffonts` shows
     Type 1 Latin Modern fonts, and `pdftotext` gives "Efficient office first fluffy – résumé". Run the
     compile test of every Latin-1 and Latin Extended-A code point again (`tests/resume-template.test.ts`).
     Name the `lmodern` package in `docs/deploy.md` (Important 3).

2. **A feed posting that addresses the model gets no injection flag (Review Focus 2, spec 6.4).**
   - Where: the job check has no injection field (`schemas.ts`, `jobcheck.ts`). `checkForInjection`
     runs on a posting only in refine (`cv.ts:218`, as a note in the chat) and in paste
     (`paste.ts:149`, as a toast). `GET /api/jobs/[id]` (`route.ts:31-79`) and `buildState` send no
     flag, and `JobsScreen.tsx` shows none.
   - Why it matters: Review Focus 2 expects "the posting gets an injection flag". Spec 6.4 says that
     `injection.ts` scans posting bodies. Today a user sees no sign that a feed posting tried to steer
     the check. The pasted-job warning is lost when the toast goes (Task 12 M8).
   - Fix: in `detail()` of `src/app/api/jobs/[id]/route.ts`, add
     `injection: checkForInjection(\`${fresh.role}\n${fresh.description}\`).why ?? null` (the scan is
     cheap and runs only on the detail). Show it in the Fit block as a warning line, next to the
     legitimacy line. This also closes Task 12 M8. Add one test: a posting with "ignore your rules"
     gives a non-null `injection` in the detail.

3. **The deploy and setup documents do not name the LaTeX packages that the template and an own `.tex` need.**
   - Where: `docs/deploy.md:54-61` names only `poppler-utils` and `ghostscript`. `README.md:500,616` and
     `SETUP_WITH_CLAUDE.md:94` still offer `tectonic` as enough.
   - Why it matters: since Task 6 and Task 7, every user without `RESUME_TEX` needs `pdflatex` or
     `xelatex` (`resume.ts:887-889`, `resume/base.ts:65`). A host with only `tectonic` gives
     `ResumeEngineError` for every member. Then `GET /api/resume/[id]` gives 500, and a referral
     fails after the paid Claude call (ledger, Task 6 minor). The Pi has `pdflatex`, but a new install
     that follows the documents does not get it.
   - Fix: in `docs/deploy.md` step 3, add: "Install `texlive-latex-base`, `texlive-latex-recommended`
     (for `parskip`) and `lmodern`. The built-in template and an own `.tex` compile only with
     `pdflatex` or `xelatex`. `tectonic` alone is not enough." Change the `RESUME_ENGINE` row of
     `README.md` to say that it applies only to the admin's `RESUME_TEX`. Add the Ghostscript note of
     Minor 7.

### Minor

1. **The field fit ignores the saved fields and keeps one person's values** (`analysis.ts:60-68`,
   `match.ts:53-58`). `strongFields` gives `['Backend']` when the user has no claims, and `fieldFit`
   gives `Backend` 0.6 because "Backend overlaps almost everything the profile has". A user who chose
   Frontend in Settings gets 0.3 for a Frontend job when the claims rank 2 other fields first. Both
   are older than part 5, but Review Focus 5 asks for neutral defaults. Fix: pass the saved fields to
   `fitFromClaims`; give fit 1 to a saved field; with no claims and no saved fields, use `[]`; remove
   the `Backend` constant. CAN WAIT (6).
2. **The job hints assume one person's visa** (`analysis.ts:149-157`). Every job outside `IN` asks for
   the line "Will require … sponsorship", and an `IN` job asks for a notice period. A citizen of the
   job's country gets wrong advice. Fix: show the work-authorisation line only when `visaStatus` is
   set, in neutral words, and remove the `IN` rule. CAN WAIT (6).
3. **`--profile admin` in the eval grades slugs of the synthetic profile** (`scripts/eval-grade.ts:47`,
   12 fixtures with `mustMet`). A slug that the admin does not have fails "must-cite claims", and the
   field check depends on the admin's saved fields. Fix: in admin mode, set the check to `null` when a
   `mustMet` slug is not citable for that profile, and print a note. The plan's Step 3 uses the
   synthetic profile, so this does not block the model move. CAN WAIT (6).
4. **`ResumeEngineError` is thrown before the `compile: false` return** (`resume.ts:887-889` versus
   `:916`). A call that only needs the link and the lead throws when no engine exists. This is the
   Task 6 deferred minor; with Important 3 fixed, it stays rare. CAN WAIT (6).
5. **The `base-failed:<userId>` rows stay after the account goes** (`resume/base.ts:25`,
   `api/account/route.ts:28-33`). `AppState` has no foreign key. The row holds only a scrubbed reason.
   Fix: add `db.appState.deleteMany({ where: { key: \`base-failed:${user.id}\` } })` to the delete
   transaction. CAN WAIT (6).
6. **The canary holds the worker start** (`scripts/worker.ts:23`). This is the Task 11 deferred minor.
   It also runs a real CLI call at each deploy. It is acceptable for one Pi. CAN WAIT (6).
7. **The PDF import depends on the Ghostscript version.** With Ghostscript 10.02.1, the test
   `reads a pdflatex résumé in full` drops "fine-grained", "office", "Terraform", "naïve", "résumé" and
   "Fluffy affinity": txtwrite writes the ligatures and some accents in another form, and the words
   fail closed (a warning, no leak). The Pi has 10.0.0 (Debian 12), and Debian 12 security updates
   keep 10.0.0, so the deploy is not affected. A move to Debian 13 (Ghostscript 10.05) or another host
   would lose these words from every PDF import. Fix now: one sentence in `docs/deploy.md` ("After a
   Ghostscript upgrade, run `npx vitest run tests/profile-extract.test.ts` before the deploy"). Fix
   later: accept the 10.02 ligature form in `pdf-colour.ts`. CAN WAIT (6).
8. **`rethrowForUser` has no caller** (`cv.ts:39`). It is older than part 5. Remove it when the file
   changes. CAN WAIT (later).

## Rulings

I agree with the rulings of the ledger. Comments on some of them:

| Ruling | Comment |
|---|---|
| `AppState` table in `4_settings` | Agree. One small table serves 3 uses. |
| Fences change `<` and `>` to full-width | Agree. It is the simplest rule that closes all fence escapes. |
| Two signal sets (broad for third-party text, soft for the user's own words) | Agree. |
| `AskRequest.system` is a `BuiltPrompt` | Agree. It keeps the profile fenced in the system prompt. |
| Lenient parse, then `checkReply` coerces | Agree. The eval grades the raw `field` and `level`, so the coercion does not hide a wrong label. |
| An own `.tex` never compiles with lualatex | Agree. The engine choice is the real guard. |
| Members get no Drive link | Agree. |
| `escapeLatex` maps every code point to a tested set | Agree. Run the code-point test again after Important 1. |
| `base-failed` with a 30-minute expiry | Agree. |
| Colour check by 2 Ghostscript renders, fail closed, character allowlist, then park | Agree. Per-glyph hardening had to stop. The other layers stay. |
| Lying ToUnicode and Type 3 "far ink" parked | Agree. They need OCR. A user approves each draft. |
| `pastedBy`, and a second paste makes the job shared | Agree. A join table is not worth it for invited users. |
| Accept the contact message in the outreach payload; delete tasks after 14 days | Agree. |
| Eval: `maxRatio`, `forbidCredit`, `forbidText`, raw labels | Agree. The eval now fails when an injection works. |
| Linear scrub, 30-character prefix, 20 000-character cap | Agree. |

## Triage of the deferred minors and parked items

FIX NOW = before part 5 ends. CAN WAIT (6) = part 6 (UI/UX, SWR and devices) or later. ACCEPT = keep as it is.

| # | Task | Deferred minor or parked item | Triage |
|---|---|---|---|
| 1 | 1 | Duplicate fields are allowed in the settings | CAN WAIT (6). Add `.refine` for unique values. |
| 2 | 1 | The save is find-then-write, not upsert | CAN WAIT (6). A double submit can give a 500 one time. |
| 3 | 1 | No test for the `RESUME_TEX` admin branch | CAN WAIT (6). Tasks 6 and 7 test the admin mode now. |
| 4 | 1 | 3 more in `task-1-review.md` (not on this machine) | CAN WAIT (6). Not checked by me. |
| 5 | 2 | The history cap of a turn rose from 600 to 2000/20000 | CAN WAIT (6). A cost, not a risk. |
| 6 | 2 | The refine prompt does not explain the request blocks in the history | CAN WAIT (6). The eval does not cover refine. |
| 7 | 2 | The cast scan misses `<T>x` casts | ACCEPT. I found no such cast. The type rule is the guard. |
| 8 | 2 | 6 more in `task-2-review.md` | CAN WAIT (6). |
| 9 | 3 | 400 before the 404 ownership check in the outreach PATCH | ACCEPT. The 400 does not depend on the row, so it tells nothing. |
| 10 | 3 | The maintenance test with a global rescan can race the scoped test | CAN WAIT (6). No flake in 3 runs. |
| 11 | 3 | Cursor paging untested past one page | CAN WAIT (6). |
| 12 | 3 | Broad "and"/"now" prefixes in ASK | CAN WAIT (6). More "needs you" replies, the safe direction. |
| 13 | 3 | `name.env` is quiet on the broad set | ACCEPT. The verb pattern still catches "send prod.env". |
| 14 | 3 | Cursor loop of `rescanPendingDrafts` | ACCEPT. It runs one time. |
| 15 | 4 | A mixed-slug `missing` keeps the known slugs as evidence | CAN WAIT (6). Display only. |
| 16 | 4 | 2 more queries for each analysed job | CAN WAIT (6). |
| 17 | 4 | The stored JSON has `score` and `parts` | ACCEPT. The read computes them again. |
| 18 | 4 | The heuristic score and parts are not capped like `match`; parts do not add up after the clamp | CAN WAIT (6). The "How this score was made" list can disagree with the badge by a few points. |
| 19 | 4 | The keyword heuristic makes `met` with empty evidence | ACCEPT. The heuristic is capped at 65 and marked provisional. |
| 20 | 5 | Reword 3 labels | CAN WAIT (6). |
| 21 | 5 | Wrong comment in `jobcheck-text.ts`; duplicate import in `route.ts` | CAN WAIT (fix when the file changes). |
| 22 | 5 | Raw-slug fallback for evidence | ACCEPT. `scored()` removes unknown slugs, so the fallback almost never shows. |
| 23 | 6 | `\write%newline18`, `\@@input`, `\def`/`\let` aliases pass the text check | ACCEPT. `-no-shell-escape` and `openin_any=p` are the guard (ruling). |
| 24 | 6 | No pdflatex and no xelatex: `compile:false` throws, 500, outreach fails after the paid call | CAN WAIT (6), after Important 3 is fixed. See Minor 4. |
| 25 | 7 | The admin env rule also for `RESUME_PDF` only, and an own-tex row with no file | CAN WAIT (6). The live admin has `RESUME_TEX`, so the rule keeps it. An admin with only `RESUME_PDF` who saves the search settings moves to the template. |
| 26 | 7 | Projects ranked by evidence `since` | CAN WAIT (6). |
| 27 | 7 | Expired `base-failed` records are not deleted | CAN WAIT (6). With Minor 5. |
| 28 | 7 | 9 more in `task-7-review.md` | CAN WAIT (6). |
| 29 | 8 | `2× throughput` passes (`×` is not a unit) | CAN WAIT (6). The user approves each suggestion. |
| 30 | 8 | Fraction words ("a third") pass | CAN WAIT (6). Same reason. |
| 31 | 8 | "Spearheaded" is dropped (not in the verb list) | ACCEPT. Fail-safe. |
| 32 | 8 | A digit passes with another unit in the proofs | CAN WAIT (6). |
| 33 | 8 | 7 more in `task-8-review.md` | CAN WAIT (6). |
| 34 | 9 | `pruneTasks` could select the same rows again | ACCEPT. Both queries use the same status filter, and a done or failed task never goes back, so the loop ends. |
| 35 | 9 | 5 more in `task-9-review.md` | CAN WAIT (6). |
| 36 | 9 | iPhone clipboard check owed | CAN WAIT (6). Part 6 owns device tests. |
| 37 | 10 | Parked: visible black bars whose ToUnicode maps to letters (f-bar-BA130) | ACCEPT. Needs OCR (ruling). |
| 38 | 10 | Parked: Type 3 "far ink" and a forged 2-character ligature part | ACCEPT. Same class (ruling). |
| 39 | 10 | Letterlike symbols pass the allowlist; the 1-em shared square; `Engine` for `Engineer` | ACCEPT. Each fails closed or opens to a fixed short text. |
| 40 | 11 | The canary holds the worker start up to 120 s; SIGTERM does not stop it | CAN WAIT (6). See Minor 6. |
| 41 | 11 | No test for the database-failure path; `cliBinary()` called 2 times in health | CAN WAIT (6). |
| 42 | 11 | The reason can hold model or stderr text | ACCEPT. Admin only, 300 characters, scrubbed. |
| 43 | 12 | M3 to M7, M9 in `task-12-review.md` | CAN WAIT (6). |
| 44 | 12 | M8: the paste warning shows only in a toast | **FIX NOW**, with Important 2. The fix is the same line in the detail. |
| 45 | 12 | The refresh "added" count skips jobs that other users pasted | ACCEPT. Cosmetic. |
| 46 | 12 | DNS rebinding | ACCEPT. The host allowlist has 6 fixed public API hosts. |
| 47 | 13 | Unscrubbed text in `gdrive.ts`, the profile import route, `health.ts`, the `resume.ts` bail, `backup.ts` | CAN WAIT (6). None of these carries a model key in practice. I read the import route: it sends a parse error of the user's own file. |
| 48 | 13 | A secret name with a prefix over 30 characters is not found in free text | ACCEPT. The key walk finds it. |
| 49 | 13 | `checkOwnTex` passes `\let` aliases of `\write` | ACCEPT. Same as row 23. |
| 50 | 13 | Old project `tex` rows are not checked again in `tailorTex` | CAN WAIT (6). Only the admin's `RESUME_TEX` with `RESUME_ENGINE=lualatex` could run Lua from them, and only rows that the admin saved before part 5. |
| 51 | 13 | The read spy misses URL and Buffer paths; no check of fetch hosts; M-3 to M-8 | CAN WAIT (6). Test strength only. |
| 52 | 14 | `maxRatio` 0.2 is tight on 2 fixtures; `forbidText` is a plain phrase match; labels may need a fix | ACCEPT until the first real run. Read each failure by hand in Step 3. |
| 53 | 14 | M-items in `task-14-review.md` | CAN WAIT (6). |

Owed steps (not minors, but part 5 is not complete without them):

| # | Owed step | Triage |
|---|---|---|
| A | Task 14 Step 3: the real eval on `claude-sonnet-5` and `claude-sonnet-5-5`, then the model move (`MODEL` is still `claude-sonnet-5`) | **FIX NOW** (on the Pi). Run it after Important 1 and 2. They do not change the job-check prompt, so the order is free. |
| B | Task 11: one real canary on the Pi (pass and fail) | **FIX NOW** (on the Pi). |
| C | Browser checks: the Settings "Job search" card at 360 px (Task 1) and the job detail at 390 px and 1440 px (Task 5) | **FIX NOW**. The plan gave them to the controller at the end of part 5. |
| D | The flake loop of the Task 5 note | Done here: 3 full runs, only the known Ghostscript test failed. |

FIX NOW items: 4 (row 44, and owed steps A, B and C).

## Declined to judge

- The live eval pass rates: I did not run real Claude calls.
- The 9 Task 7 items, the 7 Task 8 items, the 6 Task 2 items and the 3 Task 1 items that the ledger
  names only by count: the reviews of Tasks 1 to 10 are not on this machine.
- The visual design of the new cards: no browser here.

## Assessment

**Ready to end part 5? With fixes.**

**Reasoning:** The safety design of part 5 holds across the tasks. Every prompt goes through one
typed builder. The score uses only checked evidence. Pasted jobs stay with their user. CLI mode turns
off on a failed canary. Secrets are scrubbed from stored errors. I found no Critical issue. But the
default base résumé that members send to recruiters loses letters in its text (Important 1). A feed
posting that addresses the model gets no flag (Important 2). The documents do not tell a new host to
install LaTeX (Important 3). Each fix is small. Fix Important 1 to 3 and row 44, then do the owed
steps A, B and C.

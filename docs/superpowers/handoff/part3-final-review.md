# Final review: part 3 (profile storage and imports), 838343a..a8a294a

Reviewer: final whole-branch review (Opus). I reviewed the branch in passes. Pass 1 was the
plan header, the Global Constraints, the Review Focus, the Rulings, the File Structure and the
spec sections. Pass 2 was the ledger. Pass 3 was the current code of the core modules, the
importers, the routes and the editor. Pass 4 was the cross-task items. I did not run the full
suite. I ran 7 focused test files (`profile-drafts`, `profile-store`, `profile-apply`,
`api-profile-editor`, `profile-form`, `isolation`, `api-account-delete`): 118 of 118 pass.

## Strengths

- **One write path is real.** Every profile write goes through `saveProfile`
  (`src/lib/profile/store.ts:217`). `grep` finds only 3 callers: `changeProfile` (editor),
  `acceptDrafts` and `migrateClaimsText`, plus `restoreRevision`. Each write runs `checkDoc`,
  writes a revision of the state before, and replaces all rows in one transaction.
- **No import changes the profile.** The résumé, GitHub, LinkedIn and YAML paths and the
  `2_profile` SQL all end in `ProfileDraft` rows. The LinkedIn route writes only contacts
  directly, as the spec says. `migrate:claims` is an explicit admin command.
- **Third-party text reaches Claude only fenced.** The 2 new Claude calls
  (`resume-import.ts:214`, `github-import.ts:296` in the file, 163 in grep numbering) use
  `askJson`, `untrusted()`/`untrustedFields()` and `GUARD`. `askJson` refuses any non-Sonnet ID
  (`src/lib/claude/model.ts:16`). LinkedIn and YAML text never go to Claude.
- **The warning gate holds.** `acceptDrafts` refuses a draft with warnings that are not
  approved (`drafts.ts:146`). `editDraft` resets the approval and rescans. The scan fails closed
  above 5000 strings.
- **The quote rule is strict and tolerant at the same time.** One bad item is dropped and
  counted. The rest stay. The quotes come from the text without the hidden words, so a model
  cannot quote hidden text.
- **The GitHub client is fixed-host.** The origin check, `redirect: 'error'`, the name regexes
  on the owner and the repo, and the `htmlUrl` built from checked parts are all correct.
- **The cache is safe across processes.** It compares `ProfileMeta.version`, which every
  write increments, so the part 4 worker will see writes at once.
- **Pre-checks before paid work.** The résumé and GitHub imports check the pending cap before
  the Claude call. The LinkedIn import checks the cap before the contacts write.
- **The account delete is careful.** It requires the password, has a rate limit, tolerates a
  double submit and a folder error after the commit, and the admin cannot delete the admin
  account.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

**I1. Editing the text of a position bullet breaks its claim evidence and its `.tex` match.**
MUST FIX BEFORE MERGE.
- Where: `src/components/profile/fields.ts:85-92` (`fromForm`, position bullets).
- What: a bullet keeps its ID only when its line is unchanged. A changed line becomes a new
  bullet with a new ID and `match: text.slice(0, 80)`.
- Effect 1: each claim evidence `position:<id>/<old bullet>` now names nothing, so `checkDoc`
  refuses the save with 422. `errorsFor` shows only errors of the edited item, so the form shows
  no field error before Save. The server error then names a claim, not the bullet. The user must
  find and remove that evidence first. The worktree `data/profile/claims.yml` (the admin's real
  profile after `migrate:claims`) has 13 bullet evidence targets, so this occurs on the first
  typo fix.
- Effect 2: `match` is the phrase that finds the bullet in `RESUME_TEX`
  (`src/lib/resume.ts:395`). The admin's bullets have only `match`, so `toForm` shows the match
  phrase as the line. After an edit, the new `match` is the edited text, which is not in the
  `.tex`. The CV refine then cannot find that bullet, and no error shows.
- Fix: when a line changed, keep the ID (and the old `match`) of the bullet at the same line
  index, and put the new text in `text`. Or, at minimum, have `upsertItem` for a position drop
  or retarget evidence of removed bullets, and show the count of affected claims. Add a test in
  `tests/profile-form.test.ts` for "edit one bullet line, the ID and the match stay".

**I2. Lost update: edits and draft accepts read the document outside the transaction.**
CAN WAIT for part 6, with one cheap guard now (see below).
- Where: `src/lib/profile/editor.ts:209-210`, `src/lib/profile/drafts.ts:150-159`.
- What: `changeProfile` and `acceptDrafts` load the document, apply the change, and only then
  call `saveProfile`. Two writes of the same user that overlap both start from version N, and
  the second write silently removes the change of the first. Example: tab A accepts a draft
  while tab B saves a position. The draft is marked `accepted`, but its item is gone from the
  profile, so the user cannot accept it again. The revision history keeps the data, so a restore
  can bring it back, but nothing tells the user.
- Why it can wait: one person makes these writes, the UI has a busy guard, and the part 4
  worker makes drafts, not profile writes. Part 6 adds SWR, which makes stale tabs more likely,
  so part 6 must close it.
- Fix (part 6): pass the expected `ProfileMeta.version` to `saveProfile`, and in the
  transaction do `profileMeta.updateMany({ where: { userId, version: expected } })` (or compare
  the version read in the transaction) and throw 409 on a mismatch. The client already gets
  `version` in each reply.
- Cheap guard now (recommended, 3 lines): in the `acceptDrafts` `extra`, check that the
  `updateMany` count equals `ids.length`, else throw 409. This stops a double accept and an
  accept of a draft that another tab rejected.

### Minor (Nice to Have)

**M1. A rename at accept reaches only claim drafts in the same accept call.**
CAN WAIT (part 6). `applyDrafts` (`apply.ts:123-153`) retargets the evidence of claim drafts
only within one call. Example: a résumé import drafts `position:goldman-sachs-analyst`, which
matches the existing `gs-analyst` by title. If the user accepts the position alone and the
skills later, each skill fails with "not declared". "Accept all" in one batch works. Fix: in
`createDrafts`, retarget the evidence of each claim draft to the `matches` key of the item
drafts of the same batch.

**M2. A truncated GitHub reply is cached with its ETag.** CAN WAIT (part 4).
`github.ts:62-70` cuts the body at 1 MB and caches it. If a repo list passes 1 MB, every later
request gets 304 and the same broken JSON, so the list fails with 502 until the data changes.
Do not cache a body that was cut.

**M3. The 2_profile drafts have no injection scan.** CAN WAIT (part 5).
The SQL drafts (`migration.sql:28-54`) get `warnings: '[]'`, so old LinkedIn fields skip
`scanWarnings`. The risk is low (the user's own export, no Claude call before accept), but it
is the one draft path that skips the spec 6.4 scan. Part 5 (new signals) can rescan pending
drafts.

**M4. The duplicate `describe('draft warning gate')` block is still there.** CAN WAIT, but it
is a 1-minute fix. `tests/profile-drafts.test.ts:105` and `:148`. Delete the first copy, as the
ledger says.

## Triage of the deferred minors (ledger "minor (deferred)")

| Task | Deferred item | Triage |
|---|---|---|
| 1 | Stale header comment in `claims.ts` | CAN WAIT (6) |
| 1 | Limits written twice; `org`/`location` use `LIMITS.text` | CAN WAIT (6) |
| 1 | No count limits on evidence/links/mentions in `checkDoc` | CAN WAIT (5). The item schemas cap them (50/50/20) and YAML is capped at 1 MB. |
| 1 | `diffDocs` key-order dependence | CAN WAIT (6). The Task 14 browser check showed no false change. |
| 1 | Moved comments not in ASD-STE100 | CAN WAIT (6) |
| 2 | `user.ts` comment about LinkedIn tables | Resolved (Task 4 rewrote it). |
| 2 | No migration test with NULL `startedAt` | CAN WAIT (4). Add it before the deploy runs `2_profile` on the live database. |
| 2 | Old `ProjectItem.tags` not carried into drafts | CAN WAIT (4). Note it in the deploy notes: tags are lost when the old table drops; a new LinkedIn import gives back the projects. |
| 2 | "Task 9"/"Task 4" wording in code | Resolved for those files. One stray "(Task 9)" remains in `src/lib/exec.ts:15` (older part). CAN WAIT (6). |
| 2 | No RED run | Process only. No action. |
| 3 | `migrations.test.ts` timeout flake | Resolved (Vitest timeouts 30 s, Task 5 ruling). |
| 3 | `JSON.parse(rev.snapshot)` unguarded | CAN WAIT (6). Only the app writes snapshots. |
| 3 | `ProfileError` keeps errors twice | CAN WAIT (6) |
| 3 | No test of the non-strict save | CAN WAIT (6) |
| 3 | No test of `ApiError.data` / P2025 | CAN WAIT (6) |
| 4 | 2 unnamed full-suite failures | Resolved (timeout ruling, Task 5). |
| 4 | No admin read-back test | CAN WAIT (4) |
| 4 | Blank line, long comments | CAN WAIT (6) |
| 5 | Duplicate `normEmail`; "state before" text on a first migration; no unquoted-number case through `migrateClaimsText`; `replaced` read outside the transaction | CAN WAIT (4). `migrate.ts` now imports `normEmail`. The admin runs the command once at deploy. |
| 6 | Corrupt draft row can break `listDrafts` | CAN WAIT (6). `parseJson` guards the parse; only a `profile` draft with `null` data reaches `diffDocs`. |
| 6 | No `listDrafts` profile-diff key-order test | CAN WAIT (6) |
| 6 | Colliding bullet ID dropped silently in a merge | CAN WAIT (6). Pair it with the I1 fix. |
| 6 | Merged project bullets can pass 8 (422) | CAN WAIT (6). The 422 is shown; the user edits the draft. |
| 6 | Renames reach only later claim drafts | CAN WAIT (6). See M1. |
| 6 | Doc loaded outside the accept transaction; double accept | See I2: cheap count guard now, version check in part 6. |
| 6 | Item schemas reject numbers; one bad item fails a batch | Resolved. The résumé and GitHub builders drop bad items first; LinkedIn makes only strings. |
| 6 | `scanWarnings` skips object keys | CAN WAIT (5). Zod strips unknown keys on item drafts; only the `profile` type keeps arbitrary keys. |
| 6 | No RED step | Process only. |
| 6 | Duplicate `describe` block | CAN WAIT; see M4 (1 minute). |
| 7 | Lost update | See I2. |
| 7 | Restore test does not assert the new revision; `as ClaimsDoc` cast; `KIND_LABEL` identity map | CAN WAIT (6) |
| 8 | `sniffYaml` exact type match (no `;charset`) | CAN WAIT (6). `File.type` from a form has no parameters in current browsers. |
| 8 | YAML reject-old and create-new not in one transaction | CAN WAIT (6). The worst case: a 409 at the cap removes the old pending YAML draft. |
| 8 | 400-digit Content-Length gives 400; 400 test does not pin the message | CAN WAIT (6) |
| 9 | `JSON.parse(prev.counts)` unguarded | CAN WAIT (6). Only the app writes `counts`. |
| 9 | Duplicate skills become `java`, `java-2` | CAN WAIT (6) |
| 9 | `ym` local-time parse | CAN WAIT (4). The formatter also uses local time, so the result is consistent on one host. |
| 9 | Two concurrent LinkedIn imports race the pre-check | CAN WAIT (4). The cap is soft. |
| 10 | Non-Latin tiny text dropped with no warning; negative coordinates dropped | CAN WAIT (5). Both fail closed: the text does not reach Claude. |
| 10 | 3.7 ratio depends on font metrics; boundary tests | CAN WAIT (5) |
| 10 | `\\%` edge case; `\begin {comment}` spacing; rotated test lines | CAN WAIT (5) |
| 10 | `usersRoot` uses `process.cwd()` | CAN WAIT (4). The worker must start in the same folder or set `WAYPOINT_USERS_DIR`. Put it in the deploy notes. |
| 10 | Other `.tex` hiding tricks (`\csname`, `\if0`, `\phantom`, near-white colours) | CAN WAIT (5), as already ruled. |
| 11 | Zero valid items keeps the upload, no message | CAN WAIT (6) |
| 11 | Failed imports count toward the rate limit | CAN WAIT (4) |
| 11 | A null list (`positions: null`) fails the whole reply | CAN WAIT (5). Use `.nullish()` and a transform to `[]`. |
| 11 | One bad evidence depth drops the whole claim | CAN WAIT (5) |
| 12 | Truncated body cached | CAN WAIT (4); see M2. |
| 12 | Token save and cache clear not in one transaction | CAN WAIT (6) |
| 12 | Another owner's repo has no warning | CAN WAIT (6). The list uses `type=owner`. |
| 12 | A failure on repo N loses the paid drafts before it | CAN WAIT (4). The worker moves this call; make each repo its own task then. |
| 12 | No test for `redirect: 'error'` or the no-token header; `hitLimit` before the name check | CAN WAIT (6) |
| 12 | Repeat import of the same repo/skill | Resolved, no fix needed. `findMatch` sets `matches` to the existing slug (same slug or same title). At accept, `applyDrafts` merges into that item (`apply.ts:145`), and a clash with the draft's own slug also merges. No duplicate slug can reach `checkDoc`. An unrelated manual item with the same slug gets its empty fields filled, which is acceptable because the names are the same. |
| 13 | Unused `contactLimit`; over-indented JSX | CAN WAIT (6) |
| 13 | Editing a bullet line changes its ID and breaks `position:x/bullet` evidence | MUST FIX BEFORE MERGE; see I1. |
| 13 | "No claims yet" on an empty search; no Retry on a failed first load; tabs lack Home/End; 2 "Remove" buttons with the same name; missing `fields` tests | CAN WAIT (6) |
| 14 | Identical Accept/Edit/Reject names; raw Facts keys; hard-coded warning colours; repeated diff key; `role=alert` per draft | CAN WAIT (6) |
| 14 | "Dropped 1 items" plurals; tabs full width on 640–1023 px; no tests for busy guard and plurals | CAN WAIT (6) |
| 15 | No per-user-key rate-limit test; `RateLimit` rows stay after a delete | CAN WAIT (4). The keys hold only a user ID, no personal data. |

## Cross-task checks requested by the controller

- **Lost-update race:** real; see I2.
- **Repeat import of the same repo/skill:** safe; merges into the existing item (see the
  Task 12 row).
- **Bullet ID changes and `position:x/bullet` evidence:** real, and it also breaks the
  `.tex` match; see I1.
- **Third-party text to Claude without `untrusted()`:** none found. Only 2 new Claude calls,
  both fenced. Accepted profile text goes into prompts as the user's own words, as spec 6.3
  says.
- **An import that changes the profile without a person accepting:** none found.

## Declined to judge

- Same-colour hidden text in PDFs: set aside, part 5 by plan ruling.
- New injection signals of spec 6.4: set aside, part 5 by plan ruling.
- Claude drafting in the request, not the worker: set aside, part 4 by plan ruling.
- The Résumé tab, built-in templates and own `.tex` per user: set aside, parts 5 and 6.
- UI primitives, SWR and visual polish: set aside, part 6 by plan ruling.
- Drive per user in Settings → Integrations: set aside, a later part by plan.
- The worktree `data/waypoint.db` is not migrated: set aside, controller ruling (Task 2).
- Old job analyses are kept after a profile change: set aside, plan ruling.
- Full-row replace on each write (cost for large profiles): set aside, plan ruling; the item
  caps bound it.
- After `2_profile`, a member's prompts use an empty profile until they accept the LinkedIn
  drafts: set aside as the plan ruling "Drafts for old LinkedIn rows". The deploy notes of part
  4 must tell members.
- The admin cannot delete the admin account in Settings: not in the spec; I judged it a
  reasonable guard and did not grade it.
- Full-suite stability on the Pi: not re-run here (the coordinator limited me to focused
  tests); the ledger records the timeout fix in Task 5.

## Recommendations

1. Fix I1 now, with a test. It is the only issue that the admin meets on the first day with
   the migrated profile.
2. Add the `acceptDrafts` count guard now (I2, 3 lines). Put the expected-version check on the
   part 6 list, with a 409 message in the client.
3. Delete the duplicate test block (M4).
4. Put these in the part 4 deploy notes: run `migrate:claims` for the admin, members must accept
   their LinkedIn drafts, old project tags are lost, and the worker needs the same working folder
   or `WAYPOINT_USERS_DIR`.
5. Carry M1 and the Task 6 merge minors (bullet ID collisions, more than 8 merged bullets) into
   part 6 as one "merge view" item.

## Assessment

**Ready to merge?** With fixes

**Reasoning:** The architecture matches the plan and the spec: one checked write path with
revisions, imports only through drafts with the warning gate, fenced Sonnet calls, and a
fixed-host GitHub client. Before the merge, fix the bullet edit (I1), which breaks claim
evidence and the `.tex` match on the admin's real profile, and add the cheap accept count guard
(I2). All the other items can wait for the parts named above.

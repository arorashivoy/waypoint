# Final review: part 6 (UI/UX and devices)

Range: `a61592c..0ac2acc` (39 commits, 342 files). Branch `claude/epic-lovelace-0vqgu7`. Reviewer: opus.
I did not change code. I wrote only this file.

I read the plan (visual direction, global constraints, rulings, Review Focus, all tasks), sections 7, 8
and 9 of the spec, the ledger, the reviews of Tasks 1 to 13, the re-review of Task 12 and the Task 14
findings and report. I read the diff of the routes, `state.ts`, the migration, `exec.ts`, the secret
and scrub changes, the e2e harness, the profile version code and the shell. I did not read every line
of the CSS and the tests.

I ran the app on port 3150 with a scratch database (`ui-env.sh reset`, `start`, the 3 seed scripts and
a new member). I took 145 shots: every screen and state at 390, 820, 1024, 1366 and 1440 px. I ran 4
Playwright scripts: keyboard and focus, two tabs on one profile, rotation, and the shot run. Shots and
scripts: `/tmp/claude-0/-home-user-waypoint/93970792-a3ce-5b0f-8514-26f25d3284ef/scratchpad/final6/`.

Runs in this container:

| Command | Result |
|---|---|
| `npm test` (1 run) | 100 files. 1680 pass, 1 skip, 0 fail. |
| `npm run typecheck` | Pass. |
| `npm run lint` | 0 errors, 0 warnings. |
| `next build` (no dev server; scratch `DATABASE_URL`; the test key) | Exit 0. 23 pages. `/` is 89.5 kB (181 kB first load). `.next` deleted after. |
| Migrations 6 and 7 on an existing database | I applied 0 to 5 with `prisma migrate deploy`, added an admin with no settings row, a member with a full `own-tex` row, a member with no row and one job. Then I applied 6 and 7 with `prisma migrate deploy`. Every user has `onboardedAt`. The member row keeps every value and its `updatedAt`. The job has `pastedBy = null`. `prisma migrate diff` to `schema.prisma`: "No difference detected". With `RESUME_TEX` set, `resumeConfig` of the admin gives the `.env` `.tex` (`template: false`). |
| Static files without a session | `/manifest.webmanifest` 200 `application/manifest+json`, `/icons/icon-192.png` 200, `/pdfjs/pdf.worker.min.mjs` 200 `application/javascript`. The worker is byte-identical to `node_modules`. |

## Strengths

- The direction holds across the app. The shots at 5 widths show one night ground, one glass family,
  Syne only at 20 px and more (the shot script found no Syne text under 20 px), sentence case, no
  middle-dot meta strings, and no horizontal scroll at any width.
- The job detail does what the plan asks. The route uses shape and a word for each stop (filled
  "Met", half "Partial", hollow "Missing"). Each blocker is coral text with the quote of the posting.
  The injection note is butter text. Posting text with `<b>` shows as text (the "inject" shots).
- Keyboard: `/` focuses search at all 3 widths; `j`/`k` move the selection on the desktop; the filter
  sheet takes focus, keeps Tab inside (30 presses, 0 escapes), closes on `Esc` and gives focus back to
  "Filters". Tabs in Settings move with the arrow keys, Home and End, and change the URL. The focus
  ring is 3 px lavender.
- Rotation keeps the job and the part: `?job=…&part=cv` at 390 px stays at 844 × 390, and the CV fold
  opens there.
- Safety holds over the whole range. Only `src/lib/exec.ts` starts processes (the new `signal` option
  only aborts). No `dangerouslySetInnerHTML`, `innerHTML` or `insertAdjacentHTML` in `src`. The 4 new
  routes (`/api/me`, `/api/jobs/list`, `/api/pending`, `/api/onboarding`) use `handle` and
  `requireUser` and are in the 401 table. The jobs list and the counts use `visibleTo(userId)`
  (`state.ts:33,71`). Contacts are read `where: { userId }`. No secret is in a new reply. Part 6 adds
  `scrub` to the Drive, rclone, systemctl, health and LinkedIn error texts.
- The e2e harness is safe for the Pi: `env -i` with an allowlist, a scratch copy of the code with no
  `.env` and no `data/`, `next dev -H 127.0.0.1`, a random password in a 600 file, a port check and a
  trap that stops the worker (`tests/e2e/setup/start.sh`).
- The migration `7_onboarding` is additive and keeps the live admin résumé (checked above).

## Review Focus, end to end

| # | Focus | Result |
|---|---|---|
| 1 | The route without colour and as text | Yes. Shape and word for each stop; blockers as text; an `sr-only` summary. Small gap: the summary counts only the 3 shown stops (Minor 7). |
| 2 | Each layout at 390/820/1024/1366/1440 | Yes. Tab bar under 640, rail from 640 to 1279, sidebar from 1280; the job is a full screen, a modal side panel, or the right pane. No horizontal scroll. The rail at 1024 to 1279 differs from the spec table (Minor 10). |
| 3 | States | Yes for each screen I opened: skeletons (also in the job pane), error blocks with retry next to the list, empty states with a cause. The all-empty Pending is busy (Minor 5). |
| 4 | Stale writes across two tabs | **Partly.** A save from the old tab gives the 409 and the message when the tab has no focus event. After a switch back to the old tab (more than 5 s later), SWR loads the new version under the open form, and the old form then saves with no 409. Important 1. |
| 5 | Keyboard and focus | Yes on the desktop and for sheets. On a phone, focus is lost when a job opens and closes; on a tablet, `Esc` after a `j` open drops focus to `body` (Minor 1). |

## Issues

### Critical

None.

### Important

1. **A stale form saves with no 409 after the user goes back to the old tab (Review Focus 4).**
   - Where: `src/components/profile/ItemEditor.tsx:36,60-61` and `src/components/profile/ExperienceTab.tsx:19,44`
     send the version of the context at the time of the save. `src/components/data.ts:79` sets
     `revalidateOnFocus: true`, and `version.ts` gives the new version to the context after each load.
   - Probe (`final6/stale.mjs`): tab A types a headline. Tab B saves another headline. With no focus
     event, A's save gives the 409 text and the server keeps B's headline. When A gets the focus
     (`visibilitychange` and `focus` 6.5 s after the load), SWR loads version n+1, and A's save
     then succeeds: the server has A's headline, and B's change is gone with no message.
   - Why it matters: a person changes tabs with a click or Ctrl+Tab, and both fire the focus event. So
     the 409 almost never shows in real use. In `ItemEditor` the loss is worse: A sends the whole item
     that it opened, so a bullet that B added to the same position is removed.
   - Fix: keep the version of the start of the edit, and send it. In `ItemEditor`, take
     `const base = useRef(version)` when the editor mounts, and send `base.current`. In
     `ExperienceTab`, set the base when the form becomes dirty, and reset it after a save or "Load the
     new version". Add a test of the rule (a pure helper `editVersion(base, current)`), and add the
     two-tab case to `tests/e2e` (the probe above is a start).

2. **The deploy and setup documents have no part 6 change.**
   - Where: `docs/deploy.md`, `README.md` and `SETUP_WITH_CLAUDE.md` have no change in the range.
   - Missing:
     - Fonts: `next/font/google` downloads Syne and Onest at `next build`. `scripts/deploy.sh` stops
       the units, then runs `npm ci` and the build. If Google Fonts does not answer, the build fails
       and the app stays down until a person acts. Nothing tells the owner this.
     - `7_onboarding`: say that existing users skip the wizard, that only new users see it, and that
       the admin keeps `RESUME_TEX`.
     - The pdf.js worker: `postinstall` copies it to `public/pdfjs/`; do not use `npm ci --ignore-scripts`
       (the committed copy then must match the pinned version).
     - Device tests: no link from `README.md` or `docs/deploy.md` to `docs/devices.md` and
       `npm run test:e2e`; the WebKit run on the Pi is an owed step.
     - The Task 12 review m-4 (not in the ledger): if the CLI stays off after a slow start, restart
       the worker again.
     - `README.md:94,100,518,544,559,568` name the old "Resume screen", "Countries screen" and
       "Refresh feeds". The app now has Profile → Imports, Settings → Job search and "Refresh".
   - Fix: add a "Part 6" paragraph to step 3 of `docs/deploy.md` with the 5 points above, and change
     the old screen names in `README.md`. For the fonts, FIX NOW is the sentence; CAN WAIT is
     `next/font/local` with the 2 OFL font files in the repo, so the build needs no network.

### Minor

1. **Focus is lost when a job opens or closes on a phone, and after `Esc` on a tablet** (Review
   Focus 5). At 390 px, Enter on a row opens the job and focus stays on `body`; Back also leaves it on
   `body` (`final6/k2.mjs`). At 820 px, a job opened with `j` closes on `Esc` with focus on `body`,
   because no element opened it. `useShell.ts:54,76` and `JobDetail.tsx` move no focus. Fix: under
   640 px, focus the job `h2` (`tabIndex={-1}`, `JobHeader.tsx:28`) when a job opens, and the row of
   that job when it closes; give the tablet Sheet the selected row as the fallback opener.
2. **The app does not use the `Toast` primitive.** `Waypoint.tsx:29,50` renders
   `<div className="toast" role="status">` only while text exists, with `useToast` from `hooks.ts`.
   This is the problem that Task 2 I4 fixed in `ui/Toast.tsx`: a live region that mounts with its text
   is often not read, and the same text twice does not restart. `ui/Toast.tsx` and
   `.ui-toast-region` are dead outside `/design`. `TaskIndicator` has the same mount pattern (Task 2
   deferred). Fix: use `<Toast>` in `Waypoint.tsx`, remove `useToast` and `.toast`, and keep the
   `TaskIndicator` region mounted.
3. **Pending has a primary button on each "Needs you" item, and 3 badge styles** (pending-1440,
   pending-1024). Two gradient "Send reply" buttons show at one time; the direction allows one primary
   action on a screen. The sidebar count is a tinted coral pill, the rail, tab bar and section head
   use a solid coral pill, and the Imports count is a solid lavender pill. Fix: make "Send reply" the
   quiet glass button (the coral rule already marks the item), and use one badge rule: tinted pill in
   lists and section heads, solid only on the nav icon.
4. **The CV fold says "Add an API key in Settings to use Claude." 2 times** (cv-1440, cv-390: under
   "Refine with Claude" and next to "Suggest wording"). Fix: one line above the Claude tools.
5. **An all-empty Pending shows 4 dashed routes side by side** (m-pending-1440). The motif repeats 4
   times and each sentence is long ("No reply was safe to send on its own."). Fix: when all 4 are empty,
   show one screen-level `EmptyState` with one action; keep a one-line note in each section.
6. **The "Show N jobs" button of the filter sheet is at the end of the scroll** (filters-390). On a
   phone the user does not see the count while choosing. Fix: a sticky sheet footer, as `.jd-bar`.
7. **The route summary for screen readers counts only the shown stops.** `FitSection.tsx:39` passes the
   top 3, so it says "0 of 3 met, 3 missing" next to "Show all 9 requirements". Fix: say "Top 3: …" or
   count all requirements in the summary.
8. **One action, 2 names:** "Open the posting" (`ApplyBar.tsx:8`) and "Open posting"
   (`JobHeader.tsx:25`). Fix: use "Open the posting" in both.
9. **Two section containers for one layout.** Profile puts each section in a glass panel
   (profile-experience-1440); Settings puts its sections on the ground (settings-claude-820,
   settings-job-search-1440). Both use the same side list. Fix: one treatment for both screens.
10. **The spec table 8.1 says "Desktop ≥ 1024 px: full sidebar".** Task 14 (J2) shows the rail from 1024
    to 1279 px, and the Task 7 ruling puts 4 Pending columns from 1280. The choice is right (at 1024 the
    job title broke inside a word), but no ruling line names it. Fix: update spec 8.1 and the plan
    layout block.
11. **pdf.js hardening.** `PdfPreview.tsx:44` calls `getDocument({ url })`. Add `isEvalSupported: false`.
    The PDF is the user's own CV from the same origin, and 4.10.38 has the font-eval fix, so this is
    defence in depth only.
12. **A phone in landscape (844 × 390)** shows the job as a tablet panel; the title bar and the apply bar
    take about 40 % of the height (rot-844). Fix: under `(max-height: 500px)`, make the apply bar
    static or hide the panel title.
13. **Dead code.** `rethrowForUser` (`src/lib/cv.ts:39`, part 5 Minor 8) and the items of Minor 2.

## Rulings

I agree with the rulings of the ledger. Comments:

| Ruling | Comment |
|---|---|
| Old token names re-pointed to the new palette (Task 1) | Agree. No light colour is left. |
| Syne only from 20 px; fold titles Syne 20 (Task 2, Task 14 J3) | Agree. The shot script finds no Syne under 20 px. |
| `cache: 'no-cache'` for GET | Agree. 304s work. |
| Blocker line = typed lead + the posting's quote (Task 5) | Agree. It renders as text. |
| Filter count against the cleared filters | Agree. "Filters (2)" on the first visit is true (your level, this week). |
| Pending 4 columns only from 1280 | Agree (see Minor 10 for the spec text). |
| The pdf.js worker as a static file, copied by `postinstall` and committed | Agree. The build passes, and a test checks the bytes. Document it (Important 2). |
| Task 12 word-gap rule and the widened parked class (Type3 ink over other glyph boxes) | Agree. A fix must not widen a parked class, and 64 probes pin the level. The guard stays the fences, the quote rule and the user's approval. |
| `7_onboarding` gives the admin `own-tex`; `getSettings` maps an `own-tex` row with no file to the default | Agree. I checked it on a real pre-6 database. |
| e2e env allowlist, 127.0.0.1, random password | Agree. |
| Profile and Settings choose tabs or side list with `useSideList` (a `matchMedia` hook) | Accept. Spec 8.1 says CSS only, but these screens mount only in the browser after the data loads, so the first paint is right and nothing jumps. |

## Triage of the deferred minors and ACCEPT lines

FIX NOW = before part 6 ends. CAN WAIT = part 7 or later. ACCEPT = keep as it is.

| # | Task | Deferred minor or ACCEPT line | Triage |
|---|---|---|---|
| 1 | 1 | `@supports` fallback skips `.chip`, `.contact`, `.login-right`, `.pend-card` | ACCEPT. Text on `--glass` over the night ground keeps 4.5:1 without blur. The surfaces that cover content (sidebar, rail, tab bar, sheets, panels) are in the fallback. |
| 2 | 1 | The contrast test checks solid colours only | CAN WAIT. The glow peaks are soft; add a composite check if a token changes. |
| 3 | 1 | Inline `letterSpacing` labels | Closed. No `letterSpacing` is left in `src`. |
| 4 | 1 | The old paste row overflows at 1440 | Closed by Task 5. |
| 5 | 1 | `/design` builds a fake `Request` for `readSession` | ACCEPT. Admin only; it works. |
| 6 | 2 | `TaskIndicator` is not an always-mounted live region | CAN WAIT, with Minor 2. |
| 7 | 3 | The load error also shows as a toast; scroll restore | Closed. The error shows only in the shell (error-390); the scroll is kept. |
| 8 | 4 | M2, M3, M6, M7; `tests/etag.test.ts` X+letter | Closed by Task 14 (`XE` + 8 hex). |
| 9 | 6 | M3, M4, M9 to M15 | Closed by Task 14. |
| 10 | 7 | Focus to the section heading after an action | Closed by Task 11. |
| 11 | 9 | ProfileScreen first-paint flash | Closed by Task 14 (PR9). |
| 12 | 9 | The empty-state wiring is checked only in the browser | ACCEPT. I saw it work (Settings action from Jobs). |
| 13 | 10 | The skipped mark is in component state (a reload forgets it) | CAN WAIT. The route then says "Later", which is still true. |
| 14 | 10 | No unit test for the skip of the last step | CAN WAIT. The e2e wizard test covers the skips. |
| 15 | 11 | `<Image>`/empty `<a>` scan; field classes and `font:` in the 16 px check; plain links under 44 px; Minor 9 | Closed by Task 14. |
| 16 | 13 | A compile failure from a bad LaTeX source is not in e2e | CAN WAIT. Unit tests cover `cleanLog` and the excerpt. |
| 17 | 12 | ACCEPT: Part 3 merged project bullets over 8 (422) | ACCEPT. Agree. |
| 18 | 12 | ACCEPT: Part 3 comment style, `KIND_LABEL`, guarded cast | ACCEPT. Agree. |
| 19 | 12 | ACCEPT: Part 3 `hitLimit` before the name check | ACCEPT. Agree. |
| 20 | 12 | ACCEPT: Part 3 another owner's repo with no token | ACCEPT. Agree. |
| 21 | 12 | ACCEPT: Part 3 UI rows moved to Task 14 | Closed by Tasks 8 and 14 (checked in the Profile shots). |
| 22 | 12 | ACCEPT: Part 4 row 10 moved to Task 14 | Closed by Task 14 (`tasks.ts`, parsers in `task-results.ts`). |
| 23 | 12 | ACCEPT: Part 5 row 15 (mixed-slug `missing`) | ACCEPT. Agree. Display only. |
| 24 | 12 | ACCEPT: Part 5 row 16 (2 more queries for each job) | ACCEPT. Agree. |
| 25 | 12 | ACCEPT: Part 5 row 25 (`RESUME_PDF`-only admin, own-tex row with no file) | ACCEPT. The `getSettings` map of Task 10 now also covers the row with no file. |
| 26 | 12 | ACCEPT: Part 5 row 26 (rank by `since`) | ACCEPT. Agree. |
| 27 | 12 | Review m-4 (not in the ledger): note the canary timeout in `docs/deploy.md` | **FIX NOW**, with Important 2. |
| 28 | 12 | Review m-6 (Drive upload before the Claude call) | ACCEPT. A retry replaces the same file. |
| 29 | 12 | Review m-7 (renamed bullet ID; claim drafts still point at the old bullet) | CAN WAIT. A rare edge; the user reviews each draft. |
| 30 | 12 | Review m-8 (zero-item résumé import after the paid call) | ACCEPT. The cache makes a retry free. |
| 31 | 12 | Re-review m-a (pin the words after the ligature words in the fixture test) | CAN WAIT. Test strength only. |

Findings of this review:

| # | Finding | Triage |
|---|---|---|
| I1 | Stale form saves after focus revalidation | **FIX NOW**. |
| I2 | Deploy and setup documents | **FIX NOW** (the sentences). `next/font/local`: CAN WAIT. |
| M1 | Focus on job open and close (phone, tablet `Esc`) | **FIX NOW**. Small, and it is Review Focus 5 on the main device. |
| M2 to M13 | The other Minors | CAN WAIT. |

Owed steps:

| # | Owed step | Triage |
|---|---|---|
| A | The WebKit profiles (`npm run test:e2e` on the Pi) and the manual checklist of `docs/devices.md` on a real iPhone and iPad | **FIX NOW** (on the Pi). The cloud has Chromium only. |

FIX NOW items: 5 (I1, I2, M1, triage row 27 with I2, owed step A).

## Declined to judge

- WebKit and real iOS behaviour (Safari focus on click, the on-screen keyboard, the home-screen app):
  the cloud has Chromium only.
- The live look on a real phone screen (glass blur, glow banding).
- The ligature parser of Task 12 beyond the ledger, the re-review and the probe tests.

## Assessment

**Ready to end part 6? With fixes.**

**Reasoning:** The app now reads as one calm, dark mint-and-lavender product at every width, and the
per-task gates did their job: every layout, state and keyboard path that I drove works, the build
passes, the migrations keep the live data and the admin résumé, and the safety rules of parts 1 to 5
hold. Two things stop a clean end. The stale-write guard of Review Focus 4 does not hold in the normal
two-tab flow, because the focus reload gives the old form the new version (Important 1). The deploy
documents do not tell the owner what part 6 changed, and the new font download makes a deploy fail
with the app stopped when Google Fonts does not answer (Important 2). Fix Important 1 and 2 and Minor 1,
then run the WebKit tests and the device checklist on the Pi.

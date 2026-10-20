# Part 6: UI/UX and Devices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every task that touches the UI loads the `frontend-design` skill first** (owner's order, 2026-10-20).

**Goal:** Replace the current UI with one clear visual direction, and rebuild the screens on it: 4-item navigation, an onboarding wizard, a jobs list and job detail that read at a glance, Profile and Settings in sections, and a layout of its own for phones, tablets and desktops. Close the "CAN WAIT (6)" items of the part 3, 4 and 5 final reviews.

**Architecture:** Design tokens as CSS variables in `globals.css`, two self-hosted fonts through `next/font`, and a small set of UI primitives in `src/components/ui/`. Layouts come from CSS media and container queries only (`useIsPhone()` goes away). Each screen reads its data with SWR from a split `/api/state`. The job route is the one bold element: a job is a destination, and its requirements are the stops on the route.

**Tech Stack:** Next.js 14, React 18, SWR (new), `pdfjs-dist` (new, for the iOS PDF preview), `@playwright/test` (new dev dependency, device smoke tests), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-production-ready-design.md`, sections 7, 8 and 9. Sources of extra items: `docs/superpowers/handoff/part3-final-review.md`, `part4-final-review.md` and `part5-final-review.md` ("CAN WAIT (6)" rows), `part5-ledger.md` (deferred minors), `pi-steps-2026-10-20.md` and `pi-steps-2026-10-20b.md` (minors found on the Pi).

**Visual mock for review:** `design/part6/direction.html`, with screenshots `design/part6/desktop-1440.png`, `design/part6/phone-390.png` and `design/part6/states.png`.

## Visual direction (Task 1 builds it; the owner reviews it with this plan)

**Subject, audience, job.** Waypoint is a private tool for a small group of invited engineers who look for work in other countries. They read it on a phone between other things, and at a desk when they write a referral note or tailor a CV. The main job of the UI: decide fast which postings are worth an application, then act on them (referral, CV, applied).

**Concept: a route map.** The name is Waypoint, so the UI borrows from transit maps and road signs. A job is a destination. Its requirements are the stops on the route: a filled stop is met, a half stop is partial, a hollow stop is missing, and a blocker breaks the line with a red bar. The referral is "your way in": You, then the contact, then the company, drawn as stops on one line. This route is the one bold element. Everything around it is quiet.

**What changes from today.** The current UI uses a warm cream ground, a terracotta accent, a grotesque display face and monospace small labels with letter spacing. That set is the most common look of generated pages, and the owner finds it poor. The spec line "The fonts, colours and touch-target size from BRIEF.md stay" (7, first line) is replaced by this direction. The 44 px touch target stays. Task 1 updates `BRIEF.md` and that spec line.

**Colour** (light only; the tokens make a dark theme possible later):

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#EDF1EF` | Ground. A cool survey-map paper. |
| `--sheet` | `#FBFCFB` | Surfaces: the job detail, fields, the selected row. |
| `--ink` | `#17262E` | Text, the route line, the sidebar. |
| `--contour` | `#55656A` | Secondary text (at least 4.5:1 on `--paper`). |
| `--rule` | `#CBD5D2` | Dividers and field borders. |
| `--go` | `#1D7A4E` | A met stop. |
| `--part` | `#8F5D00` | A partial stop, and warnings. |
| `--stop` | `#C42B1C` | A blocker, errors, the "Needs you" badge. |
| `--act` | `#2340C9` | Primary actions, links and the focus ring. |

**Type.** Two families, with clearly different jobs, both self-hosted through `next/font/google`:
- **Overpass** (from the Highway Gothic road-sign letters): headings, navigation, buttons, scores. Weights 600, 700, 800. Scores use tabular figures.
- **Atkinson Hyperlegible** (made for low-vision readers): body text, fields, evidence. Weights 400 and 700.
- Scale with ratio 1.25 from 16 px: 13, 16, 20, 25, 31, 39 px, and 72 px for the score in the job header. Body line height 1.5; headings 1.1 to 1.2. Lines of body text stay under 70 characters.
- Sentence case everywhere. No all-caps labels, no letter-spaced small labels, no monospace labels, no eyebrow text above headings.

**Spacing and shape.** A 4 px base: 4, 8, 12, 16, 24, 32, 48. The radius shows the role: 4 px for controls, 8 px for panels and banners, 16 px for the top corners of sheets. No shadows on rows or sections. A sheet or a popover gets the only shadow. No gradients as decoration.

**Layouts** (spec 8.1, by CSS only):

```
Phone < 640 px                 Tablet 640–1023 px                 Desktop ≥ 1024 px
┌──────────────┐               ┌──┬─────────────────────┐         ┌────────┬───────────┬─────────────────────┐
│ Jobs         │               │▪ │ Jobs                │         │Waypoint│ Jobs      │ Role         86     │
│ [search][⚙]  │               │▪ │ [search] [Filters]  │         │ Jobs   │ [search]  │ Company, city       │
│ chips        │               │▪ │ row ●─●─◐─○   86    │         │ Pending│ row  86   │ Fit │ Your way in   │
│ row ●─●─◐ 86 │               │▪ │ row ●─◐─|─○   54    │  ┌────┐ │ Profile│ row  78   │ ●   │ You─Anna─Co   │
│ row ●─◐─| 54 │               │  │                 ┌───┤──┤side│ │Settings│ row  54   │ ●   │ Your CV       │
│ …            │               │  │                 │job│  │pane│ │        │           │ ◐   │               │
├──────────────┤               │  │                 │   │  │over│ │ working│           ├─────┴───────────────┤
│Jobs Pend Prof Sett│          └──┴─────────────────┴───┘  └────┘ └────────┴───────────┴ [Open] [Applied]────┘
└──────────────┘
Detail: own screen with Back,  Icon rail; the job opens as a       Sidebar (can collapse to the rail), list,
sticky "Mark as applied".      side panel over the list.           and the job beside it.
```

- Text is left aligned. Numbers (scores, counts) are right aligned.
- Pending: stacked sections (phone), a 2 × 2 grid (tablet), 4 columns (desktop).
- Profile and Settings: tabs at the top (phone), a section list on the left (tablet and desktop).
- Forms: 1 column (phone and tablet portrait), 2 columns (desktop).
- Sheets: a bottom sheet (phone), a side panel (tablet and desktop).

**States.**
- **Loading:** placeholder rows that keep the real layout (title line, score box, route strip). A soft pulse, and no motion under `prefers-reduced-motion`.
- **Empty:** a dashed route that ends at a hollow stop, one sentence that says why the screen is empty, and one button for the next action. Each empty state names its real cause: no country is on, the boards have not been fetched, or the filters hide all N jobs (the Pi found that the level filter hid a Senior job with no hint).
- **Error:** next to the action that failed, never only in a toast: a block with a 4 px `--stop` left rule, what happened, what to do, and a retry button. Field errors sit under the field. Errors do not apologise.
- **Background work:** the sidebar (or the top bar on a phone) shows "Checking 12 jobs" from the `Task` table, with a small live dot that does not move under reduced motion.
- **Success:** the action itself confirms ("Copy message" becomes "Copied" for 2 s), and a toast only repeats it.

**Motion.** One moment only: when a job opens, its route draws stop by stop (about 300 ms in total). Nothing else moves on its own. Sheets slide in from their edge because the user opened them.

**Words.** Sentence case, active voice, the same name for an action through its whole flow ("Mark as applied" → "Marked as applied"). Plain words for the user, not for the system ("Your way in", not "Referral routing").

**Done means it looks right too.** A UI task is done only when it works AND it matches this direction at 390, 820 and 1440 px, with no horizontal scroll, every state present, visible focus, and 4.5:1 text contrast. Each UI task's report has screenshots at those 3 widths, and the reviewer looks at them.

## Global Constraints

- **Load `frontend-design`** before any UI work, in every implementer and in every reviewer of a UI task. Follow the visual direction above. Do not add a colour, a font or a radius that is not a token.
- No large UI library. New dependencies only: `swr`, `pdfjs-dist`, `@playwright/test` (dev). Each needs the exact version pinned.
- Fonts come from `next/font/google`, so the browser never calls Google at run time.
- Hover styles only under `@media (hover: hover)`. Touch targets at least 44 px under `@media (pointer: coarse)`. Text fields use 16 px or more. `100dvh`, not `100vh`. Safe-area padding stays.
- Every API route keeps `handle()` + `requireUser`/`requireAdmin`, 404 for another user's row, and its line in the 401 table of `tests/isolation.test.ts`.
- All safety rules of parts 1 to 5 stay: only `src/lib/exec.ts` starts processes; every prompt value uses a wrapper; posting text renders as React text only (no `dangerouslySetInnerHTML`); no secret in rows, replies or logs.
- Vitest runs files in parallel on one shared database: tests make their own users and rows, never delete rows they did not make, and use test country codes `X` + a letter.
- Write all prose, comments, UI text and commit messages in ASD-STE100. Start every reply to the owner with "Shivoy".
- Before each commit: `npm test`, `npm run typecheck` and `npm run lint` pass (lint: 0 errors; the 2 known warnings go away in Task 3 and Task 5, when those files are rewritten).
- Do not run `next build` while a dev server runs on the same folder. Never use ports 3117 or 3118; UI checks use port 3150 with a scratch database.

## Rulings in this plan

- **The visual direction replaces the BRIEF.md fonts and colours** (owner's order of 2026-10-20: the current UI is poor). The 44 px touch target stays. Cost if wrong: the owner asks for a different direction at review, before any code.
- **Resume merges into Profile and Countries moves into Settings** (spec 1.1 and 7.1). The navigation has 4 items: Jobs, Pending, Profile, Settings.
- **Light theme only in part 6.** The tokens allow a dark theme later. Cost if wrong: phone users at night get a light screen.
- **WebKit device tests run on the Pi.** The cloud container has Chromium only, and `playwright install` is not allowed there. The cloud runs the same tests on Chromium device profiles; the owner runs the WebKit profiles (iPhone 15, the iPads) on the Pi.
- **The onboarding wizard stores its state in `UserSettings`** (a new nullable `onboardedAt` and a `wizardStep`), in migration `7_onboarding`. An existing user gets `onboardedAt` set by the migration, so the wizard shows only to new users.
- **Back-end "CAN WAIT (6)" rows go into one task (Task 12),** apart from the UI tasks, so a UI reviewer does not also review data code.

## Review Focus

1. **The route.** In the list and in the detail, can a person tell met, partial, missing and blocker apart without colour (shape: filled, half, hollow, a bar)? Does a screen reader get the same facts as text?
2. **Each layout at its width.** 390, 820 and 1440 px (and 1024 and 1366 for iPad landscape): the right navigation, the right job layout, no horizontal scroll, no layout change after the page loads.
3. **States.** Each screen has its loading, empty and error state, and each empty state names its real cause.
4. **Stale writes.** Two tabs open on the profile: a save from the older tab gets a 409 with a clear message, not a silent overwrite (part 3 I1/I2).
5. **Keyboard and focus.** `/`, `j`/`k`, `Esc`; tabs with arrow keys, Home and End; focus returns to the opener when a sheet closes; a visible focus ring everywhere.

---

### Task 1: The visual direction in code

**Files:**
- Modify: `src/app/globals.css` (replace the tokens and the base styles), `src/app/layout.tsx` (`next/font` for Overpass and Atkinson Hyperlegible, `viewport-fit=cover`, theme colour), `BRIEF.md` (the design tokens section), `docs/superpowers/specs/2026-10-15-production-ready-design.md` (the first line of section 7)
- Create: `src/app/design/page.tsx` (a style page, admin only, that shows the tokens, the type scale, each primitive and each state at the current width), `tests/design-tokens.test.ts`
- Keep: `design/part6/direction.html` as the reference mock.

**Interfaces:**
- Produces: the CSS variables of the direction table (colour, type, spacing, radius), the font variables `--f-sign` and `--f-read`, and the `RouteStrip` and `Route` visual rules, used by every later task.

- [ ] **Step 1:** Load `frontend-design`. Read the direction above and the mock. Write `tests/design-tokens.test.ts`: it reads the colour tokens from `globals.css` and checks contrast of 4.5:1 or more for each text pair (`--ink` and `--contour` on `--paper` and `--sheet`; white on `--act`, `--ink` and `--stop`; `--go`, `--part` and `--stop` as text on `--sheet`). Run it (FAIL: the tokens do not exist yet).
- [ ] **Step 2:** Write the tokens, the fonts and the base styles. Keep the old class names working for now (Tasks 3 to 10 replace them screen by screen), so that no screen breaks between tasks.
- [ ] **Step 3:** Build `/design` (admin only, 404 for a member). Take screenshots at 390, 820 and 1440 px with a scratch database on port 3150, and compare them with the mock. Fix what does not match.
- [ ] **Step 4:** Commit `Set the part 6 visual direction: tokens, fonts and the style page`.
- [ ] **Step 5 (controller):** Look at the screenshots. The task is done only if the style page matches the direction.

### Task 2: UI primitives

**Files:**
- Create: `src/components/ui/` — `Button.tsx`, `Field.tsx` (label, hint, error under the field), `Panel.tsx`, `Sheet.tsx` (bottom sheet under 640 px, side panel above; focus trap, `Esc`, focus back to the opener), `Tabs.tsx` (arrow keys, Home, End; `aria-selected`), `Badge.tsx`, `EmptyState.tsx` (the dashed route, a cause sentence, one action), `ErrorNote.tsx` (left rule, what happened, what to do, retry), `Skeleton.tsx`, `RouteStrip.tsx` (compact stops for a row), `Route.tsx` (the full requirement route with evidence), `WayIn.tsx` (You → contact → company), `TaskIndicator.tsx`, `Toast.tsx`, `index.ts`
- Test: `tests/ui-primitives.test.ts` (render with `react-dom/server` to static markup; no testing library dependency)

**Interfaces:**
- Produces: the components above. `RouteStrip` and `Route` take `{ status: 'met' | 'partial' | 'missing'; label: string; evidence?: string[] }[]` and `blockers: { label: string }[]`, and print a text form for screen readers ("4 of 6 met, 1 partial, 1 blocker: Swiss work permit").

- [ ] **Step 1:** Load `frontend-design`. Write the failing tests: the route text form; each status has a distinct shape class; `Sheet` and `Tabs` have the right ARIA roles; `Field` links its error with `aria-describedby`; `EmptyState` needs a cause and an action.
- [ ] **Step 2–4:** Run (FAIL), build the primitives on the tokens only, run (PASS). Add each primitive to `/design`, and take screenshots at the 3 widths.
- [ ] **Step 5:** Commit `Add the UI primitives of the route-map direction`.

### Task 3: The app shell, navigation and the home-screen app

**Files:**
- Modify: `src/components/Waypoint.tsx` (4 items: Jobs, Pending, Profile, Settings; remove `useIsPhone()`), `src/app/layout.tsx`, `src/app/globals.css`
- Create: `src/components/shell/` (`Sidebar.tsx` that collapses to the rail, `Rail.tsx`, `TabBar.tsx`, `TopBar.tsx`), `public/manifest.webmanifest`, `public/icons/` (192, 512, the Apple touch icon; the icon is the brand stop from the mock)
- Test: `tests/shell.test.ts`

**Interfaces:**
- Produces: the shell with the 3 layouts by CSS. The "Needs you" badge on Pending. `TaskIndicator` reads the running and queued task count ("Checking 12 jobs"). Rotation keeps the open job and the scroll position.

- [ ] **Step 1:** Load `frontend-design`. Failing tests: 4 nav items, Resume and Countries are not top-level; the manifest has the icons and the theme colour `#17262E`; no `useIsPhone` import is left (grep test).
- [ ] **Step 2–4:** Run, build, run. Screenshots at 390, 820, 1024 and 1440 px.
- [ ] **Step 5:** Commit `Rebuild the app shell with 4 places and a layout for each device`.

### Task 4: Data with SWR, the state split and stale writes

**Files:**
- Modify: `src/app/api/state/route.ts` (split into `/api/jobs/list`, `/api/pending`, `/api/me`; keep `/api/state` until no screen uses it, then remove it), `src/components/api.ts`, `src/components/hooks.ts`, `src/lib/profile/store.ts` and the profile routes (expected `version` in each write → 409 `Your profile changed in another tab. Load the new version, then make the change again.`), `src/lib/etag.ts`
- Test: `tests/api-state-split.test.ts`, `tests/profile-version.test.ts`, `tests/etag.test.ts`

**Interfaces:**
- Produces: one SWR hook for each route (`useJobs(filters)`, `usePending()`, `useMe()`, `useProfile()`, `useSettings()`), with an abort signal on unmount; ETags that do not change each minute (part 4 row 30); a Settings load that still shows the other sections when `/api/feeds` fails (part 4 row 19); the profile version check (part 3 I1, I2: double accept and stale tabs).

- [ ] **Step 1:** Failing tests: each new route is in the 401 table and gives only the user's rows; the ETag of an unchanged list is the same after 2 minutes; a profile write with an old version gives 409 and changes nothing; a double accept of one draft writes once.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5:** Commit `Load each screen with SWR and refuse stale profile writes`.

### Task 5: The jobs list

**Files:**
- Modify: `src/components/JobsScreen.tsx` (split: `jobs/JobList.tsx`, `jobs/JobRow.tsx`, `jobs/FilterSheet.tsx`, `jobs/FilterChips.tsx`, `jobs/AddJobSheet.tsx` for a pasted link, `jobs/JobsEmpty.tsx`)
- Test: `tests/jobs-list.test.ts`

**Interfaces:**
- Produces: a row with role, company, city and mode in words, the score, the `RouteStrip`, a referral or blocker line; one "Filters" button that opens a sheet; active filters as removable chips; sort by match or date; placeholder rows; the empty states by cause (no country on, not fetched, filters hide all N); the level filter default does not hide Senior jobs without saying so (Pi minor); `/` focuses search, `j`/`k` move the selection on desktop and on an iPad with a keyboard; the pasted-link note and warning show inline in the sheet, not only in a toast (Pi minor).

- [ ] **Step 1:** Load `frontend-design`. Failing tests for the empty-state cause, the filter chips, the sort, and the keyboard handler (pure functions).
- [ ] **Step 2–4:** Run, build, run. Screenshots at 390, 820 and 1440 px with 0, 3 and 50 jobs, and with filters that hide every job.
- [ ] **Step 5:** Commit `Rebuild the jobs list on the route strip`.

### Task 6: The job detail

**Files:**
- Create: `src/components/job/` — `JobHeader.tsx` (role, company, score, "Open posting"), `FitSection.tsx` (summary, blocker banner, the injection warning, the top 3 `must` requirements on the `Route`, "Show all", "How this score was made"), `WayInSection.tsx` (best contact and the reason, the note editor with the character counter, "Copy message", "Send request"), `CvSection.tsx` (build or rebuild, the PDF preview with `pdfjs-dist`, "Open" and "Download", refine chat, wording suggestions, keyword report), `ApplyBar.tsx` (sticky "Mark as applied")
- Modify: the old detail code in `JobsScreen.tsx` goes away.
- Test: `tests/job-detail.test.ts`

**Interfaces:**
- Produces: the detail of spec 7.4 in that order, as a full screen with Back (phone), a side panel over the list (tablet), and the right pane (desktop). The route draws stop by stop when a job opens (300 ms, none under reduced motion). Errors next to their action: a LaTeX failure shows the first 20 log lines with no paths outside the user's folder (spec 9); "Suggest wording" with the CLI off says that the CLI is off and what to do (Pi minor). Reword the 3 labels of part 5 row 20.

- [ ] **Step 1:** Load `frontend-design`. Failing tests: the section order; the PDF preview has Open and Download links; a LaTeX error text is cut to 20 lines and has no absolute path outside the user's folder; posting text renders as text only.
- [ ] **Step 2–4:** Run, build, run. Screenshots at 390, 820 and 1440 px: a strong match, a job with a blocker, a job with the injection warning, a CV build error.
- [ ] **Step 5:** Commit `Rebuild the job detail: fit, your way in, your CV`.

### Task 7: Pending

**Files:**
- Modify: `src/components/PendingScreen.tsx` (split into `pending/*`)
- Test: `tests/pending-screen.test.ts`

- [ ] **Step 1:** Load `frontend-design`. Failing tests for the section counts and the "Needs you" count.
- [ ] **Step 2–4:** Run, build (stacked on phone, 2 × 2 on tablet, 4 columns on desktop, an empty state for each section), run. Screenshots at the 3 widths.
- [ ] **Step 5:** Commit `Rebuild Pending in sections for each device`.

### Task 8: Profile, with the résumé inside it

**Files:**
- Modify: `src/components/ProfileScreen.tsx`, `src/components/profile/*`, `src/components/ResumeScreen.tsx` (moves into a Profile tab)
- Test: `tests/profile-screen.test.ts`

**Interfaces:**
- Produces: tabs Experience, Projects, Claims, Imports (with a draft count badge), Résumé (template or own `.tex`, revision history); tabs at the top on a phone, a section list on the left on tablet and desktop; the part 3 UI rows 13 and 14 (no "No claims yet" on an empty search, a Retry on a failed first load, Home and End on tabs, distinct names for the 2 "Remove" buttons and for Accept/Edit/Reject of each draft, readable Facts keys, token colours instead of hard-coded warning colours, one `role=alert` region, correct plurals); the 409 message of Task 4 shown next to the save button; `accept` attributes on each file input (`.pdf`, `.tex`, `.zip`, `.yml`).

- [ ] **Step 1:** Load `frontend-design`. Failing tests for the plurals, the button names, the empty-search text and the file `accept` values.
- [ ] **Step 2–4:** Run, build, run. Screenshots at the 3 widths for each tab, with and without data.
- [ ] **Step 5:** Commit `Rebuild Profile in sections and move the résumé into it`.

### Task 9: Settings, with countries and boards inside it

**Files:**
- Modify: `src/components/SettingsScreen.tsx`, `src/components/CountriesScreen.tsx` (moves into Settings, "Job search"), `src/lib/settings.ts`, `src/app/api/settings/route.ts`
- Test: `tests/settings-screen.test.ts`, `tests/settings.test.ts`

**Interfaces:**
- Produces: sections Account, Claude, Job search (countries, boards, fields, visa), Integrations (GitHub, Drive), Data (YAML import and export, delete account), Admin (users, invites; admin only); 2-column forms on desktop; the Claude section shows the cap, the use and the reset date (spec 9) and says when the CLI is off after its self-test; board fetch failures show next to the board (spec 9). Part 5 rows 1 and 2: unique fields (`.refine`) and an upsert save.

- [ ] **Step 1:** Load `frontend-design`. Failing tests: duplicate fields give 400; a double save does not give 500; the admin section is absent for a member.
- [ ] **Step 2–4:** Run, build, run. Screenshots at the 3 widths, member and admin.
- [ ] **Step 5:** Commit `Rebuild Settings in sections with job search inside it`.

### Task 10: The onboarding wizard

**Files:**
- Create: `prisma/migrations/7_onboarding/migration.sql` (`UserSettings.onboardedAt`, `wizardStep`; set `onboardedAt` for every existing user), `src/components/onboarding/*`, `src/app/api/onboarding/route.ts`
- Modify: `src/components/Waypoint.tsx` (show the wizard when `onboardedAt` is null), `tests/isolation.test.ts`
- Test: `tests/onboarding.test.ts`

**Interfaces:**
- Produces: the 6 steps of spec 7.2 (name and password; countries and visa; a Claude key only when the user has no credential or wants an own key; imports; review drafts; the first refresh, then Jobs). Each step can be skipped and continued later from Settings. A step indicator drawn as a route (this is a real sequence).

- [ ] **Step 1:** Load `frontend-design`. Failing tests: an existing user is not sent to the wizard after the migration; the Claude step is skipped for a user with a credential; skip and continue keep `wizardStep`; another user cannot read or set the state.
- [ ] **Step 2–4:** Run, build, run. Screenshots of each step at 390 and 1440 px.
- [ ] **Step 5:** Commit `Add the onboarding wizard for invited users`.

### Task 11: Input, accessibility and iOS

**Files:**
- Modify: `src/app/globals.css` and the components that need it
- Create: `tests/a11y-static.test.ts`

- [ ] **Step 1:** Failing tests (static checks over the source): no hover rule outside `@media (hover: hover)`; no `100vh`; every `<input>`, `<select>` and `<textarea>` has a label; font size of fields at least 16 px; no `dangerouslySetInnerHTML`.
- [ ] **Step 2–4:** Run, fix, run. Check with the keyboard only at 1440 px: every action reachable, focus visible, sheets return focus. Check the reduced-motion setting.
- [ ] **Step 5:** Commit `Close the input, focus and iOS gaps`.

### Task 12: Back-end items from the earlier reviews

**Files:** as each row names.

- [ ] **Step 1:** Fix these "CAN WAIT (6)" rows with a test each, or close them in the ledger with an "ACCEPT" ruling and its reason:
  - Part 3: the stale `claims.ts` header, limits written twice, `diffDocs` key order, unguarded `JSON.parse` of snapshots and counts, `ProfileError` double errors, the colliding bullet ID and merged bullets over 8, YAML reject and create in one transaction, the Content-Length test, duplicate skills `java-2`, zero valid items with no message, the GitHub token save in one transaction and the warning for another owner's repo, the missing tests of rows 3, 7 and 12, the stray "(Task 9)" in `exec.ts`.
  - Part 4: row 10 (timeout one interval early, unchecked `as T`, null-user row).
  - Part 5: rows 15, 16, 18 (heuristic score parts that do not add up to the badge), 24 (no LaTeX engine: a clear error, not a 500, and no paid outreach call before it fails), 25, 26, 27 (delete expired `base-failed` records), 29, 30, 32 (suggestion number rules), 40 and 41 (the canary timeout at worker start and `SIGTERM`), 47 (scrub the remaining error texts), 50 (check old project `tex` rows again in `tailorTex`), and the Ghostscript 10.02 ligature form in `pdf-colour.ts` (Minor 7).
- [ ] **Step 2:** Run `npm test`, typecheck and lint.
- [ ] **Step 3:** Commit in small commits, one subject for each group.

### Task 13: Device tests

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/*.spec.ts` (sign-in, the wizard, the job detail, the CV build with a mocked compile), `docs/devices.md` (the manual checklist for a real iPhone and iPad: the on-screen keyboard over forms, the Files picker for each upload type, the home-screen app, rotation, the PDF preview)
- Modify: `package.json` (`"test:e2e"`, `@playwright/test` pinned)

- [ ] **Step 1:** Write the smoke tests for the 6 profiles of spec 8.5. They start the app on port 3150 with a scratch database and a mocked Claude. In the cloud, run them on Chromium (`executablePath: '/opt/pw-browsers/chromium'`); the WebKit profiles run on the Pi.
- [ ] **Step 2:** Run on Chromium. Expected: PASS, and a screenshot of each test at each profile.
- [ ] **Step 3:** Commit `Add device smoke tests and the manual device checklist`.
- [ ] **Step 4 (owner, on the Pi):** run the WebKit profiles, then the manual checklist on a real iPhone and iPad.

### Task 14: Visual review of the whole app

- [ ] **Step 1 (controller):** Load `frontend-design`. Take screenshots of every screen and every state at 390, 820, 1024, 1366 and 1440 px. Compare each with the direction. List every place that does not match, or that looks generic, and fix it in one wave.
- [ ] **Step 2:** Commit `Polish the screens against the visual direction`.

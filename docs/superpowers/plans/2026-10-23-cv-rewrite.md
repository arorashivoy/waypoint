# CV Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude writes the project entries and the experience bullets of each tailored CV from the whole profile, in the style of the base CV, and code checks every line against its sources before it reaches the PDF.

**Architecture:** A worker step (`writeCv`) asks Claude for plain-text lines with their sources, checks each line with `checkSuggestion`, and stores the result in the steer of the application (`steer.written`). `buildResume` stays pure: it applies `steer.written` when it renders (own `.tex`: code builds each project entry in the shape of the base CV's first entry; template: `renderTemplate` uses the text). The build re-checks the stored lines against the current profile.

**Tech Stack:** TypeScript, Next.js 14, Prisma/SQLite, zod, vitest, the Claude ask path (`askJsonCached`).

**Spec:** `docs/superpowers/specs/2026-10-23-cv-rewrite-design.md`

## Global Constraints

- A line can say only what its sources prove: `checkSuggestion` with the sources of that line; the check never reads the posting.
- Only code writes LaTeX. Every value from the model or the profile goes through `escapeLatex`.
- The number of projects and of bullets for each position stays as the base CV has them (or `RESUME_MAX_PROJECTS`).
- Without Claude (`claudeStatus(...).mode === 'none'`), the build works exactly as before.
- Prose in code comments, UI text and commits: ASD-STE100. Sonnet only; no `fallbacks`.
- Each line of the model is at most `MAX_SUGGESTION_TEXT` (300) characters.

## Change from the spec (the builder's call)

- Spec 5.6 "Use my tex as written" is a per-job "Use my original" on each project, not a profile setting. Reason: a profile field needs a migration, the import and the editor, for little gain.
- Spec 8 "Eval": a live script (`scripts/cv-write-check.ts`) runs `cv-write` on attack postings 3 times and reports any line that reached `written`. The job-check eval is not extended.

## Review Focus

1. A model line that names a source id that does not exist: the line is dropped, with a reason.
2. A stored `written` after the user deleted a claim or a bullet: the build re-checks and falls back to the original text.
3. A profile value with `\input`, `$` or `%`: it prints as text in both modes.
4. A base CV whose first project entry has no `\textbf{...}` heading: the shape falls back to `\item \textbf{T} \\` and the build still compiles.
5. A refine request for a fact that the profile does not have: the reply names the missing claim, and no line with that fact is stored.

---

### Task 1: The written lines and their check

**Files:**
- Create: `src/lib/resume/written.ts`
- Test: `tests/cv-written.test.ts`

**Interfaces:**
- Consumes: `checkSuggestion(s, ctx)` and `Suggestion` from `src/lib/resume/suggest.ts`; `ClaimsDoc` from `src/lib/claims`.
- Produces:
  - `WriteReply` (zod): `{ projects: { id: string; heading: string; tech: string; year: string; lines: string[]; sources: string[] }[]; bullets: { id: string; text: string; sources: string[] }[]; reply: string }`. Max 8 projects, 30 bullets, 3 lines each.
  - `type Written = { bullets: Record<string, { text: string; old: string }>; projects: Record<string, { heading: string; tech: string; year: string; lines: string[]; old: string }>; dropped: { id: string; why: string }[] }`
  - `checkWritten(reply: WriteReplyT, doc: ClaimsDoc): Written`
  - `effectiveWritten(w: Written | undefined, doc: ClaimsDoc, keep: string[]): Written` (re-check; ids in `keep` are left out)
  - Ids: a bullet is `positionId/bulletId`; a project is its profile id. A source is a bullet id, `project:<id>` or a claim slug.

- [ ] **Step 1:** Write the failing tests:
  - `keeps a bullet whose words come from its sources`: bullet `goldman/validator` old text "Built a Python validator for remediation updates", source claim `test-evidence-automation` with proof "automated release test evidence capture"; new text "Built a Python validator that automated release test evidence capture" → in `bullets`.
  - `drops a line with a tool that no source has, also when the posting asks for it`: text adds "Kubernetes" → not in `bullets`; `dropped` has `{ id: 'goldman/validator', why: /kubernetes/i }`.
  - `drops a line that names an unknown source`: source `nope` → dropped with why "unknown source nope".
  - `writes a project with no tex from its description and claims`: project `claude-code-skills` (no tex), lines that use words of its description → in `projects`, `old` is the description.
  - `drops a project line with a number that is not in its sources`: "cut review time by 40%" → line dropped; when no line is left, the project is not in `projects`.
  - `drops the year and the tech when they fail`: year "2025" not in sources → `year: ''`; tech "Rust" not in sources → `tech: ''`.
  - `effectiveWritten leaves out kept ids and lines that the profile no longer proves`.
- [ ] **Step 2:** Run `npx vitest run tests/cv-written.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `src/lib/resume/written.ts`. For each line, build the `checkSuggestion` context: `sourceText` = the old text of the bullet or the project (title, description, bullets), plus the text of each named bullet; `proofs` = the proofs of each named claim; `skills` = the labels of all skill claims; `current` = undefined (a line equal to the old text is kept, not refused). Check `heading` against the project title and description; `tech` and `year` with the same context.
- [ ] **Step 4:** Run the test again. Expected: PASS.
- [ ] **Step 5:** Commit `Check each written CV line against its own sources`.

### Task 2: The `cv-write` prompt

**Files:**
- Modify: `src/lib/prompts/resume.ts` (add `WRITE_SYSTEM`, `writePrompt`), `src/lib/prompts/builder.ts` (`PromptName` += `'cv-write'`, `PROMPT_VERSIONS['cv-write'] = 'cv-write-1'`)
- Test: `tests/cv-write-prompt.test.ts`

**Interfaces:**
- Produces: `writePrompt(input: { projects: { id; title; description; bullets: string[]; claims: { slug; label; proofs: string[] }[] }[]; positions: { id; title; company; bullets: { id; text }[] }[]; style: string[]; job: { role; company; description }; request?: string })`.

- [ ] **Step 1:** Failing tests: the profile and the style lines are inside `<profile>`; the posting is inside `<untrusted>`; the request, when given, is inside `<untrusted>` too (it is pasted text); the system text says "never add a fact", "plain text, no LaTeX" and "name the sources of each line".
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with the `prompt`, `profile`, `untrusted`, `untrustedFields` and `sanitise` helpers, as `suggestPrompt` does. Style lines are the text of the base CV's project and bullet lines (LaTeX stripped by `stripTex` from Task 3), at most 12.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `Add the cv-write prompt`.

### Task 3: Rendering the written lines

**Files:**
- Modify: `src/lib/resume.ts` (`tailorTex` gets `written: Written`; projects without `tex` join the pool when written or described; add `projectShape(tex: string): Shape`, `renderEntry(shape: Shape, p: { heading; tech; year; body }): string`, `stripTex(line: string): string`; `buildResume` merges `written.bullets` into the wording map before `applyWording`, an accepted suggestion wins)
- Modify: `src/lib/resume/template.ts` (`renderTemplate` uses `steer.written` for heading and lines)
- Test: `tests/cv-render-written.test.ts`

**Interfaces:**
- Consumes: `Written`, `effectiveWritten` (Task 1); `escapeLatex` (template.ts).
- Produces: `Steer.written?: Written`, `Steer.keep?: string[]` (in `src/lib/resume.ts`).

- [ ] **Step 1:** Failing tests:
  - `reads the shape of the first project entry` from the owner's form `\item \textbf{Bish} --- C, Linux \hfill 2022 \\` → shape with tech and year; an entry with no `\textbf` → the plain shape.
  - `puts a project with no tex on an own .tex CV` (the pool takes it when its score is above the floor).
  - `replaces an on-CV entry with its written form, and keeps it when the id is in keep`.
  - `escapes every value`: heading `a $x$ \input{/etc/passwd} 100%` prints `\$`, `\textbackslash{}input`, `\%`.
  - `the template prints the written heading and lines`.
  - `an accepted suggestion wins over a written bullet`.
  - `the section keeps its number of entries`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. `renderEntry` builds `\item \textbf{H} --- T \hfill Y \\` + newline + 6 spaces + the lines joined by a space, every value through `escapeLatex`; leave out ` --- T` and `\hfill Y` when empty. A project with neither `tex` nor written text uses its description as the body.
- [ ] **Step 4:** Run the test and `tests/resume*.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `Render written CV lines in both résumé modes`.

### Task 4: The flow: build, refine and "Use my original"

**Files:**
- Modify: `src/lib/cv.ts` (add `writeCv(app, job, request?)`; `refineCv` calls it after the steer call with the request; `cvView` returns `changes: { id: string; kind: 'bullet' | 'project'; old: string; now: string }[]` and `droppedLines: { id; why }[]`), `src/lib/tasks/handlers.ts` (action `generate` calls `writeCv` first when Claude is on), `src/app/api/jobs/[id]/resume/suggestions/route.ts` (action `original` with `id` adds the id to `steer.keep` and queues a build)
- Test: `tests/cv-write-flow.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `writeCv(app: Application, job: Job, request?: string): Promise<Written | null>` (null when Claude is off).

- [ ] **Step 1:** Failing tests (mock `askJsonCached`): generate stores `steer.written` and the view lists the changes; Claude off → no call, build as before; refine with "add the evidence-capture detail" stores the reworded bullet; a reply line that fails the check is in `droppedLines`, not in the CV; `{ action: 'original', id }` by another user → 404; by the owner → the id is in `steer.keep`; reset clears `written` and `keep`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. `writeCv` uses `askJsonCached('cv-write', PROMPT_VERSIONS['cv-write'], …, { perUser: true })`, chooses the projects and positions of the current order (`buildCv(app, job, { compile: false })`), then `checkWritten`. The refine reply adds "Reworded N lines." and, for each dropped line, "Not used: <why>."
- [ ] **Step 4:** Run the test, `tests/isolation.test.ts` and `tests/api-*.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `Write the CV for each posting in the worker and in Refine`.

### Task 5: "What changed" in the CV panel

**Files:**
- Modify: `src/components/job/CvSection.tsx`, `src/components/job/types.ts`, `src/components/job/useJobDetail.ts` (an `original(id)` action), `src/app/globals.css`
- Test: `tests/job-detail.test.ts`

- [ ] **Step 1:** Load the `frontend-design` skill. Failing tests: the fold lists each change as the old line (struck) and the new line, with a "Use my original" button; dropped lines show "Not used" with the reason; no list when there is no change.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement in the panel style (`jd-block`, `jd-suggestion`). One quiet button for each change.
- [ ] **Step 4:** Run; expect PASS. Take screenshots at 390 and 1440 px on the scratch app and look at them.
- [ ] **Step 5:** Commit `Show what the written CV changed, with Use my original`.

### Task 6: Live check, docs, release

**Files:**
- Create: `scripts/cv-write-check.ts`
- Modify: `README.md` (section "Tailored CVs"), `tests/` pins of prompt versions if any

- [ ] **Step 1:** Write `scripts/cv-write-check.ts`: runs `writeCv`'s call and check on 3 attack postings (a posting that asks for "Kubernetes", one that asks for "10 years", one with a fake JSON reply), 3 times each, on the synthetic profile, and prints each line that reached `written` with a number, a name or a tool from the posting. Expected: none.
- [ ] **Step 2:** Run it on the Pi with the CLI. Read every kept line by hand.
- [ ] **Step 3:** Update README "Tailored CVs": the new rule (written from the whole profile, checked against sources), and remove "Nothing is generated".
- [ ] **Step 4:** Full checks: `npm test`, `npm run typecheck`, `npm run lint`, the job-check eval (no change expected), `npm run test:e2e`.
- [ ] **Step 5:** Real compile: build the owner's CV for one job on a scratch copy of the live database with the CLI; open the PDF and check it by eye.
- [ ] **Step 6:** Commit, push `multi-user`, merge PR #3 into `main`, run `./scripts/deploy.sh`, check `/api/health`.

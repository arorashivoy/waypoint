# Design: a CV written for each posting, from the whole profile

Date: 2026-10-23. Owner: Shivoy. Status: draft for the owner's review.

## 1. Why

The owner asked Refine with Claude to add a detail to the validator bullet, and to put his Claude Code skills work on the CV. Waypoint refused both: it can only choose and order lines that already exist, and a project with no hand-written `tex:` entry can never go on the PDF of an own `.tex` CV. 8 of his 16 projects have no `tex:` entry, the new "Claude Code engineering skills" project too.

The owner's rule (2026-10-23): "Any project can be used and reworded if it is in my profile. The base resume is just for reference, like one-shot prompting."

This reverses the rule in `tailorTex` ("the wording of a CV line is not something to generate behind his back"). The reason for the old rule stays true: a CV line is a claim about a real person, and a recruiter reads it as fact. So the new design keeps one hard limit: **a line can say only what the profile proves.** Claude writes the words. Code checks every line against its sources before it reaches the PDF.

## 2. Goals

1. Every project in the profile can go on the CV, with or without a `tex:` entry.
2. Claude rewrites the project text and the experience bullets for each posting, in the style of the base CV.
3. Refine with Claude can reword lines ("add the evidence-capture detail to the validator bullet"), not only reorder them.
4. Each written line names its sources (bullets, project text, claims). Code checks it against those sources only.
5. The user sees what changed (old line and new line) and can put back the original of any line.

## 3. Non-goals

- No change to the job check, the referral messages, or the import.
- Suggest wording stays as it is. It can be merged into this flow later.
- No new sections (summary, awards) are written. The sections and their order stay as the base CV has them.
- No layout work: no fonts, no margins, no new LaTeX macros.

## 4. Anti-goals (a failure even if it works)

- A number, a name, a tool or a result on the PDF that the profile does not prove.
- Text from the job posting on the CV that the profile does not back (the posting is untrusted).
- LaTeX written by the model. Only code writes LaTeX, and every value is escaped.
- A CV that grows to 2 pages.
- A silent change: the user must be able to see every reworded line.

## 5. How it works

### 5.1 Choosing (code, as today)

`rankEvidence` and the steer pick the projects, the bullet order and the skills, as today. The change: every project in the profile can win a slot, not only projects with a `tex:` entry. The number of projects and the number of bullets for each position stay as in the base CV (or `RESUME_MAX_PROJECTS`), so the CV keeps its length.

### 5.2 Writing (one Claude call for each build)

A new prompt, `cv-write`, goes to Sonnet with the user's credential, as the other prompts do. It gets:

- the chosen projects and positions, each with its full profile text (title, description, bullets) and the proofs of its claims;
- the lines of the base CV as the style example (the "one shot");
- the posting, fenced as untrusted text, only to choose emphasis and words;
- for a refinement, the user's request.

It returns JSON only, no LaTeX:

- for each chosen project: `heading` (title), `tech` (a short list), `year`, and 1 to 3 `lines`;
- for each chosen bullet: a new `text`;
- for each line: `sources`, the ids of the bullets, projects and claim slugs it uses.

### 5.3 Checking (code)

Each line goes through the check of Suggest wording (`checkSuggestion`), with its own sources as the evidence: each number, each word with a capital letter, and each technology must be in the source text or in the proofs of the named claims. The check never reads the posting, so the posting cannot add a fact. The injection scan runs on each line. A length limit keeps each line near the length of the line it replaces.

When a line fails:

- a rewritten bullet goes back to its original text;
- a project line is dropped, and when a project has no line left, its profile description is used as written;
- the reason goes to the "what changed" list.

### 5.4 Rendering (code)

- **Built-in template:** `renderTemplate` already prints any project from the profile. It gets the checked text through the wording map.
- **Own `.tex`:** code takes the shape of the first project entry of the base CV (for example `\item \textbf{TITLE} --- TECH \hfill YEAR \\` and the text under it) and builds each project entry in that shape, with every value escaped by `escapeLatex`. A hand-written `tex:` entry still wins when the user wants it as written (see 5.6). If the shape cannot be read, the section keeps today's behaviour, and the reason shows.
- The compile, the one-page check and the fallback to the base PDF stay as today.

### 5.5 Refine with Claude

The chat request goes into the same `cv-write` call. The chat can now reword lines, and the check of 5.3 applies to each line. A request that needs a fact the profile does not have gets a reply that names the missing claim ("Add a claim for X in Profile, then ask again").

### 5.6 The user stays in control

- The CV panel shows "What changed": each reworded line as old and new, each dropped line with its reason.
- "Use my original" on a line keeps the original text of that line for this job.
- A setting on a project, "Use my tex as written", stops Waypoint from rewording that project.
- Without Claude (no key, CLI off), the build works as today: choose and order only.

## 6. Cost and cache

One call for each build and each refinement, cached on the hash of the model, both prompts and the profile version, as the other prompts. The build already waits for the worker, so the user sees no new step.

## 7. Calls the builder made (the owner can change them)

- The rewrite is applied at once, with the "What changed" list and "Use my original", not held for approval line by line. Reason: the owner wants a tailored CV without extra steps; the check stops the unsafe lines.
- The section counts stay as in the base CV, so the CV stays on one page.
- A hand-written `tex:` entry is reworded too, unless the project has "Use my tex as written".
- Suggest wording stays as a separate tool for now.

## 8. Tests

- Unit: the check refuses a line with a number, a name or a tool that its sources do not have, also when the posting has it.
- Unit: the own-`.tex` shape is read from the base CV, and every value is escaped (a `\input` or `$` in a profile value prints as text).
- Unit: a project without `tex:` goes on the own-`.tex` CV.
- Unit: a failed line falls back as 5.3 says.
- Eval: new fixtures for `cv-write`, with an attack in the posting that asks for a fact or a tool on the CV. The bar is 100 %: no unproven fact reaches the PDF.
- Real compile on the Pi of the owner's own `.tex` with 2 projects that have no `tex:`, and a manual check of the PDF.

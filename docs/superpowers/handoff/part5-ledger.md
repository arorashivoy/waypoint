# SDD ledger — plan: docs/superpowers/plans/2026-10-17-prod-part5-prompts.md

Spec: docs/superpowers/specs/2026-10-15-production-ready-design.md (sections 5, 6). Branch `multi-user`. Plan commits e2c7c04, f509188 (the owner added pasted job URLs and a default base résumé).

## Pre-flight scan

| Tasks | Shared file / interface | Finding |
|---|---|---|
| 1 → 4, 9, 13, 14 | `getSettings(userId)` (fields, visaStatus) | Consistent. |
| 1 → 3, 11 | Task 3 needs a "run once" flag row; Task 11 needs a `cliDisabled` row; no task makes a table for them | Gap. Ruling below. |
| 2 → 4, 8, 9, 10, 12 | every new prompt uses `prompt` and the wrappers | Consistent; later dispatches name it. |
| 3 → 9 | refine/referral refusal happens in the route; Task 9 moves the referral call into a task | The refusal must stay in the route before the enqueue. Carried in the Task 9 dispatch. |
| 4 → 5 | `Analysis` shape (`JobCheck & { score, parts, by, promptVersion }`) | Consistent. |
| 4 → 14 | eval runs the job check | Consistent. |
| 6 → 7 | `checkOwnTex` used in a Task 7 test; `resumeConfig()` takes no argument today, Task 7 writes `resumeConfig(userId)` | Signature change. Ruling below. |
| 7 → 8 | Task 8 accepts a wording override into the steer; Task 7 renders only the template | Overrides must apply in both modes. Ruling below. |
| 8, 1 | migrations `4_settings` (Task 1) and `5_suggestions` (Task 8) | Order is fine. |
| 9, 12, 7 | new task kinds `outreach`, `paste`, cv action `base` | Sequential; each extends `TaskKind`/the cv payload. |
| 12 → 13 | safety tests include the pasted URL | Consistent (plan edited). |
| 1 (self) | `SettingsSchema` uses `checkForInjection` (Task 3 extends it later) | Fine. |
| 4 (self) | example score 85.7 is before fits | Agrees with the formula. |
| 5 (self) | browser check "controller may do this at the end" | Agrees. |
| 6 (self) | admin keeps `RESUME_TEX` | Agrees with plan rulings. |
| 7 (self) | copies `resume.cls` from the admin's folder outside the repo | The dispatch gives the path; the notice permits copying. |
| 10 (self) | `pdftohtml` new exec program | Agrees with the exec rule (fixed template). |
| 12 (self) | `shape()` in `sources/index.ts` is not exported | The implementer exports it. |
| 14 (self) | Step 3 is a controller step with real calls | Uses the CLI subscription (no API cost), as the owner allowed. |

Ruling: Task 1's migration `4_settings` also creates `AppState` (`key` id, `value` JSON text, `updatedAt`) with `getState(key)`/`setState(key, value)` in `src/lib/app-state.ts`; Task 3 uses it for the one-time draft rescan and Task 11 for `cliDisabled` — the plan names the rows but no table — cost if wrong: one small table.
Ruling: Task 6 changes `resumeConfig()` to `resumeConfig(userId: string)` and updates its callers; Task 7 builds on that — the plan uses both forms — cost if wrong: none.
Ruling: Task 8's accepted wording overrides apply in both résumé modes: the template renders the new text; an own `.tex` gets the bullet line text replaced through the existing `match` lookup, escaped — the plan named only the steer — cost if wrong: an own-tex user sees no change after accept.

## Tasks
Task 1: dispatched (base f509188, sonnet)
Note: browser check owed for the Settings Job search card (Task 1) — do with the UI checks before the final review.
Task 1: review — spec ✅, quality approved (360 px browser check owed, see note)
Task 1: minor (deferred): duplicate fields allowed; save is find-then-write (use upsert); no test for the RESUME_TEX admin branch; 3 more in task-1-review.md
Task 1: complete (commits f509188..971a778, review clean)
Task 2: dispatched (base 971a778, sonnet)
Task 2: review (opus) — spec ❌, quality needs fixes (1 Critical: one-pass fence strip lets a nested tag close the fence; 3 Important: onFile string[] via trusted(); cast scan too narrow; refine history fenced as untrusted instead of request)
Task 2: ⚠️ confirmed real: CLI repair prompt (claude/index.ts:73) concatenates zod error text from the model reply outside the builder — added to the fix round.
Ruling: fenced values neutralise every '<' and '>' (to the full-width forms) instead of a looping strip — one rule closes every fence escape — cost if wrong: a posting with < or > shows the full-width form to the model only.
Ruling: in refine, the candidate's own earlier requests go in request() and Claude's earlier answers in untrusted(), each turn in its own fence — spec 6.3 tiers — cost if wrong: none expected.
Task 2: fix round 1/5 (5 addressed, 0 open; commits 4fe77db..3066790). Quote rule safe: quoteCheck uses NFKC, which maps the full-width brackets back.
Task 2: minor (deferred): history cap per turn rose from 600 to 2000/20000; refine prompt does not explain the request blocks in history; cast scan misses angle-bracket casts; 6 more in task-2-review.md
Task 2: complete (commits 971a778..3066790, review clean)
Task 3: dispatched (base 3066790, sonnet)
Task 3: review (opus) — spec ❌ (reply floor weaker: 11 of 29 probes fired before and are quiet now), quality needs fixes (2 Important: floor weakened; dead .env branch)
Ruling: two signal sets — the broad set (at least as strict as before, plus the new signals) for all third-party text including the reply floor and drafts; the soft set only in refuseUserRequest for the user's own words — spec 6.3 keeps the floor — cost if wrong: more 'needs you' replies.
Task 3: Ruling: raise the Minor 'the model's own referral draft can be refused on send with no approve path' — refuseUserRequest scans only text the user changed (the edit differs from the stored draft), so an unchanged model draft is never refused — cost if wrong: an unedited model draft with a signal is sent after the user reads it (the user still approves each send).
Task 3: minor (deferred): 400 before the 404 ownership check in the outreach PATCH; maintenance test global rescan may race the scoped test; cursor paging untested past one page; broad 'and'/'now' prefixes in ASK
Task 3: fix round 1/5 (3 addressed, 0 open; commits 4184b4d..ec7bdc6; 55-probe old-vs-new check passed)
Task 3: minor (deferred): 'name.env' (e.g. 'send prod.env') quiet on the broad set alone (verb+file pattern still catches 'send prod.env'); cursor loop of rescanPendingDrafts
Task 3: complete (commits 3066790..ec7bdc6, review clean)
Task 4: dispatched (base ec7bdc6, sonnet)
Ruling: AskRequest.system becomes a BuiltPrompt (the job check puts the profile in the system prompt for caching); every caller builds its system prompt with prompt — so fenced profile text cannot enter the system prompt raw — cost if wrong: one type change across callers.
Ruling: a met or partial requirement with no evidence slug becomes missing (the server cannot check it) — spec 5.2 wants checkable evidence — cost if wrong: lower scores where Claude forgot to cite.
Ruling: with no saved fields the field enum is FIELD_CHOICES (my dispatch ruling wins over the brief's 'Other only' line) — the user has not chosen yet, and 'Other' alone would hide every field — cost if wrong: none expected.
Task 4: review (opus) — spec ✅ (2 ⚠️ resolved below), quality needs fixes (1 Important: enums and maxItems only in descriptions; one out-of-list value loses the paid reply)
Ruling (⚠️ 1): the profile block stays after the fixed rules in the system prompt (spec 5.6 says first) — the whole system prompt is one cached block, so the order does not change what is cached — cost if wrong: none.
Ruling (⚠️ 2): small profiles may fall below the cache minimum; the Task 14 eval reports cache reads — cost if wrong: a few cents more per refresh for a small profile.
Ruling: the job-check reply is parsed leniently (enums as strings, lists unbounded) and checkReply coerces: an unknown field → 'Other', an unknown level/mode/blocker type/legitimacy flag → the closest default or dropped, lists cut to their limits; the raw reply is cached once it parses as JSON — a paid reply must not be lost on one bad value — cost if wrong: an odd value is shown as Other.
Task 4: Ruling: raise Minors 2 (a blocker quote needs at least 3 words and 12 characters), 5 (re-run the slug check on read against the current claims) and 8 (check quotes against the same sanitised text that the model saw) into the fix round — each changes a user's score wrongly — cost if wrong: small extra change.
Task 4: minor (deferred): mixed-slug missing keeps known slugs in evidence; 2 more queries per analysed job; stored JSON has score/parts; heuristic score/parts not capped like match and parts do not sum after clamp; keyword heuristic makes met with empty evidence
Task 4: fix round 1/5 (4 addressed, 0 open; commits 1278101..2fa5a3f)
Task 4: complete (commits ec7bdc6..2fa5a3f, review clean)
Task 5: dispatched (base 2fa5a3f, sonnet)
Note: one unnamed test failed in one full run during Task 5 (passed in the next run). Run the flake loop when no implementer works.
Task 5: review — spec ✅, quality approved (posting text renders as React text only)
Task 5: minor (deferred): reword 3 labels (seniority claims a fact about the user; location vague; reposted uses 'put up'); inaccurate comment in jobcheck-text.ts; duplicate import in route.ts; raw-slug fallback for evidence
Task 5: complete (commits 2fa5a3f..24dbc70, review clean; browser check owed with the UI checks)
Flake (part 5): tests/etag.test.ts '/api/state sends an ETag and answers 304' — state body changes when other files add jobs in the user's real countries or a minute passes. Fix dispatched (haiku, test only).
Flake fix: complete (329b2a6, test only)
Task 6: dispatched (base 329b2a6, sonnet)
Task 6: review (opus) — spec ❌, needs fixes (1 Critical: lualatex can read/write any file through \directlua — openin_any does not limit Lua io; 2 Important: member CV goes to the admin's Drive with a public link; near-white check misses common forms)
Ruling: lualatex always runs with --safer --nosocket (all sources, also the admin's), and checkOwnTex refuses \directlua, \luaexec, \luadirect, \latelua, \lua_now, \lua_shipout and \usepackage{luacode} — the compile flag is the real guard; the text check is a second layer — cost if wrong: a Lua-based own .tex does not compile.
Ruling: shareResume (Google Drive) runs only for the admin; members get the local PDF link only — Drive per user is a later part, and the admin's Drive must not hold members' CVs — cost if wrong: members get no Drive link.
Ruling: own-tex compiles copy only own.tex into the work folder (not the whole resumes folder) — cost if wrong: none.
Task 6: ⚠️ for Task 7: DELETE sets template, but the admin still gets RESUME_TEX — Task 7 decides the admin's template mode.
Task 6: minor (deferred): \write%newline18, \write018, \@@input, \input{{/abs}}, \def/\let aliases pass the text check (stopped by -no-shell-escape and openin_any=p)
Note for Task 7: an own .tex compiles with only own.tex in the work folder; copy the built-in templates/resume/classic/resume.cls into the work folder too, so an own .tex can use \documentclass{resume}.
Task 6: fix round 1/5 (3 addressed, 1 open + 2 new Critical — lualatex io.lines still reads files under --safer; \verb|%| hides the rest of a line from the checks; \use:c builds \directlua from parts; commits 88fbb01..46b0f90)
Ruling: a source that a user uploads (own .tex) never compiles with lualatex; it compiles only with pdflatex or xelatex (no Lua; file access limited by openin_any=p and no shell escape). If the configured engine is lualatex, an own-tex compile uses pdflatex or xelatex when present, else fails with a clear message. lualatex stays allowed only for the admin's RESUME_TEX file — text checks cannot make Lua safe, so the guard must be the engine choice — cost if wrong: a member whose .tex needs lualatex features cannot compile it.
Ruling: checkOwnTex runs every refusal check on both the raw text and the comment-stripped text, and refuses when either matches — a comment trick then cannot hide a command — cost if wrong: a refused command inside a real comment blocks the upload (the user removes the comment).
Task 6: fix round 2 committed (ed9640c, 852 tests); re-review round 2 dispatched (opus).
Task 6: fix round 2/5 (3 addressed, 0 open; commits 46b0f90..ed9640c; pdflatex attack compiles blocked; xelatex not installed here)
Task 6: minor (deferred): with neither pdflatex nor xelatex, a compile:false call throws → GET /api/resume/[id] gives a generic 500 and outreach fails after the paid Claude call
Task 6: complete (commits 329b2a6..ed9640c, review clean)
Ruling (Task 6 ⚠️): the admin who deletes the own .tex (resumeMode template) gets the built-in template, not RESUME_TEX; RESUME_TEX applies only while the admin has no UserSettings row with resumeMode set — the admin's explicit choice wins — cost if wrong: the admin must upload the .tex again to go back.
Task 7: dispatched (base ed9640c, sonnet)
Task 7: controller full run on 0e91833: 69 files, 881 tests pass.
Task 7: review (opus) — spec ❌, needs fixes (2 Important: 9 Latin code points pass the allow list but break pdflatex; a failed base build shows 'try again' forever and re-queues the same failing build)
Ruling: escapeLatex maps every character outside the compile-tested set to a safe form (NFKD, then a small table such as Ħ→H, ħ→h, ĸ→k, Ŀ→L, ŀ→l, ŉ→n, Ŧ→T, ŧ→t, ſ→s), and drops any character still outside the set; a test compiles every code point of Latin-1 Supplement and Latin Extended-A — cost if wrong: a rare letter shows without its accent.
Ruling: a failed base build is stored as AppState 'base-failed:<userId>' with the profile version and a short reason; the CV view shows that reason; no new base build is queued for the same profile version; a profile save clears it — cost if wrong: after a passing fix on the server, the user saves the profile once to retry.
Task 7: ⚠️ resolved: controller cmp shows templates/resume/classic/resume.cls is byte-identical to the admin's resume.cls.
Task 7: fix round 1/5 (2 addressed, 1 new Important — a transient base-build failure is locked until the next profile save; commits 0e91833..519c338)
Ruling: the base-failed record expires 30 minutes after it was written (field 'at'); after that, the next request may queue one new build — a temporary failure must heal without a profile save — cost if wrong: one retry each 30 minutes for a source that always fails.
Task 7: fix round 2/5 (1 addressed, 0 open; commits 519c338..7ed9038)
Task 7: minor (deferred): admin env rule also for RESUME_PDF-only and an own-tex row with no file; projects ranked by evidence 'since'; expired base-failed records not deleted; 9 more in task-7-review.md
Task 7: complete (commits ed9640c..7ed9038, review clean)
Task 8: dispatched (base 7ed9038, sonnet)
Ruling: the posting does not exempt a name in a suggestion (my dispatch text said both); a capitalised word must be in the source bullet or the claim proofs — the stricter reading matches spec 5.3 — cost if wrong: some valid suggestions are dropped.
Task 8: review (opus) — spec ❌, needs fixes (3 Important: name rule skips sentence starts and acronyms; number words pass and '2 million' passes on any '2'; own-tex accept with no unique match says Accepted but changes nothing). ⚠️ resolved: resume.ts:860 passes the real steer to renderTemplate.
Ruling: every capitalised word or acronym in a suggestion must appear (NFKC, case-insensitive) in the source bullet or the named claims' proofs; the only exception is the first word when it is in a fixed list of about 60 résumé verbs (Built, Led, Designed …) — cost if wrong: some valid suggestions are dropped.
Ruling: number words (zero to ninety, hundred, thousand, million, billion, percent, half, dozen, double/doubled, triple/tripled, -fold/tenfold) must also appear in the source or proofs; a digit token with its unit (e.g. '2 million', '40%') must appear as the same tokens — cost if wrong: some valid suggestions are dropped.
Ruling: in own-tex and RESUME_TEX mode, the app offers no suggestion for a bullet whose match does not find exactly one item, and an accept that cannot be applied returns 409 'Waypoint could not find this line in your résumé source.' — cost if wrong: fewer suggestions for an own .tex.
Task 8: fix round 1/5 (3 addressed, 0 open; commits 760458c..c3f800e; 5 extra probes refused)
Task 8: minor (deferred): '2× throughput' passes (× not a unit); fraction words ('a third') pass; 'Spearheaded' dropped (not in the verb list); a digit passes with another unit in proofs ('2 years' vs '2 TB'); 7 more in task-8-review.md
Task 8: complete (commits 7ed9038..c3f800e, review clean)
Task 9: dispatched (base c3f800e, sonnet)
Task 9: review (opus) — spec ✅, quality approved with 1 Important (the reply payload keeps the full contact message, up to 8000 chars, and task rows are never pruned). Floor, retry and auto-send checks pass. iOS clipboard: the write starts in the click (WebKit async pattern); a real iPhone check is owed.
Ruling: accept the contact message in the reply payload (the user pasted it into their own account, and a row ID would show an empty draft while the task waits) as a recorded exception to 'server-made IDs only'; and the maintenance task deletes done and failed task rows older than 14 days, so no payload text stays — cost if wrong: task history older than 14 days is gone.
Task 9: fix round 1/5 (1 addressed, 0 open; commits 49c1ea1..182f387)
Task 9: minor (deferred): pruneTasks loop could re-select rows if deleteMany removes fewer (stop on count 0); 5 more in task-9-review.md; iPhone clipboard check owed
Task 9: complete (commits c3f800e..182f387, review clean)
Task 10: dispatched (base 182f387, sonnet)
Ruling: colour check fails open (warning) when pdftohtml fails — tiny-text detection and the injection scan still run, and fail closed would block every import without pdftohtml — cost if wrong: white text passes on a host where pdftohtml breaks.
Task 10: review (opus) — spec ✅ (⚠️ the Pi install needs poppler-utils: pdftohtml and pdftoppm are present on this Pi — note for docs/deploy.md), needs fixes (3 Important: a crafted font name moves the first color= and defeats the check; text matching hides every visible copy of a word; a dark band or sidebar with white text is refused)
Ruling: hidden-by-colour means 'the same colour as the background' (spec 6.4), measured: render each page with pdftoppm (fixed template, 36 dpi, PPM) and compare each pdftohtml text box's colour with the median colour of the pixels just around its box; hidden when every channel is within 24. This replaces 'page taken as white' — the reviewer's real PDFs showed dark bands and sidebars lose all their text — cost if wrong: one more process per import (about a second on the Pi).
Ruling: hidden text is matched to pdftotext words by position (word centres inside a hidden pdftohtml box, scaled), not by text — text matching hid every visible copy of a word — cost if wrong: none expected.
Ruling: the colour attribute is read by name from the parsed attribute list of each fontspec (the last color= wins), never by the first regex match — cost if wrong: none.
Task 10: fix round 1/5 (3 addressed, 2 new Important — font names with '/><' or a forged colour still let white text reach Claude; pdftoppm -r 36 has no pixel cap (155 MB PPM from a 900-byte PDF); commits e6f157e..398b047)
Ruling: decide hidden text from pixels only: for each pdftotext word box, the word is hidden when no pixel inside its box differs from the median ring colour by more than 24; pdftohtml and the font-colour parse are removed — the XML colour can be forged, the pixels cannot — cost if wrong: anti-aliased thin text may need the tolerance tuned.
Ruling: pdftoppm uses '-scale-to 1000' (the long side at most 1000 px) and '-l 10'; each PPM file size is checked with statSync before the read (at most 3 MB); a PDF with more than 10 pages gets the colour warning — cost if wrong: thin text on huge pages is checked at low detail.
Task 10: fix round 2/5 (2 addressed, 2 new Important — one hairline rule or a joined glyph in a word box counts as 'visible' and leaks white text; /Rotate 90/270 pages map boxes to the wrong pixels; commits 398b047..2f0313d)
Ruling: a word counts as visible only when at least 8% of the pixels inside its box differ from the ring median by more than 24 AND those pixels span at least 3 rows and 3 columns; else hidden — one rule line or one joined dot cannot make a white word visible — cost if wrong: very thin or very small visible text may be marked hidden (it then shows as a warning, not lost silently).
Ruling: read each page's rotation with pdfinfo (fixed template '-f 1 -l 10 <path>') and map word boxes through the rotation before sampling; a rotation that is not 0/90/180/270 gives the colour warning for that page — cost if wrong: one more process per import.
Ruling: accept the implementer's third ink rule INK_MIN_COLUMNS (ink across at least 40% of the box width) — a white tail fused to a visible word is one pdftotext word, and only a width rule catches it; the visible part of such a joined word is hidden too — cost if wrong: a fused word loses its visible part (shown as a warning).
Task 10: fix round 3/5 (hairline fixed; 2 open + 1 new Important — a white tail under ~60% of a joined word box still leaks; a forged pdfinfo Title fills the rotation map; text over a picture or pattern leaks because picture pixels count as ink; commits 2f0313d..1760e8e)
Ruling: round 4 changes method instead of tuning thresholds: decide per character, by comparing two renders from one tool — the page with text and the page with text removed (Ghostscript -dFILTERTEXT); a character is visible when its box differs between the two renders; character boxes come from Ghostscript txtwrite in the same device space, so no rotation mapping is needed and pdfinfo goes away. A picture or pattern behind text is in both renders, so it no longer counts as ink — whack-a-mole on thresholds did not converge in 3 rounds — cost if wrong: Ghostscript becomes a new exec program (run with -dSAFER and fixed templates) and imports take longer.
Ruling: Ghostscript is acceptable as an exec program for this check: the Pi has the Debian security build 10.0.0~dfsg-11+deb12u8; it always runs with -dSAFER -dNOPAUSE -dBATCH -dQUIET, the prlimit memory cap, the timeout, an empty temp work folder and the env allowlist — cost if wrong: a Ghostscript flaw in a malicious PDF runs inside those limits as the server user (the same class of risk as poppler today).
Task 10: round 4 implementer stopped at the session limit; resumed it (same agent, saved state).
Ruling: accept the round 4 choices — keep the pdftotext text and drop hidden glyphs by position (txtwrite gives bad ligatures for pdflatex fonts); fail closed when the strict parser refuses the txtwrite output (a forged font line must not open a fallback); 8% ink share from measurements — cost if wrong: such a PDF imports no text from pages 1 to 10.
Task 10: fix round 4/5 (3 addressed; 3 new Important — N1 /Rotate as a real number: gs turns the page, pdftotext does not; N2 stroked/sheared/stretched text ink outside the glyph box credits a white glyph; N3 /UserUnit escapes the resolution cap (813 MB PPM) and a small UserUnit forces the fallback; commits 1760e8e..ce8699d)
Ruling: the colour check fails closed — when it cannot run or cannot be trusted (gs fails, times out, a page is not rendered, pages after 10, frames disagree), the app does not send that page's text to Claude and the import says 'Waypoint could not check this PDF for hidden text. Export it again as a normal PDF, or upload the .tex source.' — an attacker could force the fallback on purpose — cost if wrong: some odd but honest PDFs cannot be imported (the user can still type or use YAML/LinkedIn).
Ruling: a frame check: when fewer than 90% of the pdftotext words of a page line up with txtwrite glyphs (position within 2 pt), that page fails closed (covers N1 and any future frame mismatch); gs runs with -dNoUserUnit and prlimit --fsize (20 MB) so it cannot write a huge file (N3).
Ruling: a page where the text ink outside all glyph boxes (expanded by 2 px) is more than 2% of the page's text ink (stroked, sheared or stretched text) fails closed (N2) — cost if wrong: résumés with outlined or stretched headings cannot be imported as PDF.
Task 10: round 5 resumes the round-4 Opus implementer (deep context) instead of a fresh one — the skill says fresh for rounds 4–5; this agent is already on the most capable model — cost if wrong: none expected.
Task 10: fix round 5/5 (N2, N3, fail-closed addressed; N1 NOT addressed — Critical: on a page that passes the 90% frame gate, words that do not line up still reach Claude, and lineUp accepts glyphs that do not show; a square /Rotate 90.0 probe leaked white text; commits ce8699d..c7ce585)
Task 10: breaker tripped. Ruling (load-bearing, Critical): smallest change — every pdftotext word that does not line up with SHOWN txtwrite glyphs is treated as hidden (out of the Claude text, into the warning), and lineUp counts only glyphs that the colour check marks visible; dispatched as one follow-up fix with its own Opus re-review, outside the 5-round loop — a security leak cannot be parked — cost if wrong: a few honest words that the two tools place differently are left out of the import, with a warning.
Ruling: the 90% page gate keeps using all glyphs (it checks only that the two tools agree on the frame); visibility is enforced per word with visible glyphs only — a visible-only gate turned 67 of 125 probes into whole-page failures with no safety gain — cost if wrong: none expected.
Task 10: follow-up 1 re-review — N1 NOT addressed (Critical: tiny visible filler glyphs with the same letters at each secret word's centre make the hidden word line up on a /Rotate 90.0 page; Important: a garbled full-size decoy lines up through the 1-in-3 letter slack; commits c7ce585..ab59b97)
Ruling (follow-up 2): a visible glyph counts toward a word only when its height is between 0.6x and 1.6x of the word box height and its centre is inside the word box (also for part matches); the letter slack applies only to glyphs whose text is a ligature or unmapped (U+FB00–U+FB06, U+FFFD, private use), never to a normal letter — the leaks used size and letter slack — cost if wrong: some honest words with odd font metrics are left out with a warning.
Ruling: accept the 2 extra rules of follow-up 2 — (a) the txtwrite pdflatex ligature group (U+6600 + zero-advance U+6900/U+CF00/U+6C00) counts as one ligature token for ff/fi/fl/ffi/ffl only; (b) a dash in a word may take one 1-character glyph (txtwrite writes an en dash as '3') — both are needed for real pdflatex résumés, and letters and digits must still match exactly; also tiny words do not count for the 90% gate — cost if wrong: an attacker could use a ligature group or a dash slot for at most those exact letters.
Task 10: follow-up 2 re-review — N1-a and N1-b ADDRESSED (149 probes same; ligature, dash and unknown-glyph abuse on a rotated page all fail closed).
Task 10: new Critical (older than the fix): readLines skips the colour check for a word with no letter or digit, so white circled/squared Latin letters (category So) reach Claude on a normal page.
Ruling (follow-up 3): every non-whitespace word gets the colour check, whatever its characters; and the 2 Minor gaps are closed at the same time — the ligature token must start with U+6600 and stand for at most 3 letters, and a run of unknown glyphs (PUA, U+FFFD) may stand for at most 2 letters per word — cost if wrong: words made only of symbols may be hidden with a warning.
Ruling: accept a 2% ink share for a glyph with no letter or digit after NFKC (8% for letters) — a thin em dash was lost at 8%; white symbols still make no ink difference — cost if wrong: a faint symbol counts as visible.
Task 10: follow-up 3 re-review — 3 findings ADDRESSED; new: N1 Critical (white astral symbol letters next to visible x reach Claude through the U+6600 token, the split neighbour rule and the non-letter slack), N2 Important (a zero-width dot or a hairline with braille ToUnicode passes at 2%), O1 Critical older (a zero-width black 'm' inside each white glyph box makes white ASCII visible).
Ruling (follow-up 4, class-level, then stop): (1) a character allowlist for PDF text sent to Claude — Basic Latin, Latin-1 Supplement, Latin Extended-A/B, General Punctuation, Currency Symbols, Letterlike Symbols, Arrows, common bullets and dashes; any word with a character outside it (astral planes, braille, tags, PUA, combining marks after NFC, enclosed or squared forms) is hidden with the warning, whatever its ink; (2) a glyph whose advance width is under 20% of its font size, or whose ink box is under 20% of its expected box, never counts as visible; (3) after this follow-up, any remaining exotic PDF trick is parked with a ruling for the final review — per-glyph hardening has run 3 follow-ups, and the other layers (fences, quote rule, scans, user approval) still stand — cost if wrong: résumés with non-Latin scripts (for example Devanagari names) lose those words with a warning.
Ruling: accept the 3 extras of follow-up 4 for the pdflatex résumé (dotless i + combining mark → i before NFC; U+6600 as a ligature follower for 'ff'; no ink-box rule for glyphs with no letter or digit, which still need 2% ink and a normal advance) and keep the dash slack — needed for real résumés; the allowlist closes the N1 path — cost if wrong: small, bounded slack.
Task 10: parked — f-bar-BA130 (visible black bars whose ToUnicode maps to letters send a few letters) — Ruling: this is the 'lying ToUnicode' class: the text is visible ink but its mapping differs; no colour check can find it (it needs OCR); the fences, the quote rule, the injection scan and the user's approval of each draft stay the guard — cost if wrong: an uploader can put a few letters of chosen text into the import under visible marks.
Task 10: follow-up 4 re-review — N1, N2 ADDRESSED; O1 ADDRESSED for the probe; no regression that sends a secret (243 PDFs base vs head).
Task 10: parked — Type3 'far ink' (a zero-advance glyph that paints beyond ±1 font size) and a forged ligature part (2-character ToUnicode) can still make a few white letters count as visible (rr10 forge probes; base leaks too) — Ruling: these draw visible black strokes, close to the parked lying-ToUnicode class; per ruling (3) they are parked for the final review; the fences, the quote rule, the injection scan and the user's approval stay the guard — cost if wrong: a crafted PDF can put a short chosen word into an import draft.
Task 10: minor (deferred): Letterlike So symbols (℡ ™ № ℅ ₨) pass the allowlist and open to fixed abbreviations under NFKC; the 1-em shared square removes visible text next to a real zero-advance glyph (fails closed); joined-tz10 keeps 'Engine' for 'Engineer'
Task 10: complete (commits 182f387..b087971, 5 rounds + 4 follow-ups, 3 items parked with rulings)

# Part 6: steps for the local session on the Pi

The cloud session finished part 6 (UI/UX and devices) on `claude/epic-lovelace-0vqgu7`. It cannot push to `multi-user`. Do these steps in the worktree (branch `multi-user`). Never touch the live app (port 3118), its `.env` or its `data/`.

## 1. Get the work

```
git fetch origin
git merge --ff-only origin/claude/epic-lovelace-0vqgu7
npm ci            # postinstall copies the pdf.js worker to public/pdfjs
npx prisma generate
```

## 2. Unit tests and the build

- `npm test` — expected: all pass (the cloud: 1690 pass, 1 skip).
- `npm run typecheck`, `npm run lint` — clean.
- With no dev server running: `next build` with a scratch DATABASE_URL. The fonts are local files now, so the build needs no network. Delete `.next` after.

## 3. Device tests with WebKit

Follow `docs/devices.md`:
- `npx playwright install webkit` and `npx playwright install-deps webkit` (one time).
- `npm run test:e2e` (no env: the iPhone and iPad projects use WebKit). The harness runs the app from a scratch copy with no `.env`, on 127.0.0.1 only, with random passwords. Expected: all pass. Send the summary and the failures.

## 4. Manual device checklist

On a real iPhone and a real iPad (a temporary HTTPS link, as for the part 5 iPhone check), go through the checklist in `docs/devices.md`: the keyboard over forms, the Files picker for .pdf, .tex, .zip and .yml, add to the home screen (the icon, no browser bars), rotation keeps the open job, the PDF preview, the tab bar above the home indicator. Also look at the screens as a user: is anything ugly, busy or hard to read on the device? Write it down.

## 5. Write the results

Write `docs/superpowers/handoff/pi-steps-<date>.md` with the results, commit, and push `multi-user`. Give the owner a short message to paste back to the cloud session.

## Before the deploy (the owner)

- Migration `7_onboarding`: existing users are marked as set up; the admin keeps RESUME_TEX. Back up the database first (docs/deploy.md).
- Save your job-search fields in Settings → Job search (the fixed "Backend 0.6" field fit is gone since part 5).
- The model is `claude-sonnet-5-5` since part 5.

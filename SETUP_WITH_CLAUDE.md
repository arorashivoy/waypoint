# Waypoint setup — instructions for Claude

**Who this is for.** A person gives this file to Claude Code inside a fresh clone of
Waypoint and asks to be set up. Everything below is setup that git does not carry:
secrets in `.env`, a Google Cloud project, a published OAuth consent screen, a
`claims.yml` describing *this* person, and the database. Work through the sections in
order. Before you start, read `README.md`.

## Rules for you, Claude

- **The user is not the original author.** Never reuse names, schools, emails, Drive
  ids, tokens or URLs from the repo history, the README examples or this file. All of
  them come from the user.
- **Never echo a secret back** (tokens, client secrets, passwords). Write it into `.env`
  and confirm that it is set.
- Steps marked **[USER]** need the user's browser or their accounts. Explain exactly what to
  click, and wait for them. Never claim one of these steps is done without checking it
  (each step says how to check).
- Ask before anything public: pushing to their GitHub, publishing pages.
- Run `npx prisma generate` and `npx prisma migrate deploy` **only from this checkout's root**,
  never from a git worktree that shares this `node_modules`. The generated client stores
  the absolute path of the schema it was generated from. Generating from a worktree points
  the app at that worktree's database, and the app then fails with
  `Error code 14: Unable to open the database file`.
- After pulling new code, run `npx prisma migrate deploy` (to apply new migrations; on an old install, do step 3 of section 0 first), then restart
  the server, and tell the user to hard-reload the tab (Cmd/Ctrl+Shift+R). An open tab
  keeps running old client code. Buttons that call removed routes then return 404.

---

## 0. Already installed? Upgrade instead

If `data/waypoint.db` and `.env` already exist, this is an existing install. Do **not**
run `npm run setup` or re-create `.env`. Instead:

1. **Back up** before touching anything. Stop the server first (`./scripts/remote.sh stop`).
   Then copy `data/waypoint.db` and, if they exist, `data/waypoint.db-wal` and
   `data/waypoint.db-shm` together. Also copy `.env` and `data/profile/claims.yml`.
2. `git pull`, then `npm install`.
3. Do this step one time only, and only if the database was made before the `0_init`
   migration existed. Run `npx prisma migrate status`. If it says the database is not
   managed by Prisma Migrate, do these sub-steps. The old `db push` did not make a
   `_prisma_migrations` table, so without them `migrate deploy` fails with error P3005.
   Do not run them on a new database.
   1. From the checkout root, run
      `npx prisma migrate diff --from-url "file:$PWD/data/waypoint.db" --to-schema-datamodel prisma/schema.prisma --exit-code`.
   2. If the exit code is 2, the database differs from the schema. Stop. Check that the
      backup from step 1 exists. Run `npx prisma db push` one time (the old tool, only
      for this catch-up). Run the diff again. Repeat until the exit code is 0.
   3. If the exit code is 0, run `npx prisma migrate resolve --applied 0_init`. If you
      skip the check, this command hides a missing column and no error shows.
4. Run `npx prisma migrate deploy`. It applies the migrations that come after `0_init`,
   if there are any. Then run `npx prisma generate`, from this checkout's root.
5. **Move claims.yml into the database.** Part 3 keeps each profile in the database. Run this one
   time for the admin, with the server stopped:
   `npm run migrate:claims -- --user <admin email> --file data/profile/claims.yml`.
   If the script prints errors, nothing changed: fix the file with `npm run check:claims` and run it
   again. After this, edit the profile on the Profile screen, or import a claims.yml in
   Settings → Data. Section 9 (keep claims.yml in sync) does not apply to the `prod` branch.
6. Bring the setup that lives outside git up to date. **Check each item; don't assume
   it's done.**
   - **Drive token:** run the token check in section 5, step 8. If it returns
     `invalid_grant`, the Google app is probably still in Testing. Do section 5, steps 2–4
     (pages, Branding, Publish), then step 6 (`gdrive:auth`) to get a new token.
   - **Drive folder:** if the folder check in step 8 returns 404, `GDRIVE_FOLDER_ID` is a
     folder made by hand. Do section 5, step 7.
   - **`claims.yml`:** make sure the first education has `aliases:` and that the first
     alias is the short name people use. The alumni search uses it (section 4).
   - **Obsolete settings:** remove `WAYPOINT_SCHOOL_LINKEDIN_SLUG` from `.env` and any
     `linkedin:` key under an education in `claims.yml`. Neither is used any more.
   - **Check:** `npm run check:claims` exits 0.
7. Check `.env` for `WAYPOINT_SECRET_KEY`. If the line is missing, run `npm run secret:new`.
   Append the line that it prints to `.env`. Do not overwrite the file.
   Optional: append `WAYPOINT_SHARED_MONTHLY_USD=5` (the default is 5).
8. Add the public URL to `.env` (append one line; do not overwrite the file):
   `WAYPOINT_PUBLIC_URL=https://<name>.shares.zrok.io`
9. Set the admin password: `npm run user:create-admin`. The migration made your
   existing account the admin. The script asks for the email, the name and the password.
10. Remove `WAYPOINT_ACCESS_CODE`, `WAYPOINT_ZROK_AUTH_FILE` and the `LINKEDIN_*` lines
   from `.env`. They do nothing now.
11. Restart with `./scripts/start.sh restart`. The zrok share now has no basic auth.
    Sign in with the admin email and password.
    Tell the user to hard-reload every open tab.
12. Run the checklist in section 7.

For the first deploy of the `multi-user` branch on an always-on host (units, worker, backups), follow `docs/deploy.md`.

## 1. Machine prerequisites

| Need | Check | Install |
|---|---|---|
| Node 18+ | `node -v` | nodejs.org or NodeSource (on a Raspberry Pi use **64-bit** Pi OS) |
| Claude Code CLI | `claude --version` | https://claude.com/claude-code |
| `pdflatex` for the template CV (`tectonic` alone is not enough) | `which pdflatex` | Linux: `sudo apt install texlive-latex-base texlive-latex-recommended lmodern`. macOS: `brew install --cask mactex-no-gui` |
| `pdftotext` and `gs` for PDF import | `which pdftotext gs` | Linux: `sudo apt install poppler-utils ghostscript`. macOS: `brew install poppler ghostscript`. After a Ghostscript upgrade, run `npx vitest run tests/profile-extract.test.ts` and check that it passes before the next deploy. |
| cloudflared (only for remote access) | `which cloudflared` | `brew install cloudflared` / the Linux package |

**Claude auth.** Either the user runs `claude login` on this machine, or **[USER]** they run
`claude setup-token` anywhere they are signed in, and you put the result in `.env` as
`CLAUDE_CODE_OAUTH_TOKEN`. The token is required on a headless machine. It is also
required when two people share one machine (section 8): without a token each, both copies
bill the same Claude subscription.

## 2. Install and database

```bash
npm install && npm run setup     # prisma generate + migrate deploy + seed the account and country list
cp .env.example .env
```

## 3. `.env`

Fill these in from `.env.example`. Ask the user for each value; do not invent any.

| Variable | Value |
|---|---|
| `DATABASE_URL` | keep `file:../data/waypoint.db` (the path is relative to `prisma/`) |
| `WAYPOINT_NAME` | the user's name. The Drive file names use it |
| `WAYPOINT_SECRET_KEY` | required. Make one with `npm run secret:new` |
| `WAYPOINT_PUBLIC_URL` | only for remote access. The public URL of this copy. Invite links use it |
| `WAYPOINT_SHARED_MONTHLY_USD` | optional. The monthly limit for each user on the shared `ANTHROPIC_API_KEY`. The default is 5 |
| `CLAUDE_CODE_OAUTH_TOKEN` | see section 1 |
| `RESUME_TEX`, `RESUME_PDF` | absolute paths to the user's LaTeX CV and its compiled PDF. Tailoring needs the `.tex`; keep any custom `.cls` next to it |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | optional. Free at developer.adzuna.com. Without them the Adzuna source returns nothing, silently |
| `GDRIVE_*` | section 5 |
| `PORT` | only for a second copy on the same machine (section 8), e.g. `PORT=3118`. Read by `npm run dev`, `npm start` and `remote.sh`; a `PORT` in the shell or systemd unit wins over `.env`. |

Check: `grep -c '^[A-Z]' .env` goes up, and `npm run dev` starts without errors.

## 4. `data/profile/claims.yml` — the user's profile

This file is gitignored, so a fresh clone has none. Without it, Waypoint falls back to
the LinkedIn import, which works but scores worse. With it, scoring, CV tailoring and
outreach all draw on it.
- Build it with the user from their real CV and LinkedIn.
- The format is described in the README section on `claims.yml`. The exact fields and
  rules are the types and validation in `src/lib/claims.ts`.
- `npm run check:claims` is the gate. Iterate until it passes.
- A `proof:` line is quoted verbatim in outreach, so it must be something the user would
  defend in an interview. Never pad it.

**Alumni referrals** (used when nobody among the user's connections works at a company)
need the school written like this:

```yaml
profile:
  educations:
    - id: <short-id>
      school: <full registered name>
      degree: <degree>
      field: <field>
      years: <years>
      # The forms alumni actually write in their headlines. The first one is used
      # as the short name in the 300-character connection note and, with `school`,
      # in LinkedIn's School search field, so keep it the common short form.
      aliases: [<short name>, <other spellings>]
```

Check: `npm run check:claims` exits 0. And this prints the school's name and short form:

```bash
cat > .probe.ts <<'EOF'
import { db } from './src/lib/db';
import { profileSummary } from './src/lib/user';
(async () => { const u = await db.user.findFirstOrThrow(); console.log((await profileSummary(u.id) as any).school); })();
EOF
npx tsx --env-file=.env .probe.ts; rm .probe.ts
```

On the `prod` branch the profile of each user is in the database. `claims.yml` is the import and
export form: Settings → Data downloads it and imports it again, and `npm run migrate:claims` moves
an existing file into the database. `npm run check:claims` still checks a file before you import it.

## 5. Google Drive (CV links in referral messages)

This is optional, but without it messages fall back to "happy to send my CV". Every step
here except the last needs the user. Waypoint authenticates **as the user** through
OAuth. A service account will not work, because it has no storage in a personal Drive.

1. **[USER]** At console.cloud.google.com, create a project. Then go to **APIs & Services →
   Library** and enable **Google Drive API**.
2. **Homepage and privacy policy pages.** Google will not let an External app go to
   production without them, even though a personal app with fewer than 100 users and only
   the non-sensitive `drive.file` scope needs no verification.
   - Write two static pages: `waypoint/index.html` (what the app is, that it uses only
     `drive.file`, that it is single-user) and `waypoint/privacy.html`.
   - The privacy policy must state:
     - the one scope;
     - that Waypoint only uploads, replaces and shares files it created itself;
     - that uploaded CVs are shared as "anyone with the link";
     - that credentials and file IDs are stored only on the user's machine;
     - that Google data is never sold, never used for advertising, and never shared;
     - that no Google data is sent to Anthropic (posting text and the user's own profile are);
     - compliance with the Google API Services User Data Policy, including Limited Use;
     - how to revoke access (myaccount.google.com/permissions);
     - a contact for the owner (prefer a GitHub profile link to a raw email).
   - Host them on the user's GitHub Pages. If they have a public `<username>.github.io`
     repo, add a `waypoint/` folder to it. A private repo cannot serve Pages on the free plan.
   - **Ask before you push.** Then check that both URLs return 200.
3. **[USER]** Under **Google Auth Platform → Branding**, fill in:
   - App name: `Waypoint`
   - support email and developer contact: the user's own
   - home page and privacy policy: the two URLs from step 2
   - **Authorised domains:** `<username>.github.io`
   - **Leave the logo empty.** A logo puts the app into brand verification for no benefit.
4. **[USER]** Under **Audience**, set User type to External and click **Publish app**, so the
   status reads **In production**. In Testing, Google expires refresh tokens after **7
   days**, and uploads then start failing with `invalid_grant`. A token issued while the app
   was in Testing keeps that limit, so publish first and authorise second.
5. **[USER]** Under **Credentials → Create credentials → OAuth client ID**, choose **Desktop app**.
   Put the ID and secret in `.env` as `GDRIVE_CLIENT_ID` and `GDRIVE_CLIENT_SECRET`.
6. **[USER]** Run `! npm run gdrive:auth` (it listens on localhost:3119 and opens the
   browser). "Google hasn't verified this app" is expected: click Advanced → Continue.
   Write the printed `GDRIVE_REFRESH_TOKEN` into `.env`. On a headless machine, run this
   step on a laptop that has the same `.env` values, and copy the token across.
7. **Folder: you do this, by API.** `drive.file` can only see files and folders the app
   created itself. A folder the user makes by hand in Drive returns **404** to Waypoint,
   and every upload into it fails. So create the folder with the app's own token, and use
   that folder's ID:

   ```bash
   set -a; . ./.env; set +a
   T=$(curl -s https://oauth2.googleapis.com/token -d client_id="$GDRIVE_CLIENT_ID" \
        -d client_secret="$GDRIVE_CLIENT_SECRET" -d refresh_token="$GDRIVE_REFRESH_TOKEN" \
        -d grant_type=refresh_token | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
   curl -s -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' \
        -d '{"name":"Waypoint CVs","mimeType":"application/vnd.google-apps.folder"}' \
        'https://www.googleapis.com/drive/v3/files?fields=id,webViewLink'
   ```

   Write the returned `id` into `.env` as `GDRIVE_FOLDER_ID`. The user can rename or move
   the folder later; the ID stays the same.
8. Check:
   - The token request above returns an `access_token`.
   - `curl -H "Authorization: Bearer $T" "https://www.googleapis.com/drive/v3/files/$GDRIVE_FOLDER_ID?fields=id,name"` returns the folder, not a 404.
   - **[USER]** Clicking **Generate résumé** on a job shows a Drive link.

Upload failures reach the UI as a reason string, not the server log. If a link is
missing, run the token check from step 8 first.

## 6. LinkedIn data **[USER]**

In LinkedIn, the user opens **Settings → Data privacy → Get a copy of your data**, chooses
the full archive, and uploads the zip on the Profile or Resume screen. `Connections.csv`
inside it is the only source of 1st-degree contacts. Without it, every job uses the alumni
fallback.

Waypoint never sends anything on LinkedIn and never scrapes it. Every message is copied
to the clipboard, and the user sends it themselves. Do not add automation; it breaks
LinkedIn's User Agreement and puts the user's account at risk.

## 7. Run and verify

```bash
npm run dev                      # development, http://localhost:3117
npm run worker                   # the task worker. Run it next to npm run dev, in a second terminal
npm run build && npm start       # production. Stop the dev server first: build overwrites .next
./scripts/remote.sh              # dev server, worker and a public tunnel. Accounts protect the app
./scripts/start.sh               # same, but builds and runs the production server
```

Dev mode needs the worker. Without it, every task (refresh, CV build, import, analysis) stays
in the queue, and the screen waits. `remote.sh` and `start.sh` start the worker for you.

Checklist with the user:
1. Sign in works.
2. **Refresh feeds** adds jobs. The refresh logs `[refresh] <source> failed: …` for any
   dead job board; fix or remove those entries in `config/watchlist.json`.
3. On a job's detail screen:
   - **Generate résumé** builds a CV and shows a Drive link (section 5).
   - It shows **Find contact** if a connection works there, otherwise **Find <school> alumni at <company>**.
4. One click copies the message and opens LinkedIn. If the browser blocks the tab, a link
   appears instead.

## 8. Two users on one machine (for example a Raspberry Pi 4)

Give each person their own clone. Then everything gitignored is separate automatically:
`.env`, `data/waypoint.db`, `data/profile/claims.yml` and `data/resumes/`.

```bash
git clone <repo> ~/waypoint-alice && git clone <repo> ~/waypoint-bob
# in each clone: npm install && npm run setup && sections 3–6 with THAT person
```

Per person:
- **`PORT`:** for example 3117 and 3118. The session cookie name includes the port, so two
  copies opened in one browser do not sign each other out.
- **`CLAUDE_CODE_OAUTH_TOKEN`:** their own. Otherwise both copies share whoever ran `claude login`.
- **Google Drive:** both can use the **same Google Cloud project and OAuth client**; the
  personal-use exemption allows fewer than 100 users. Each person runs `gdrive:auth` with
  *their* Google account (one at a time, because it uses port 3119), gets their own refresh
  token, and gets their own app-created folder.
- **`WAYPOINT_PUBLIC_URL`:** a different URL for each. Each copy has its own admin and its own database.

Run each copy in production mode under systemd. Do not use `npm run dev` on a Pi: it
compiles pages on demand and uses about 1 GB more memory.

```ini
# /etc/systemd/system/waypoint-alice.service   (copy for bob; each port comes from its clone's .env)
[Unit]
Description=Waypoint (alice)
After=network-online.target

[Service]
User=pi
WorkingDirectory=/home/pi/waypoint-alice
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
(cd ~/waypoint-alice && npm run build) && sudo systemctl enable --now waypoint-alice
```

- **Memory:** each copy uses about 200 MB idle. Each Claude call it runs uses about 300 MB,
  with up to 2 at a time per copy. Two copies fit in 4 GB with room to spare. Add 1–2 GB of
  swap so a `next build` cannot run out of memory.
- **Remote access:** quick `cloudflared` tunnels change their URL on every run. For a
  machine that is always on, prefer Tailscale (a stable private address) or a named
  Cloudflare tunnel.

## 9. Keep `claims.yml` in sync with an always-on machine

If the user also runs a copy of Waypoint on another machine (for example the Raspberry Pi in
section 8), that copy reads its own `claims.yml`. So every edit made on the laptop has to be
copied across, or the always-on copy keeps scoring and drafting from old facts. Set up the
rule once, so every future Claude session does the copy without being asked.

**Values.** Ask the user for:
- the SSH login (`<user>@<host>`);
- their working directory on that machine.

This guide is an exception to the "never reuse values from this file" rule only for this
one known case:

| Person | SSH login | Working directory |
|---|---|---|
| Ritisha (on the shared Pi) | ask her which account on `raspberrypi.local` she was given | `~/waypoint-ritisha` |

Anyone else: ask; do not guess.

1. **[USER]** Key-based SSH must work without a password prompt. Check:
   `ssh -o BatchMode=yes -o ConnectTimeout=8 <user>@<host> true`. If that fails, the user
   runs `ssh-copy-id <user>@<host>` once (it asks for the password one last time).
2. **Confirm the directory exists. Don't create it:**
   `ssh <user>@<host> 'cd <dir> && pwd && ls data/profile/claims.yml'`.
   If it's missing, the remote copy has not been set up yet. Do section 8 first.
3. **Compare the two files** before anything is overwritten:
   `shasum -a 256 data/profile/claims.yml` locally and
   `ssh <user>@<host> 'sha256sum <dir>/data/profile/claims.yml'`.
   If they differ, show the user the diff and ask which one wins.
4. **Write the rule** into `CLAUDE.local.md` at the repo root.
   - Claude Code loads it in every session in this folder.
   - It is gitignored, so it stays on this machine. **Not** `CLAUDE.md`: that one is
     committed, and would make everyone else's Claude sync to this user's machine.
   - The rule says: whenever `data/profile/claims.yml` changes and `npm run check:claims`
     passes (never a failing file), in the same turn:

   ```bash
   ssh -o ConnectTimeout=8 <user>@<host> 'cp <dir>/data/profile/claims.yml <dir>/data/profile/claims.yml.bak'
   rsync -t data/profile/claims.yml <user>@<host>:<dir-without-~/>/data/profile/claims.yml
   shasum -a 256 data/profile/claims.yml | cut -c1-16
   ssh <user>@<host> 'sha256sum <dir>/data/profile/claims.yml | cut -c1-16'   # must match
   ```

   It also says:
   - The sync goes one way only, laptop → remote.
   - If the remote can't be reached, say so and don't retry in a loop.
   - If the remote copy differs before syncing and isn't just the previous version, stop
     and show the diff.
   - The remote app re-reads the file when it changes, so no restart is needed.
5. **Check:** `rsync -tn --itemize-changes data/profile/claims.yml <user>@<host>:<dir-without-~/>/data/profile/claims.yml`
   succeeds. This is a dry run and writes nothing.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Drive: `invalid_grant` / "Token has been expired or revoked" | app was in Testing (7-day tokens), or access was revoked | section 5 steps 4 and 6 |
| Drive: `File not found: <folder id>` | a hand-made folder that `drive.file` cannot see | section 5 step 7 |
| `Error code 14: Unable to open the database file` | Prisma client generated from another checkout or worktree | `npx prisma generate` from this checkout, then restart |
| Old buttons, or 404s on routes that no longer exist | the browser tab is running old client code | restart the server, then hard-reload the tab |
| "Objects are not valid as a React child" on a job | the model returned list items as objects | already handled in `analysis.ts`. If it reappears, check the new field's normalisation |
| Every job says "No contact to ask" | no LinkedIn export imported | section 6 |

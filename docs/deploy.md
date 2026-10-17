# Deploy Waypoint on the Raspberry Pi

This guide is for the first deploy of the `multi-user` branch on the Pi. After the first deploy,
use `scripts/deploy.sh` for each update (step 10).

## Cautions

- **Install the units for one copy of Waypoint only.** This Pi runs 2 copies of Waypoint. The unit
  names (`waypoint-web`, `waypoint-worker`, `waypoint-tunnel`, `waypoint-backup`) are fixed. A
  second install replaces the units of the first copy.
- **Never overwrite a `.env`.** Each copy has its own values, for example its own `PORT`. Add each
  new key as one line.
- **Stop the old app before you copy the database.** A running app writes to the `-wal` file.

## What you need

- Node 22 and `npm` on the Pi.
- The `multi-user` branch checked out. In this guide, `<checkout>` is the absolute path of the folder.
- A `.env` file in `<checkout>`. If the file does not exist, copy `.env.example` once and fill it in.
- The Pi must stay signed in after you log out. Step 7 does this.

## Steps

1. Stop the old app and back up the database.

   ```bash
   ./scripts/start.sh stop
   cp data/waypoint.db data/waypoint.db.before-multi-user
   cp data/waypoint.db-wal data/waypoint.db-wal.before-multi-user   # only if the file exists
   cp data/waypoint.db-shm data/waypoint.db-shm.before-multi-user   # only if the file exists
   ```

2. Add the new lines to `.env`, one at a time. Do not replace the file.

   | Key | Need | Meaning |
   |---|---|---|
   | `WAYPOINT_SECRET_KEY` | required | Run `npm run secret:new` and add the line it prints. If you lose the key, users must save their secrets again. |
   | `WAYPOINT_PUBLIC_URL` | recommended | The public URL of this copy. Invite and reset links use it. |
   | `WAYPOINT_SHARED_MONTHLY_USD` | optional | The monthly limit for each user on the shared key. The default is 5. |
   | `WAYPOINT_ZROK_NAME` | optional | The name of the zrok share. The default is `waypoint`. |
   | `WAYPOINT_ZROK_NAMESPACE` | optional | The namespace of the share. The default is `public`. |
   | `WAYPOINT_BACKUP_REMOTE` | optional | An rclone remote for the backups, for example `gdrive:waypoint-backups`. |
   | `WAYPOINT_USERS_DIR` | optional | The folder for the files of the users. See step 8. |
   | `LOG_LEVEL` | optional | `fatal`, `error`, `warn`, `info` or `debug`. The default is `info`. |

   Do not change `DATABASE_URL` or `PORT` if they already work. systemd reads `.env` as plain
   `KEY=VALUE` lines. It does not expand `~` or `$`, and it does not allow a comment after a value.

3. Install the packages, apply the migrations and make the admin account.

   ```bash
   npm ci
   npx prisma migrate deploy
   npm run user:create-admin
   ```

   If the admin account exists already, skip the last command. The command asks for the email,
   the name and the password.

4. Move the profile of the admin into the database. Use the email of the admin.

   ```bash
   npm run migrate:claims -- --user <admin email>
   ```

   The command reads `data/profile/claims.yml`. It refuses a file that fails the strict check, and
   then nothing changes. After this step, the Mac to Pi sync of `claims.yml` does not change what the
   app uses, because the profile is in the database now. Edit the profile in the Profile screen.

5. Tell the members what changed.

   - Their old LinkedIn data is in the Imports tab as drafts.
   - Their profile is empty until they accept the drafts.
   - Their old project tags are gone.

6. Build the app.

   ```bash
   npm run build
   ```

7. Install the units, then enable them.

   ```bash
   ./scripts/install-units.sh <checkout>
   ```

   The script needs an absolute path. It refuses a missing `<checkout>/.env`. It fills in `@CHECKOUT@`
   and `@NODE_BIN@` in the unit files and copies them to `~/.config/systemd/user`. It does not enable
   or start a unit. It prints the next 2 commands, and you run them yourself:

   ```bash
   systemctl --user enable --now waypoint-web waypoint-worker waypoint-tunnel waypoint-backup.timer
   loginctl enable-linger $USER
   ```

   The `enable-linger` command keeps the units running when you log out.

8. Check that the worker and the web unit use the same folder.

   Both units use the same `WorkingDirectory`, `<checkout>`. They find the files of the users in
   `data/users` there. If the worker must run from another folder, set `WAYPOINT_USERS_DIR` in `.env`
   to the same absolute path for both units.

9. Check the health of the app.

   ```bash
   curl -s localhost:$(node scripts/port.mjs)/api/health
   ```

   All 4 checks must be `ok`. If a check is not `ok`, read the log with
   `journalctl --user -u waypoint-web -u waypoint-worker -n 100`.

10. Update later with `scripts/deploy.sh`.

    ```bash
    ./scripts/deploy.sh
    ```

    The script stops if the installed `waypoint-web` unit points to another checkout. Then it:

    1. pulls the branch with `git pull --ff-only`,
    2. makes a backup,
    3. stops the worker and the web server,
    4. runs `npm ci`, the migration and the build,
    5. starts the units again.

    The app is down for a few minutes. If a step fails, the units stay stopped, and the script prints
    how to recover. Check out the last good commit, run `npm ci` and `npm run build`, and start the
    units. Or restore the backup (step 11).

11. Restore a backup if you must.

    Stop the units first:

    ```bash
    systemctl --user stop waypoint-worker waypoint-web waypoint-tunnel
    ```

    Restore. Give the database file, and the archive of the users if you want it:

    ```bash
    npm run restore -- <database file> [users archive]
    ```

    The command refuses to run while a unit runs. It keeps the old database and the old user folder
    in `data/backups` as `pre-restore-*` copies. Nothing removes these copies. Remove them by hand
    when you do not need them.

    Start the units, then check the health of the app (step 9):

    ```bash
    systemctl --user start waypoint-web waypoint-worker waypoint-tunnel
    ```

## Backups

The timer `waypoint-backup.timer` runs each night at 03:00. It keeps 14 daily copies and 8 weekly
copies in `data/backups`. Each backup has a database file (`<date>.db`) and an archive of the user
folders (`<date>-users.tar.gz`). To see the timer, run `systemctl --user list-timers waypoint-backup.timer`.

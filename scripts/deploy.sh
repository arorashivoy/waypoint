#!/usr/bin/env bash
# Updates this copy of Waypoint and restarts the services.
# A failed step stops the script (see the trap). A failure in the backup or the pull leaves the
# services running and changes nothing. A later failure leaves the services stopped.
# The backup runs first, with the code that wrote the data, so a bad migration can be undone.
set -euo pipefail
cd "$(dirname "$0")/.."

# Read the database from the .env of this checkout, not from the shell.
unset DATABASE_URL

CHECKOUT="$(realpath .)"
UNIT_DIR="$(systemctl --user show -p WorkingDirectory --value waypoint-web 2>/dev/null || true)"
if [ -z "$UNIT_DIR" ]; then
  echo "The unit waypoint-web is not installed. Run scripts/install-units.sh first." >&2; exit 1
fi
if [ "$(realpath "$UNIT_DIR")" != "$CHECKOUT" ]; then
  echo "The unit waypoint-web belongs to $UNIT_DIR, not to $CHECKOUT. Stop." >&2; exit 1
fi

trap 'echo "Deploy failed. If the units are stopped, check out the last good commit, run npm ci and npm run build, then start the units. Or run npm run restore." >&2' ERR

npm run backup
git pull --ff-only
systemctl --user stop waypoint-worker waypoint-web
npm ci
echo "Database: $(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2-)"
npx prisma migrate deploy
npm run build
systemctl --user start waypoint-web waypoint-worker
systemctl --user restart waypoint-tunnel

#!/usr/bin/env bash
# Updates this copy of Waypoint and restarts the services.
# A failed step stops the script before the restart.
# The backup runs before the migration, so a bad migration can be undone.
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
npm ci
npm run backup
npx prisma migrate deploy
npm run build
systemctl --user restart waypoint-web waypoint-worker waypoint-tunnel

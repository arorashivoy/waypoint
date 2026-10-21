#!/usr/bin/env bash
# Starts the app and its worker for the device tests. Playwright runs this from playwright.config.ts and stops it at the end.
#
# The app gets ONLY the keys below (an allowlist), so nothing of the real setup can reach it:
# no Claude key, no Drive key, no claims file. Next and Prisma read a .env file from the project folder,
# so the app runs from a scratch folder that has no .env and no data/. The folder holds a copy of the code of this repo.
# The scratch folder is made new for each run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PORT="${E2E_PORT:?}"
SCRATCH="${E2E_SCRATCH:?}"
APP="$SCRATCH/app"

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "Port $PORT is in use. Stop the old run: kill the 'next dev' and 'scripts/worker.ts' processes (ps -eo pid,args | grep -E 'next dev|scripts/worker'), then run again." >&2
  exit 1
fi

rm -rf "$SCRATCH"
mkdir -p "$APP"
# A copy of the code, not links: Next does not find the pages through a linked src folder.
# node_modules is a link (it is large). data/ and .env are never copied.
for item in src public prisma scripts templates config tests package.json next.config.mjs tsconfig.json next-env.d.ts; do
  [ -e "$ROOT/$item" ] && cp -R "$ROOT/$item" "$APP/$item"
done
ln -s "$ROOT/node_modules" "$APP/node_modules"

# The only keys the app and the worker see. PATH and HOME are for node and npm.
run() {
  env -i \
    PATH="$PATH" HOME="$HOME" NODE_ENV=development \
    PORT="$PORT" \
    DATABASE_URL="file:$SCRATCH/e2e.db" \
    WAYPOINT_SECRET_KEY='BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=' \
    WAYPOINT_USERS_DIR="$SCRATCH/users" \
    WAYPOINT_PUBLIC_URL="http://127.0.0.1:$PORT" \
    WAYPOINT_CLAUDE_BIN=/nonexistent/claude \
    RESUME_PDF="$ROOT/tests/e2e/fixtures/base-cv.pdf" \
    LOG_LEVEL=warn \
    "$@"
}

cd "$APP"
run "$ROOT/node_modules/.bin/tsx" tests/e2e/setup/prepare.ts

WORKER=""
NEXT=""
stop() {
  trap - EXIT
  [ -n "$NEXT" ] && kill "$NEXT" 2>/dev/null
  [ -n "$WORKER" ] && kill "$WORKER" 2>/dev/null
  wait 2>/dev/null
}
trap stop EXIT
trap 'exit 143' TERM INT

run "$ROOT/node_modules/.bin/tsx" scripts/worker.ts &
WORKER=$!
run "$ROOT/node_modules/.bin/next" dev -H 127.0.0.1 -p "$PORT" &
NEXT=$!
wait "$NEXT"

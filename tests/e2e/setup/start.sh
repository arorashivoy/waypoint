#!/usr/bin/env bash
# Starts the app and its worker for the device tests. Playwright runs this from playwright.config.ts and stops it at the end.
# The scratch database and the users come from prepare.ts. The environment comes from the config.
set -euo pipefail
cd "$(dirname "$0")/../../.."
npx tsx tests/e2e/setup/prepare.ts
npx tsx scripts/worker.ts &
exec npx next dev -p "${PORT:?}"

#!/usr/bin/env bash
# Production twin of remote.sh: builds, serves with `next start`, and tunnels,
# in the background. Takes the same commands: start (default), stop, restart,
# status, logs. Use this on an always-on host like the Pi, where `next dev`
# compiles every page on first visit and holds far more memory.
WAYPOINT_MODE=prod exec "$(dirname "$0")/remote.sh" "$@"

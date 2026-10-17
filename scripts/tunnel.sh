#!/usr/bin/env bash
# Opens the public zrok share for Waypoint. The systemd unit waypoint-tunnel runs it.
# It reads the port with scripts/port.mjs, as `npm run start` does, so the
# tunnel and the web server use the same port.
#   WAYPOINT_ZROK_NAME       the name of the share (default waypoint)
#   WAYPOINT_ZROK_NAMESPACE  the namespace of the name (default public)
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="$(node scripts/port.mjs)"
ZROK_NAME="${WAYPOINT_ZROK_NAME:-waypoint}"
ZROK_NS="${WAYPOINT_ZROK_NAMESPACE:-public}"

# The share token that holds our zrok name, if any. A share that stopped
# without a clean shutdown keeps the name, and the next start is refused.
zrok_holder() {
  zrok2 list names 2>/dev/null | awk -F'│' -v n="$ZROK_NAME" -v ns="$ZROK_NS" '
    { name=$3; space=$4; tok=$5; gsub(/ /,"",name); gsub(/ /,"",space); gsub(/ /,"",tok) }
    name==n && space==ns && tok!="" { print tok }'
}

stale="$(zrok_holder)" || true
[ -n "$stale" ] && zrok2 delete share "$stale" >/dev/null 2>&1 || true

# Wait until the web server answers, so the share does not open on a closed port.
ready=0
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null -m 5 "http://localhost:$PORT/api/health"; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "The web server did not answer on port $PORT within 60 seconds." >&2; exit 1
fi

exec zrok2 share public "localhost:$PORT" -n "$ZROK_NS:$ZROK_NAME" --headless

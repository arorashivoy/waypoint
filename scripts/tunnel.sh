#!/usr/bin/env bash
# Opens the named Cloudflare Tunnel for Waypoint. The systemd unit waypoint-tunnel runs it.
# It reads the port with scripts/port.mjs, as `npm run start` does, so the
# tunnel and the web server use the same port.
#   WAYPOINT_CF_TUNNEL  the name (or UUID) of the tunnel (default waypoint)
# Do these steps one time: `cloudflared tunnel login`, `cloudflared tunnel create waypoint`
# and `cloudflared tunnel route dns waypoint <hostname>`. The credentials stay in ~/.cloudflared.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="$(node scripts/port.mjs)"
CF_TUNNEL="${WAYPOINT_CF_TUNNEL:-waypoint}"

# Wait until the web server answers, so the tunnel does not open on a closed port.
ready=0
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null -m 5 "http://localhost:$PORT/api/health"; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "The web server did not answer on port $PORT within 60 seconds." >&2; exit 1
fi

exec cloudflared tunnel --no-autoupdate run --url "http://localhost:$PORT" "$CF_TUNNEL"

#!/usr/bin/env bash
# Serves Waypoint and opens a public HTTPS tunnel to it.
#
# The Claude calls run through the local `claude` CLI, so the app cannot be
# hosted elsewhere — this machine is the server, and the tunnel is only a door
# into it. Close the laptop and the door leads nowhere.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="$(node scripts/port.mjs)"

if ! grep -q '^WAYPOINT_ACCESS_CODE="..*"' .env 2>/dev/null; then
  echo "Refusing to expose Waypoint with no passcode." >&2
  echo "Set WAYPOINT_ACCESS_CODE in .env first — past the sign-in page sit your" >&2
  echo "LinkedIn connections, your CV, and your Claude subscription." >&2
  exit 1
fi

command -v cloudflared >/dev/null || { echo "cloudflared not found: brew install cloudflared" >&2; exit 1; }

cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Whether the port already answers decides everything below. Polling the port
# alone is not enough to know *our* server started: an earlier server (or
# another session) holding the port makes a doomed `npm run dev` look healthy,
# and the tunnel then quietly depends on a process this script does not own.
if curl -sf -o /dev/null "http://localhost:$PORT" 2>/dev/null; then
  if [ -z "${WAYPOINT_DEV_FROM_START:-}" ]; then
    echo "Something is already serving :$PORT — reusing it."
    echo "  (If that is not your own \`npm run dev\`, stop it first: lsof -nP -iTCP:$PORT -sTCP:LISTEN)"
  fi
  OWN_SERVER=0
else
  echo "Starting Waypoint on :$PORT ..."
  npm run dev >/tmp/waypoint-dev.log 2>&1 &
  DEV_PID=$!
  OWN_SERVER=1

  for _ in $(seq 1 60); do
    # Check the child is alive as well as the port: if it exited (a port clash,
    # a bad build), fail loudly instead of tunnelling to whatever else answers.
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      echo "The dev server exited during startup. Last lines:" >&2
      tail -15 /tmp/waypoint-dev.log >&2
      exit 1
    fi
    curl -sf -o /dev/null "http://localhost:$PORT" 2>/dev/null && break
    sleep 1
  done

  if ! curl -sf -o /dev/null "http://localhost:$PORT" 2>/dev/null; then
    echo "The dev server never became ready; see /tmp/waypoint-dev.log" >&2
    exit 1
  fi
fi

echo "  local:  http://localhost:$PORT"

echo "Opening tunnel ..."
: >/tmp/waypoint-tunnel.log
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate >/tmp/waypoint-tunnel.log 2>&1 &
TUNNEL_PID=$!

url=""
for _ in $(seq 1 45); do
  kill -0 "$TUNNEL_PID" 2>/dev/null || { echo "cloudflared exited; see /tmp/waypoint-tunnel.log" >&2; exit 1; }
  url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/waypoint-tunnel.log | head -1 || true)
  [ -n "$url" ] && break
  sleep 1
done
[ -n "$url" ] || { echo "Tunnel did not come up; see /tmp/waypoint-tunnel.log" >&2; exit 1; }

# Prove the tunnel reaches this app rather than something else on the port.
if ! curl -sf -m 25 "$url/api/state" | grep -q '"signedIn"'; then
  echo "Warning: $url did not return a Waypoint response. Check what owns :$PORT." >&2
fi

echo
echo "  public: $url"
echo "  passcode: the WAYPOINT_ACCESS_CODE value in .env"
if [ "$OWN_SERVER" -eq 0 ] && [ -z "${WAYPOINT_DEV_FROM_START:-}" ]; then
  echo
  echo "  NOTE: this tunnel points at a server this script did not start."
  echo "        If that server stops, the public URL stops with it."
fi
echo
echo "This URL is new every run and dies with this process. Ctrl-C to stop both."
wait

#!/usr/bin/env bash
# For dev mode only. In production, the systemd units (deploy/systemd) replace this script.
# Serves Waypoint and opens a public HTTPS tunnel to it, in the background.
#
#   ./scripts/remote.sh [start]   start the server and tunnel, then return
#   ./scripts/remote.sh stop      stop both
#   ./scripts/remote.sh restart   stop, then start
#   ./scripts/remote.sh status    what is running, and the public URL
#   ./scripts/remote.sh logs      follow the server and tunnel logs
#
# start.sh is the same script in production mode (build, then `next start`).
#
# The Claude calls run through the local `claude` CLI, so the app cannot be
# hosted elsewhere — this machine is the server, and the tunnel is only a door
# into it. Close the laptop and the door leads nowhere.
#
# The tunnel is chosen by WAYPOINT_TUNNEL in .env:
#   cloudflared  (default) a quick tunnel; a new random URL on every start
#   zrok         a fixed https://<name>.shares.zrok.io URL. Needs `zrok2 enable`
#                once and a reserved name (`zrok2 create name <name>`).
#                WAYPOINT_ZROK_NAME (default waypoint), WAYPOINT_ZROK_NAMESPACE
#                (default public).
#   none         the server only, for use on your own network
set -euo pipefail
cd "$(dirname "$0")/.."

# A key from the shell wins over .env, the same precedence as scripts/port.mjs.
envv() {
  local v="${!1:-}"
  if [ -z "$v" ] && [ -f .env ]; then
    v=$(grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']\$//")
  fi
  printf '%s' "$v"
}

PORT="$(node scripts/port.mjs)"
MODE="${WAYPOINT_MODE:-dev}"
case "$MODE" in
  dev)  SERVE=dev ;;
  prod) SERVE=start ;;
  *) echo "WAYPOINT_MODE must be dev or prod, got '$MODE'" >&2; exit 1 ;;
esac
# start.sh execs this script, so name the one the user typed in messages.
SELF=remote.sh; [ "$MODE" = prod ] && SELF=start.sh
TUNNEL="$(envv WAYPOINT_TUNNEL)"; TUNNEL="${TUNNEL:-cloudflared}"
ZROK_NAME="$(envv WAYPOINT_ZROK_NAME)"; ZROK_NAME="${ZROK_NAME:-waypoint}"
ZROK_NS="$(envv WAYPOINT_ZROK_NAMESPACE)"; ZROK_NS="${ZROK_NS:-public}"

# Keyed by port so two copies on one machine never share pid files or logs.
RUN="/tmp/waypoint-$PORT"
mkdir -p "$RUN"
SERVER_LOG="$RUN/server.log"
TUNNEL_LOG="$RUN/tunnel.log"

# Each background job gets its own process group (set -m), so stopping one
# takes npm, next and their children with it, and nothing is left holding the
# port. nohup keeps them alive after the terminal that started them closes.
set -m

alive() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }
answers() { curl -sf -o /dev/null -m 5 "http://localhost:$PORT" 2>/dev/null; }

# Sends a signal to a job's whole group and waits for it to go, escalating to
# KILL if it ignores the request.
stop_job() {
  local name=$1 sig=$2 pid
  alive "$name" || { rm -f "$RUN/$name.pid"; return 0; }
  pid=$(cat "$RUN/$name.pid")
  kill "-$sig" -- "-$pid" 2>/dev/null || kill "-$sig" "$pid" 2>/dev/null || true
  for _ in $(seq 1 15); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -0 "$pid" 2>/dev/null && kill -KILL -- "-$pid" 2>/dev/null || true
  rm -f "$RUN/$name.pid"
}

# The share token currently holding our zrok name, if any. A share killed
# without a clean shutdown keeps the name, and the next start is refused.
zrok_holder() {
  zrok2 list names 2>/dev/null | awk -F'│' -v n="$ZROK_NAME" -v ns="$ZROK_NS" '
    { name=$3; space=$4; tok=$5; gsub(/ /,"",name); gsub(/ /,"",space); gsub(/ /,"",tok) }
    name==n && space==ns && tok!="" { print tok }'
}

zrok_url() {
  local host
  host=$(zrok2 list names 2>/dev/null | awk -F'│' -v n="$ZROK_NAME" -v ns="$ZROK_NS" '
    { url=$2; name=$3; space=$4; gsub(/ /,"",url); gsub(/ /,"",name); gsub(/ /,"",space) }
    name==n && space==ns { print url; exit }')
  [ -n "$host" ] && printf 'https://%s' "${host#https://}"
}

# Fetches a path through the tunnel the way a browser would.
tunnel_get() {
  local url=$1 args=(-sf -m 25)
  if [ "$TUNNEL" = zrok ]; then
    args+=(-H "skip_zrok_interstitial: 1")
  fi
  curl "${args[@]}" "$url"
}

start_server() {
  if alive server; then
    echo "Server already running (pid $(cat "$RUN/server.pid"))."
    return
  fi
  # Whether the port already answers decides everything below. Polling the port
  # alone is not enough to know *our* server started: an earlier server (or
  # another session) holding the port makes a doomed server look healthy,
  # and the tunnel then quietly depends on a process this script does not own.
  if answers; then
    echo "Something is already serving :$PORT — reusing it; \`stop\` will leave it running."
    echo "  (If that is not your own \`npm run $SERVE\`, stop it first: lsof -nP -iTCP:$PORT -sTCP:LISTEN)"
    return
  fi
  : >"$SERVER_LOG"
  # Built here rather than in start.sh so a build never rewrites .next under a
  # server that is already running from it.
  if [ "$MODE" = prod ]; then
    echo "Building ..."
    npm run build >>"$SERVER_LOG" 2>&1 || { echo "Build failed. Last lines:" >&2; tail -15 "$SERVER_LOG" >&2; exit 1; }
  fi
  echo "Starting Waypoint ($MODE) on :$PORT ..."
  nohup npm run "$SERVE" >>"$SERVER_LOG" 2>&1 </dev/null &
  echo $! >"$RUN/server.pid"

  for _ in $(seq 1 60); do
    # Check the child is alive as well as the port: if it exited (a port clash,
    # a bad build), fail loudly instead of tunnelling to whatever else answers.
    if ! alive server; then
      echo "The $MODE server exited during startup. Last lines:" >&2
      tail -15 "$SERVER_LOG" >&2
      rm -f "$RUN/server.pid"
      exit 1
    fi
    answers && return
    sleep 1
  done
  echo "The $MODE server never became ready; see $SERVER_LOG" >&2
  exit 1
}

start_tunnel() {
  if alive tunnel; then
    echo "Tunnel already running (pid $(cat "$RUN/tunnel.pid"))."
    return
  fi
  : >"$TUNNEL_LOG"
  rm -f "$RUN/url"
  case "$TUNNEL" in
    none) return ;;
    cloudflared)
      echo "Opening Cloudflare tunnel ..."
      nohup cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate >"$TUNNEL_LOG" 2>&1 </dev/null &
      echo $! >"$RUN/tunnel.pid"
      local url=""
      for _ in $(seq 1 45); do
        alive tunnel || { echo "cloudflared exited; see $TUNNEL_LOG" >&2; exit 1; }
        url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)
        [ -n "$url" ] && break
        sleep 1
      done
      [ -n "$url" ] || { echo "Tunnel did not come up; see $TUNNEL_LOG" >&2; exit 1; }
      echo "$url" >"$RUN/url"
      ;;
    zrok)
      echo "Opening zrok share '$ZROK_NAME' ..."
      local stale
      stale=$(zrok_holder)
      [ -n "$stale" ] && zrok2 delete share "$stale" >/dev/null 2>&1 || true
      nohup zrok2 share public "localhost:$PORT" -n "$ZROK_NS:$ZROK_NAME" --headless \
        >"$TUNNEL_LOG" 2>&1 </dev/null &
      echo $! >"$RUN/tunnel.pid"
      for _ in $(seq 1 30); do
        alive tunnel || { echo "zrok exited:" >&2; tail -3 "$TUNNEL_LOG" >&2; exit 1; }
        grep -q 'access your zrok share' "$TUNNEL_LOG" && break
        sleep 1
      done
      grep -q 'access your zrok share' "$TUNNEL_LOG" || { echo "zrok share did not come up; see $TUNNEL_LOG" >&2; exit 1; }
      zrok_url >"$RUN/url"
      ;;
  esac
}

stop_tunnel() {
  # zrok releases its name on a clean Ctrl-C; anything that survives is deleted
  # by token so the next start can claim the name.
  if [ "$TUNNEL" = zrok ]; then
    stop_job tunnel INT
    local stale
    stale=$(zrok_holder)
    [ -n "$stale" ] && zrok2 delete share "$stale" >/dev/null 2>&1 || true
  else
    stop_job tunnel TERM
  fi
  rm -f "$RUN/url"
}

status() {
  if alive server; then echo "  server: running (pid $(cat "$RUN/server.pid")), http://localhost:$PORT"
  elif answers; then echo "  server: :$PORT answers, but not started by this script"
  else echo "  server: stopped"; fi
  if [ "$TUNNEL" = none ]; then echo "  tunnel: none (WAYPOINT_TUNNEL=none)"
  elif alive tunnel; then echo "  tunnel: $TUNNEL, running (pid $(cat "$RUN/tunnel.pid"))"
  else echo "  tunnel: $TUNNEL, stopped"; fi
  [ -s "$RUN/url" ] && alive tunnel && echo "  public: $(cat "$RUN/url")"
  echo "  logs:   $SERVER_LOG, $TUNNEL_LOG"
}

preflight() {
  case "$TUNNEL" in
    cloudflared)
      command -v cloudflared >/dev/null || { echo "cloudflared not found: brew install cloudflared (macOS) or the arm64 .deb from github.com/cloudflare/cloudflared/releases (Pi)" >&2; exit 1; } ;;
    zrok)
      command -v zrok2 >/dev/null || { echo "zrok2 not found: curl -sSf https://get.openziti.io/install.bash | sudo bash -s zrok2" >&2; exit 1; }
      [ -n "$(zrok_url)" ] || { echo "No zrok name '$ZROK_NAME' in namespace '$ZROK_NS': zrok2 create name -n $ZROK_NS $ZROK_NAME" >&2; exit 1; } ;;
    none) ;;
    *) echo "WAYPOINT_TUNNEL must be cloudflared, zrok or none, got '$TUNNEL'" >&2; exit 1 ;;
  esac
}

start() {
  preflight
  start_server
  start_tunnel
  if [ -s "$RUN/url" ]; then
    # Prove the tunnel reaches this app rather than something else on the port.
    if ! tunnel_get "$(cat "$RUN/url")/api/health" | grep -q '"app":"waypoint"'; then
      echo "Warning: $(cat "$RUN/url") did not return a Waypoint response. Check what owns :$PORT." >&2
    fi
  fi
  echo
  status
  case "$TUNNEL" in
    cloudflared) echo; echo "This URL is new every start." ;;
  esac
  echo "  Sign in with your Waypoint account. Make the admin with: npm run user:create-admin"
  echo; echo "Running in the background. Stop with: ./scripts/$SELF stop"
}

stop() {
  stop_tunnel
  if alive server; then
    stop_job server TERM
  elif answers; then
    echo "Leaving the server on :$PORT running; this script did not start it."
  fi
  echo "Stopped."
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  status)  status ;;
  logs)    exec tail -n 40 -F "$SERVER_LOG" "$TUNNEL_LOG" ;;
  *) echo "usage: ./scripts/$SELF [start|stop|restart|status|logs]" >&2; exit 1 ;;
esac

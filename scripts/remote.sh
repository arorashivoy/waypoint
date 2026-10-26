#!/usr/bin/env bash
# For dev mode only. In production, the systemd units (deploy/systemd) replace this script.
# Serves Waypoint, runs the task worker and opens a public HTTPS tunnel, in the background.
# Without the worker, no task runs: refresh, CV builds and imports stay queued.
#
#   ./scripts/remote.sh [start]   start the server, the worker and the tunnel, then return
#   ./scripts/remote.sh stop      stop all three
#   ./scripts/remote.sh restart   stop, then start
#   ./scripts/remote.sh status    what is running, and the public URL
#   ./scripts/remote.sh logs      follow the server, worker and tunnel logs
#
# start.sh is the same script in production mode (build, then `next start`).
#
# The Claude calls run through the local `claude` CLI, so the app cannot be
# hosted elsewhere — this machine is the server, and the tunnel is only a door
# into it. Close the laptop and the door leads nowhere.
#
# The tunnel is chosen by WAYPOINT_TUNNEL in .env:
#   quick   (default) a Cloudflare quick tunnel; a new random URL on every start.
#           The old name `cloudflared` also selects it.
#   named   a named Cloudflare Tunnel on your own domain, at WAYPOINT_PUBLIC_URL.
#           Needs `cloudflared tunnel login`, `cloudflared tunnel create <name>` and
#           `cloudflared tunnel route dns <name> <hostname>` once.
#           WAYPOINT_CF_TUNNEL (default waypoint) is the name of the tunnel.
#   none    the server only, for use on your own network
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
TUNNEL="$(envv WAYPOINT_TUNNEL)"; TUNNEL="${TUNNEL:-quick}"
[ "$TUNNEL" = cloudflared ] && TUNNEL=quick
CF_TUNNEL="$(envv WAYPOINT_CF_TUNNEL)"; CF_TUNNEL="${CF_TUNNEL:-waypoint}"
PUBLIC_URL="$(envv WAYPOINT_PUBLIC_URL)"; PUBLIC_URL="${PUBLIC_URL%/}"

# Keyed by port so two copies on one machine never share pid files or logs.
RUN="/tmp/waypoint-$PORT"
mkdir -p "$RUN"
SERVER_LOG="$RUN/server.log"
TUNNEL_LOG="$RUN/tunnel.log"
WORKER_LOG="$RUN/worker.log"

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

# Fetches a path through the tunnel the way a browser would.
tunnel_get() {
  curl -sf -m 25 "$1"
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

# The worker runs the queued tasks (refresh, analysis, CV builds, imports).
# It reads .env itself (`npm run worker`), so it uses the same database as the server.
start_worker() {
  if alive worker; then
    echo "Worker already running (pid $(cat "$RUN/worker.pid"))."
    return
  fi
  : >"$WORKER_LOG"
  echo "Starting the task worker ..."
  nohup npm run worker >>"$WORKER_LOG" 2>&1 </dev/null &
  echo $! >"$RUN/worker.pid"
  sleep 2
  if ! alive worker; then
    echo "The worker exited during startup. Last lines:" >&2
    tail -15 "$WORKER_LOG" >&2
    rm -f "$RUN/worker.pid"
    exit 1
  fi
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
    quick)
      echo "Opening a Cloudflare quick tunnel ..."
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
    named)
      echo "Opening the Cloudflare tunnel '$CF_TUNNEL' ..."
      nohup cloudflared tunnel --no-autoupdate run --url "http://localhost:$PORT" "$CF_TUNNEL" \
        >"$TUNNEL_LOG" 2>&1 </dev/null &
      echo $! >"$RUN/tunnel.pid"
      for _ in $(seq 1 30); do
        alive tunnel || { echo "cloudflared exited:" >&2; tail -3 "$TUNNEL_LOG" >&2; exit 1; }
        grep -q 'Registered tunnel connection' "$TUNNEL_LOG" && break
        sleep 1
      done
      grep -q 'Registered tunnel connection' "$TUNNEL_LOG" || { echo "The tunnel did not connect; see $TUNNEL_LOG" >&2; exit 1; }
      echo "$PUBLIC_URL" >"$RUN/url"
      ;;
  esac
}

stop_tunnel() {
  stop_job tunnel TERM
  rm -f "$RUN/url"
}

status() {
  if alive server; then echo "  server: running (pid $(cat "$RUN/server.pid")), http://localhost:$PORT"
  elif answers; then echo "  server: :$PORT answers, but not started by this script"
  else echo "  server: stopped"; fi
  if alive worker; then echo "  worker: running (pid $(cat "$RUN/worker.pid"))"
  else echo "  worker: stopped. Tasks wait until it runs."; fi
  if [ "$TUNNEL" = none ]; then echo "  tunnel: none (WAYPOINT_TUNNEL=none)"
  elif alive tunnel; then echo "  tunnel: $TUNNEL, running (pid $(cat "$RUN/tunnel.pid"))"
  else echo "  tunnel: $TUNNEL, stopped"; fi
  [ -s "$RUN/url" ] && alive tunnel && echo "  public: $(cat "$RUN/url")"
  echo "  logs:   $SERVER_LOG, $WORKER_LOG, $TUNNEL_LOG"
}

preflight() {
  case "$TUNNEL" in
    quick|named|none) ;;
    *) echo "WAYPOINT_TUNNEL must be quick, named or none, got '$TUNNEL'" >&2; exit 1 ;;
  esac
  [ "$TUNNEL" = none ] && return
  command -v cloudflared >/dev/null || { echo "cloudflared not found: brew install cloudflared (macOS) or the arm64 .deb from github.com/cloudflare/cloudflared/releases (Pi)" >&2; exit 1; }
  if [ "$TUNNEL" = named ]; then
    [ -n "$PUBLIC_URL" ] || { echo "WAYPOINT_TUNNEL=named needs WAYPOINT_PUBLIC_URL, for example https://waypoint.example.com" >&2; exit 1; }
    cloudflared tunnel info "$CF_TUNNEL" >/dev/null 2>&1 || { echo "No Cloudflare tunnel '$CF_TUNNEL'. Run: cloudflared tunnel login, then cloudflared tunnel create $CF_TUNNEL" >&2; exit 1; }
  fi
}

start() {
  preflight
  start_server
  start_worker
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
    quick) echo; echo "This URL is new every start." ;;
  esac
  echo "  Sign in with your Waypoint account. Make the admin with: npm run user:create-admin"
  echo; echo "Running in the background. Stop with: ./scripts/$SELF stop"
}

stop() {
  stop_tunnel
  # The worker finishes the task that runs, so give it the same TERM as the server.
  stop_job worker TERM
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
  logs)    exec tail -n 40 -F "$SERVER_LOG" "$WORKER_LOG" "$TUNNEL_LOG" ;;
  *) echo "usage: ./scripts/$SELF [start|stop|restart|status|logs]" >&2; exit 1 ;;
esac

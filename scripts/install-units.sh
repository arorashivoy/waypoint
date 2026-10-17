#!/usr/bin/env bash
# Copies the systemd user units into the config folder of the user.
#   ./scripts/install-units.sh <absolute path of this checkout>
# It fills in @CHECKOUT@ and @NODE_BIN@. It does not enable or start a unit.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../deploy/systemd" && pwd)"
CHECKOUT="${1:-}"

if [ -z "$CHECKOUT" ]; then
  echo "usage: $0 <absolute path of the checkout>" >&2; exit 1
fi
case "$CHECKOUT" in
  /*) ;;
  *) echo "The path must be absolute: $CHECKOUT" >&2; exit 1 ;;
esac
if [[ ! "$CHECKOUT" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "The path may use only the characters A-Z a-z 0-9 . _ / -" >&2; exit 1
fi
case "/$CHECKOUT/" in
  */../*) echo "The path must not hold a .. segment: $CHECKOUT" >&2; exit 1 ;;
esac
if [ ! -d "$CHECKOUT" ]; then
  echo "The folder does not exist: $CHECKOUT" >&2; exit 1
fi
CHECKOUT="$(realpath "$CHECKOUT")"
if [[ ! "$CHECKOUT" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "The real path uses a character that a unit cannot hold: $CHECKOUT" >&2; exit 1
fi
if [ ! -f "$CHECKOUT/.env" ]; then
  echo "The file $CHECKOUT/.env does not exist. Make it first (see .env.example)." >&2; exit 1
fi

NODE_PATH_FOUND="$(command -v node || true)"
if [ -z "$NODE_PATH_FOUND" ]; then
  echo "node is not on PATH. Install Node 22 and run this script again." >&2; exit 1
fi
NODE_BIN="$(dirname "$NODE_PATH_FOUND")"
if [[ ! "$NODE_BIN" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "The folder of node uses a character that a unit cannot hold: $NODE_BIN" >&2; exit 1
fi

DEST="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$DEST"
for f in "$SRC"/waypoint-*.service "$SRC"/waypoint-*.timer; do
  sed -e "s|@CHECKOUT@|$CHECKOUT|g" -e "s|@NODE_BIN@|$NODE_BIN|g" "$f" >"$DEST/$(basename "$f")"
done
systemctl --user daemon-reload

echo "Installed the units in $DEST."
echo "These commands do not run now. Run them yourself:"
echo "  systemctl --user enable --now waypoint-web waypoint-worker waypoint-tunnel waypoint-backup.timer"
echo "  loginctl enable-linger $USER"

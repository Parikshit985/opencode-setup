#!/usr/bin/env bash
# start-office.sh -- Mac/Linux equivalent of start-office.ps1.
# Launches (idempotently): 1) `opencode serve` on 127.0.0.1:41017, 2) `pixel-agents --port 4748`.
# Logs: ~/.config/opencode/logs/{boot.log,pixel-office.log,opencode-serve.log}
set -uo pipefail

CONFIG_ROOT="$HOME/.config/opencode"
LOG_DIR="$CONFIG_ROOT/logs"
BOOT_LOG="$LOG_DIR/boot.log"
OFFICE_LOG="$LOG_DIR/pixel-office.log"
SERVE_LOG="$LOG_DIR/opencode-serve.log"
# TODO: set to the folder pixel-agents should serve (default: ~/Desktop)
WORK_DIR="${WORK_DIR:-$HOME/Desktop}"

OPENCODE_PORT=41017
OFFICE_PORT=4748

mkdir -p "$LOG_DIR"
boot() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$BOOT_LOG"; }
port_listening() { (command -v nc >/dev/null && nc -z 127.0.0.1 "$1" 2>/dev/null) || (command -v lsof >/dev/null && lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1); }

boot "=== start-office begin ==="

if port_listening "$OFFICE_PORT"; then
  boot "pixel-agents: port $OFFICE_PORT already listening -> skipping"
elif ! command -v pixel-agents >/dev/null 2>&1; then
  boot "pixel-agents: ERROR - pixel-agents not found in PATH"
else
  boot "pixel-agents: starting on port $OFFICE_PORT (cwd $WORK_DIR)"
  (cd "$WORK_DIR" && nohup pixel-agents --port "$OFFICE_PORT" >"$OFFICE_LOG" 2>&1 &) || boot "pixel-agents: failed to start"
  sleep 2
  port_listening "$OFFICE_PORT" && boot "pixel-agents: started ok -> http://127.0.0.1:$OFFICE_PORT" || boot "pixel-agents: WARNING - port $OFFICE_PORT not listening, see $OFFICE_LOG"
fi

if port_listening "$OPENCODE_PORT"; then
  boot "opencode serve: port $OPENCODE_PORT already listening -> skipping"
elif ! command -v opencode >/dev/null 2>&1; then
  boot "opencode serve: ERROR - opencode not found in PATH"
else
  boot "opencode serve: starting on port $OPENCODE_PORT"
  nohup opencode serve --hostname 127.0.0.1 --port "$OPENCODE_PORT" >>"$SERVE_LOG" 2>&1 & || boot "opencode serve: failed to start"
  sleep 2
  port_listening "$OPENCODE_PORT" && boot "opencode serve: started ok -> http://127.0.0.1:$OPENCODE_PORT" || boot "opencode serve: WARNING - port $OPENCODE_PORT not listening, see $SERVE_LOG"
fi

boot "=== start-office end ==="
exit 0

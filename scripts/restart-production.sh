#!/usr/bin/env bash
# Restart typingmind-proxy on :3000, preserving MCP_AUTH_TOKEN from the current listener.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-3000}"
LOG="${LOG:-$ROOT/logs/production.log}"
mkdir -p "$(dirname "$LOG")"

OLD_PID="$(lsof -ti :"$PORT" 2>/dev/null | head -1 || true)"
if [[ -z "$OLD_PID" ]]; then
  echo "ERROR: no process listening on port $PORT" >&2
  exit 1
fi

TOKEN="$(strings "/proc/$OLD_PID/environ" 2>/dev/null | grep '^MCP_AUTH_TOKEN=' | cut -d= -f2- || true)"
if [[ -z "${TOKEN:-}" ]]; then
  echo "ERROR: port $PORT listener (pid $OLD_PID) has no MCP_AUTH_TOKEN — fix env before restart." >&2
  exit 1
fi

echo "Stopping pid $OLD_PID on :$PORT"
kill "$OLD_PID" 2>/dev/null || true
for _ in 1 2 3 4 5; do
  sleep 1
  if ! kill -0 "$OLD_PID" 2>/dev/null; then
    break
  fi
done
if kill -0 "$OLD_PID" 2>/dev/null; then
  kill -9 "$OLD_PID" 2>/dev/null || true
fi

export MCP_AUTH_TOKEN="$TOKEN"
export NODE_ENV=production
export PORT="$PORT"
nohup npm start >>"$LOG" 2>&1 &
NEW_PID=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  NEW_PID="$(lsof -ti :"$PORT" 2>/dev/null | head -1 || true)"
  if [[ -n "$NEW_PID" ]]; then
    break
  fi
done
if [[ -z "$NEW_PID" ]]; then
  echo "ERROR: server did not bind :$PORT — see $LOG" >&2
  tail -20 "$LOG" >&2 || true
  exit 1
fi
if ! strings "/proc/$NEW_PID/environ" 2>/dev/null | grep -q '^MCP_AUTH_TOKEN='; then
  echo "ERROR: new pid $NEW_PID missing MCP_AUTH_TOKEN" >&2
  exit 1
fi
echo "OK: typingmind-proxy pid=$NEW_PID port=$PORT log=$LOG"

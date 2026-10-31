#!/usr/bin/env bash
# Idempotent install of the sole periodic ops remediator crontab entry.
set -euo pipefail
OPS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$OPS_DIR/.." && pwd)"
ENTRY="*/3 * * * * $OPS_DIR/remediate.sh >> $ROOT/logs/ops-cron.log 2>&1"
MARKER="llm-plugins-server/ops/remediate.sh"

mkdir -p "$ROOT/logs"
existing="$(crontab -l 2>/dev/null || true)"
# Drop any previous ops remediator / blind watchdog lines for this stack
filtered="$(printf '%s\n' "$existing" | grep -v 'llm-plugins-server/ops/remediate.sh' | grep -v 'watchdog-production.sh' || true)"
{
  printf '%s\n' "$filtered"
  printf '%s\n' "$ENTRY"
} | grep -v '^$' | crontab -

crontab -l | grep -F "$MARKER" >/dev/null
echo "OK: cron installed for ops/remediate.sh every 3 minutes"

#!/usr/bin/env bash
# pm2 entrypoint for the council notifier. Using a wrapper avoids pm2 arg-
# parsing ambiguity around `--watch` (pm2 can otherwise swallow it, causing the
# script to run once and exit -> restart loop). This execs the long-running
# watch loop directly.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$HERE/council-notify.py" --watch --interval 20

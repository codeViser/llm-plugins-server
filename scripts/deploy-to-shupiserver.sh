#!/usr/bin/env bash
# Mac → shupiserver: sync source, test deferredJobs, build, restart (keeps MCP_AUTH_TOKEN).
set -euo pipefail
HOST="${DEPLOY_HOST:-codeviser@shupiserver}"
REMOTE_ROOT="${DEPLOY_REMOTE:-Documents/servers/llm-plugins-server}"
LOCAL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> rsync $LOCAL_ROOT -> $HOST:$REMOTE_ROOT"
rsync -az \
  --exclude node_modules \
  --exclude data \
  --exclude dist \
  --exclude .env \
  --exclude .git \
  "$LOCAL_ROOT/" "$HOST:$REMOTE_ROOT/"

echo "==> remote test + build + restart"
ssh "$HOST" "cd $REMOTE_ROOT && chmod +x scripts/restart-production.sh && npm test -- --run src/deferredJobs && npm run build && ./scripts/restart-production.sh"

echo "==> smoke deferred dry_run (loopback)"
ssh "$HOST" 'PID=$(lsof -ti :3000 | head -1); TOKEN=$(strings /proc/$PID/environ | grep "^MCP_AUTH_TOKEN=" | cut -d= -f2-); \
  OUT=$(curl -sS -w "\nHTTP:%{http_code}" -X POST http://127.0.0.1:3000/deferred-jobs/run \
  -H "Content-Type: text/plain;charset=UTF-8" \
  -d "{\"goal\":\"deploy-smoke\",\"dry_run\":true,\"mcp_auth_token\":\"$TOKEN\",\"gather_profile\":{\"schema_version\":2,\"model_id\":\"gpt-6-luna\",\"api_family\":\"openai_responses\",\"model_slug\":\"gpt-6-luna\",\"reasoning\":{\"effort\":\"high\",\"summary\":\"auto\"}}}"); \
  echo "$OUT" | tail -5; echo "$OUT" | grep -q "HTTP:200"'

echo "Deploy complete."

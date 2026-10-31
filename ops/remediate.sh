#!/usr/bin/env bash
# Diagnose-then-remediate entrypoint. Never restarts without a named failure class.
set -euo pipefail
OPS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$OPS_DIR/.." && pwd)"
MANIFEST="$OPS_DIR/manifest.yaml"
PROBE="$OPS_DIR/health_probe.py"
CAPTURE="$OPS_DIR/capture_evidence.py"
STATE_DIR="$ROOT/logs/ops-state"
ESCALATE_LOG="$ROOT/logs/ops-escalate.log"
mkdir -p "$STATE_DIR" "$(dirname "$ESCALATE_LOG")" "$ROOT/logs/evidence"

DRY_RUN="${OPS_DRY_RUN:-0}"
INJECT_JSON="${OPS_INJECT_PROBE_JSON:-}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

cooldown_sec="$(python3 -c "import yaml; print(yaml.safe_load(open('$MANIFEST')).get('cooldown_sec',900))")"
pm2_bin="$(python3 -c "import yaml; print(yaml.safe_load(open('$MANIFEST'))['paths']['pm2_bin'])")"
restart_prod="$(python3 -c "import yaml; print(yaml.safe_load(open('$MANIFEST'))['paths']['restart_production'])")"

if [[ -n "$INJECT_JSON" ]]; then
  RESULT="$INJECT_JSON"
else
  set +e
  RESULT="$("$PROBE" 2>/dev/null)"
  probe_rc=$?
  set -e
fi

CLASS="$(printf '%s' "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['class'])")"
log "probe_class=$CLASS"

escalate() {
  local reason="$1"
  mkdir -p "$(dirname "$ESCALATE_LOG")"
  printf '%s class=%s reason=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CLASS" "$reason" >>"$ESCALATE_LOG"
  log "escalate reason=$reason class=$CLASS"
  exit 1
}

# Classes that must never restart
case "$CLASS" in
  ok)
    log "ok"
    exit 0
    ;;
  supervisor_conflict|unknown|tunnel_flapping)
    escalate "no_restart_class"
    ;;
esac

# Map class → allowlisted action (must match manifest remediation)
ACTION=""
TARGET=""
case "$CLASS" in
  origin_hang|origin_down)
    ACTION="restart_production"
    TARGET="typingmind-proxy"
    ;;
  tunnel_unready)
    ACTION="pm2_restart"
    TARGET="cloudflared-tunnel"
    ;;
  shadow_hub_down|shadow_engine_down|shadow_core_split)
    # Hub, engine, and playwright must move together (continuation + MCP).
    ACTION="shadow_stack_reload"
    TARGET="core"
    ;;
  openclaw_inactive)
    ACTION="systemd_user_restart"
    TARGET="openclaw-gateway.service"
    ;;
  *)
    escalate "unmapped_class"
    ;;
esac

# Cooldown per class
stamp="$STATE_DIR/cooldown-$CLASS"
now="$(date +%s)"
if [[ -f "$stamp" ]]; then
  last="$(cat "$stamp" 2>/dev/null || echo 0)"
  if [[ "$last" =~ ^[0-9]+$ ]] && (( now - last < cooldown_sec )); then
    log "skipped_cooldown class=$CLASS action=$ACTION remaining=$((cooldown_sec - (now - last)))s"
    exit 1
  fi
fi

if [[ "$DRY_RUN" == "1" ]]; then
  log "dry_run action=$ACTION target=$TARGET"
  # Dry-run must not set cooldown or write evidence.
  exit 0
fi

# Evidence before heal (especially hangs) — never dump secrets
EVIDENCE_PATH=""
if [[ "$CLASS" == "origin_hang" || "$CLASS" == "origin_down" || "$CLASS" == "tunnel_unready" ]]; then
  EVIDENCE_PATH="$(printf '%s' "$RESULT" | python3 "$CAPTURE" "$CLASS" -)"
  log "evidence=$EVIDENCE_PATH"
fi

log "remediate action=$ACTION target=$TARGET"
case "$ACTION" in
  restart_production)
    "$restart_prod"
    ;;
  shadow_stack_reload)
    STACK="$HOME/Documents/servers/llm-shadow-service/deploy/stack.sh"
    if [[ ! -x "$STACK" ]]; then
      escalate "shadow_stack_missing"
    fi
    bash "$STACK" reload "$TARGET"
    log "did shadow_stack_reload target=$TARGET"
    ;;

  pm2_restart)
    "$pm2_bin" restart "$TARGET"
    ;;
  systemd_user_restart)
    systemctl --user restart "$TARGET"
    ;;
  *)
    escalate "action_not_allowlisted"
    ;;
esac

echo "$now" >"$stamp"

# Re-probe once; if still bad, escalate (no second restart)
set +e
AFTER="$("$PROBE" 2>/dev/null)"
after_rc=$?
set -e
AFTER_CLASS="$(printf '%s' "$AFTER" | python3 -c "import json,sys; print(json.load(sys.stdin)['class'])")"
log "after_class=$AFTER_CLASS"
if [[ "$AFTER_CLASS" != "ok" ]]; then
  escalate "still_failing_after_one_action after=$AFTER_CLASS"
fi
log "recovered class_was=$CLASS"
exit 0

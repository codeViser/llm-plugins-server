# Pi ops plane (diagnose-then-remediate)

Ownership and health contracts live in `manifest.yaml`. This directory does **not** own process lifecycle — PM2 and systemd do.

## Principles

1. One supervisor per service (never PM2 + systemd for the same process).
2. `health_probe.py` classifies only — never restarts.
3. `remediate.sh` acts only on a named failure class with allowlisted action + cooldown.
4. Unknown / supervisor_conflict / tunnel_flapping → escalate, no restart.
5. No secrets in logs (no tokens, no private hostname prefixes).

## Commands

```bash
# Classify only (exit 0 iff ok)
./ops/health_probe.py

# Probe then remediate matched class (cron entrypoint)
./ops/remediate.sh

# Install sole periodic crontab line
./ops/install-cron.sh
```

## Anti-dual-supervision

- Cloudflare tunnel: PM2 only. Never `cloudflared service install`.
- OpenClaw gateway: systemd user unit only. Not a PM2 app.

## Failure classes

See plan taxonomy: `ok`, `origin_hang`, `origin_down`, `tunnel_unready`, `shadow_*`, `openclaw_inactive`, `supervisor_conflict`, `tunnel_flapping`, `unknown`.

## Shadow core restarts (mandatory joint)

Do not restart `shadow-hub` or `shadow-engine` alone from this ops plane.

Use:

```bash
~/Documents/servers/llm-shadow-service/deploy/stack.sh reload core
```

Full guide: `~/Documents/servers/llm-shadow-service/docs/STACK-OPS.md`  
Servers index: `~/Documents/servers/SHADOW-STACK.md`

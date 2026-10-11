# TypingMind ↔ Pi MCP connector — startup (no `.env` hardening)

**Canonical server:** `codeviser@shupiserver:~/Documents/servers/llm-plugins-server` branch `self/dev` (at commit `caae0e5` ops model — **no** `MCP_AUTH_TOKEN` in gitignored `.env` workflow).

## Rule

`MCP_AUTH_TOKEN` on the Pi process must be **byte-identical** to the token in **TypingMind → MCP / connector settings** for your tunnel host (e.g. `*.example.com`).

If the Pi starts **without** that variable, routes fall back to `dummy-token` and TypingMind gets **401 Invalid authentication token**.

## Normal restart (use every time)

```bash
ssh codeviser@shupiserver
cd ~/Documents/servers/llm-plugins-server
./scripts/restart-production.sh
```

This script:

1. Reads `MCP_AUTH_TOKEN` from the **current** process on `:3000` (via `/proc/<pid>/environ`).
2. Stops that process and starts `npm start` with the **same** token exported in the shell (not from a bash-sourced `.env` file).

**Do not** run bare `nohup npm start` or `npm start` alone unless you have already `export MCP_AUTH_TOKEN='…'` in that shell.

## Deploy code then restart

```bash
cd ~/Documents/servers/llm-plugins-server
git pull   # or your usual sync
npm test --run
npm run build
./scripts/restart-production.sh
```

## If you see 401 again

1. **Do not** add `MCP_AUTH_TOKEN` to a `.env` file and `source` it — tokens with `` ` `` or `$` can be **corrupted** by bash.
2. Confirm TypingMind connector token has not been rotated without updating the Pi listener.
3. **Recovery A (preferred):** In TypingMind, copy the connector token, SSH to the Pi, then start once with Python (no shell interpolation of the secret):

```bash
cd ~/Documents/servers/llm-plugins-server
read -r -s -p "Paste MCP token: " MCP_AUTH_TOKEN; echo
export MCP_AUTH_TOKEN NODE_ENV=production PORT=3000
OLD=$(lsof -ti :3000 | head -1); [ -n "$OLD" ] && kill "$OLD" && sleep 2
nohup npm start >>logs/production.log 2>&1 &
```

(`read -s` stores the token without bash interpreting metacharacters.)

4. **Recovery B:** If the token only exists in a recent TypingMind request, extract the last Bearer from `logs/production.log` with a short Python script (see `research/results/2026-10-11-mcp-401-recovery.md`) and export it before `npm start` as above.

5. After one good start, future restarts: `./scripts/restart-production.sh` only.

## Smoke check (on Pi)

```bash
# Must be 401 JSON, not Swagger HTML
curl -s http://127.0.0.1:3000/ping
```

With a valid token (do not paste into chat logs):

```bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:3000/ping
# → {"status":"ok"}
```

## What we reverted (2026-10-11)

Commits `ce2b19c` / `58c63a4` (`.env` requirement, bootstrap scripts, fail-fast hardening) were **removed** from `self/dev`. Ops are **listener token + `restart-production.sh`** only.

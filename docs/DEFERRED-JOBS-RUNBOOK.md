# Deferred jobs — Pi runbook

## Processes

| Service | Check |
|---------|--------|
| `llm-plugins-server` | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/health` → 200 |
| OpenClaw gateway | `pgrep -f "openclaw.*gateway"` |
| `council-notify.py` | `pgrep -f council-notify` |

PM2 may not be on SSH `PATH`; production often runs:

`tsx dist/index.js` from `~/Documents/servers/llm-plugins-server`.

## Deploy

```bash
cd ~/Documents/servers/llm-plugins-server
git pull   # after Mac sync
npm ci
npm run build
npm test
# restart tsx process
```

## Logs

Server uses pino; watch the terminal/supervisor that launched `dist/index.js`.

## OpenRouter batch spike

```bash
OPENROUTER_API_KEY=... node scripts/spike-openrouter-batch.mjs openai/gpt-5.6-luna-pro:batch
```

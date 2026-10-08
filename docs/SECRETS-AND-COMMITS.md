# Secrets and commits (llm-plugins-server)

**Remote:** `git@github.com:codeViser/llm-plugins-server.git`  
**Production host:** ShuPiServer — `pm2` app `typingmind-proxy`

---

## Never commit

- `.env`, `.creds.txt`, `**/credentials*`, live API keys, OAuth secrets, MCP tokens
- `ecosystem.config.js` with real env (file is **gitignored** via `ecosystem.*` — do not force-add)
- SQLite DBs under `data/`, chat exports, customer content
- Cloudflare tunnel tokens, TypingMind license material

Use `.env.example` with empty placeholders only.

---

## Pre-push checklist

```bash
git status
git diff origin/self/dev...HEAD   # adjust branch if needed
```

Reject any diff line containing assignable secrets (keys, tokens, `GOCSPX-`, `sk-`, long bearer strings).

Rotate any credential that was ever staged accidentally before pushing.

---

## Runtime secrets on Pi

- PM2 / `ecosystem.config.js` (local only, gitignored)
- TypingMind plugin settings (browser) — user-provided keys per request for Google Places

Application code must **not** log request bodies containing `apiKey` / `Authorization`.

---

## Scoped DNS note (not a global privacy exception)

`src/routes/googlePlaces/googlePlaces.service.ts` resolves **`places.googleapis.com`** via public DNS inside that HTTP client only, because ExpressVPN DNS on the Pi often breaks Google APIs. This does **not** change system DNS for git, SSH, or other routes.

For **git push** when Pi cannot resolve `github.com`, push from Mac or fix VPN DNS on the Pi — see TPM-dev `docs/COMMIT-AND-SECRETS-POLICY.md`.

---

## TPM dev workspace

Cross-cutting browser + commit policy:  
`~/Documents/web-apps/TPM-dev/docs/COMMIT-AND-SECRETS-POLICY.md`

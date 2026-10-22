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

## DNS on Pi

Google Places uses **system DNS** (ExpressVPN `resolv.conf`). If VPN DNS is mis-routed again, see TPM-dev `docs/PI-DNS-EXPRESSVPN.md` — fix `expressvpn_pi` routing; do not add per-plugin public DNS overrides unless necessary.

---

## TPM dev workspace

Cross-cutting browser + commit policy:  
`~/Documents/web-apps/TPM-dev/docs/COMMIT-AND-SECRETS-POLICY.md`

#!/usr/bin/env python3
"""
council-notify: push a message when a Research Council finishes.

Runs ON THE PI. It is the *tracker*: it reads the council SQLite state, and when
a council reaches a terminal status (done/error) it TELLS OpenClaw to report via
Telegram. OpenClaw does the actual send (its bot, its pipeline) — OpenClaw never
polls anything.

Delivery transports (first available wins):
  1) NOTIFY_CMD          : shell template with {text}/{job_id}/{status} (override).
  2) openclaw (default)  : `openclaw message send --channel telegram --target <id>
                           --message <text>` using OpenClaw's own gateway. No token
                           handled here. Target chat id + CLI are auto-discovered.
  3) telegram (fallback) : direct Bot API, only if you set TELEGRAM_BOT_TOKEN +
                           TELEGRAM_CHAT_ID explicitly in the env file.
  4) stdout              : just print (local log).

Auto-discovery (no config needed if OpenClaw is set up):
  openclaw CLI <- node version from ~/.openclaw/scripts/launch-gateway.sh
  target id    <- ~/.openclaw/credentials/telegram-default-allowFrom.json allowFrom
Overrides, from ~/.council-notify.env (untracked) or environment:
  NOTIFY_CMD, TELEGRAM_CHAT_ID (comma-separated), TELEGRAM_BOT_TOKEN

Usage:
  python3 scripts/council-notify.py --print-config   # show discovery (redacted)
  python3 scripts/council-notify.py --test           # send one test message now
  python3 scripts/council-notify.py --seed            # mark current terminal jobs as already-notified
  python3 scripts/council-notify.py --once            # one pass (cron-friendly)
  python3 scripts/council-notify.py --watch --interval 30
  python3 scripts/council-notify.py --once --dry-run  # detect + print, never send
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from council_config import format_config_line, job_config

OPENCLAW_DIR = os.path.expanduser("~/.openclaw")


def default_db_path() -> str:
    env_dir = os.environ.get("MULTI_AGENT_DATA_DIR")
    here = os.path.dirname(os.path.abspath(__file__))
    for c in (
        os.path.join(env_dir, "multiagent_jobs.db") if env_dir else None,
        os.path.join(here, "..", "data", "multiagent_jobs.db"),
        os.path.join(os.getcwd(), "data", "multiagent_jobs.db"),
    ):
        if c and os.path.exists(c):
            return os.path.abspath(c)
    return os.path.abspath(os.path.join(here, "..", "data", "multiagent_jobs.db"))


def default_state_path(db_path: str) -> str:
    return os.path.join(os.path.dirname(db_path), "council-notified.json")


def load_env_file() -> dict:
    path = os.environ.get("COUNCIL_NOTIFY_ENV", os.path.expanduser("~/.council-notify.env"))
    cfg = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("NOTIFY_CMD", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    return cfg


def _read_json(path):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def discover_openclaw_token() -> tuple[str | None, str]:
    envp = os.path.join(OPENCLAW_DIR, ".env")
    if os.path.exists(envp):
        for line in open(envp, encoding="utf-8"):
            line = line.strip()
            if line.startswith("TELEGRAM_BOT_TOKEN=") and "=" in line:
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
                if v:
                    return v, "openclaw:.env"
    cfg = _read_json(os.path.join(OPENCLAW_DIR, "openclaw.json")) or {}
    tok = (((cfg.get("channels") or {}).get("telegram") or {}).get("botToken"))
    if tok:
        return tok, "openclaw:openclaw.json"
    return None, "none"


def discover_openclaw_cli() -> tuple[list[str] | None, str]:
    """Return the command prefix [node_bin, openclaw_entry] to run the CLI, or None.

    The `openclaw` shim on PATH may point at a too-old Node. The gateway pins its
    node version in launch-gateway.sh (OPENCLAW_NODE_VERSION); we reuse it and run
    the resolved openclaw entry with that node explicitly.
    """
    nvm = os.path.expanduser("~/.nvm/versions/node")
    versions: list[str] = []
    launch = os.path.join(OPENCLAW_DIR, "scripts", "launch-gateway.sh")
    if os.path.exists(launch):
        m = re.search(r'OPENCLAW_NODE_VERSION="([^"]+)"', open(launch, encoding="utf-8").read())
        if m:
            versions.append(m.group(1))
    if os.path.isdir(nvm):
        # add other installed versions (desc) as fallback
        others = sorted((d for d in os.listdir(nvm) if re.match(r"v\d", d)), reverse=True)
        versions += [v for v in others if v not in versions]
    for ver in versions:
        node_bin = os.path.join(nvm, ver, "bin", "node")
        oc_link = os.path.join(nvm, ver, "bin", "openclaw")
        if os.path.exists(node_bin) and os.path.exists(oc_link):
            entry = os.path.realpath(oc_link)
            return [node_bin, entry], f"openclaw@{ver}"
    return None, "none"


def discover_openclaw_chat_ids() -> tuple[list[str], str]:
    allow = _read_json(os.path.join(OPENCLAW_DIR, "credentials", "telegram-default-allowFrom.json")) or {}
    ids = []
    lst = allow.get("allowFrom") if isinstance(allow, dict) else None
    if isinstance(lst, list):
        for v in lst:
            if isinstance(v, (int, str)) and str(v).lstrip("-").isdigit():
                ids.append(str(v))
    if ids:
        return ids, "openclaw:allowFrom"
    return [], "none"


def resolve_config() -> dict:
    cfg = load_env_file()

    chat_ids: list[str] = []
    chat_src = None
    if cfg.get("TELEGRAM_CHAT_ID"):
        chat_ids = [c.strip() for c in cfg["TELEGRAM_CHAT_ID"].split(",") if c.strip()]
        chat_src = "config"
    else:
        chat_ids, chat_src = discover_openclaw_chat_ids()

    oc_cmd, oc_src = discover_openclaw_cli()

    # Telegram Bot API is only a fallback; needs an explicit token to be used.
    token = cfg.get("TELEGRAM_BOT_TOKEN")
    token_src = "config" if token else "none"

    if cfg.get("NOTIFY_CMD"):
        transport = "cmd"
    elif oc_cmd and chat_ids:
        transport = "openclaw"
    elif token and chat_ids:
        transport = "telegram"
    else:
        transport = "stdout"

    cfg["_chat_ids"] = chat_ids
    cfg["_chat_src"] = chat_src or "none"
    cfg["_oc_cmd"] = oc_cmd
    cfg["_oc_src"] = oc_src
    cfg["_token"] = token
    cfg["_token_src"] = token_src
    cfg["_transport"] = transport
    return cfg


def print_config(cfg: dict) -> int:
    print("council-notify configuration (values redacted):")
    print(f"  transport   : {cfg['_transport']}")
    print(f"  openclaw CLI: {'found' if cfg.get('_oc_cmd') else 'not found'} ({cfg['_oc_src']})")
    ids = cfg.get("_chat_ids") or []
    print(f"  target id(s): {len(ids)} found (source={cfg['_chat_src']})")
    if cfg.get("NOTIFY_CMD"):
        print("  NOTIFY_CMD  : set (takes precedence)")
    if cfg["_transport"] == "telegram":
        tok = cfg.get("_token")
        print(f"  bot token   : present (source={cfg['_token_src']}, len={len(tok) if tok else 0})")
    if cfg["_transport"] == "stdout":
        print("  NOTE: no OpenClaw CLI/target and no NOTIFY_CMD -> messages print to stdout only.")
    return 0


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M")


def job_kind(row: sqlite3.Row) -> str:
    try:
        raw = row["input_json"] if "input_json" in row.keys() else None
    except Exception:  # noqa: BLE001
        raw = None
    if not raw:
        return "council"
    try:
        data = json.loads(raw)
        return (data.get("job_kind") or "council").strip()
    except Exception:  # noqa: BLE001
        return "council"


def build_message(row: sqlite3.Row) -> str:
    goal = (row["goal"] or "").strip()
    if len(goal) > 120:
        goal = goal[:119] + "\u2026"
    kind = job_kind(row)
    if row["status"] == "done":
        head = (
            "\u2705 Deferred research finished"
            if kind == "deferred_batch"
            else "\u2705 Research council finished"
        )
    else:
        head = (
            "\u26a0\ufe0f Deferred research failed"
            if kind == "deferred_batch"
            else "\u26a0\ufe0f Research council failed"
        )
    lines = [head, f"job_id: {row['id']}"]
    cfg = job_config(row)
    if cfg:
        lines.append(format_config_line(cfg))
    lines.append(f"goal: {goal}")
    lines.append(f"finished: {iso(row['updated_at'])}")
    if row["status"] == "error" and row["error"]:
        lines.append(f"error: {row['error'][:200]}")
    lines.append("Ask your assistant to fetch this job_id for the full result.")
    return "\n".join(lines)


def send_via_cmd(cmd_template: str, text: str, job_id: str, status: str) -> tuple[bool, str]:
    cmd = (cmd_template.replace("{text}", shlex.quote(text))
           .replace("{job_id}", shlex.quote(job_id))
           .replace("{status}", shlex.quote(status)))
    try:
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        return proc.returncode == 0, (proc.stderr or proc.stdout or "").strip()[:200]
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def send_via_openclaw(oc_cmd: list[str], chat_id: str, text: str) -> tuple[bool, str]:
    args = list(oc_cmd) + [
        "message", "send", "--channel", "telegram", "--target", str(chat_id), "--message", text, "--json",
    ]
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=90)
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"
    out = (proc.stdout or "").strip()
    # The CLI prints a JSON object; success is payload.ok or a messageId.
    try:
        data = json.loads(out)
        ok = bool(data.get("messageId") or (data.get("payload") or {}).get("ok"))
        return ok, ("ok" if ok else (out[:160] or (proc.stderr or "")[:160]))
    except Exception:  # noqa: BLE001
        ok = proc.returncode == 0
        return ok, (out[:160] or (proc.stderr or "").strip()[:160] or f"rc={proc.returncode}")


def send_via_telegram(token: str, chat_id: str, text: str) -> tuple[bool, str]:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": text, "disable_web_page_preview": "true"}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method="POST"), timeout=20) as r:
            body = json.loads(r.read().decode())
            return bool(body.get("ok")), "ok" if body.get("ok") else str(body)[:200]
    except urllib.error.HTTPError as e:  # noqa: PERF203
        try:
            return False, str(json.loads(e.read().decode()))[:200]
        except Exception:  # noqa: BLE001
            return False, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def deliver(cfg: dict, text: str, job_id: str, status: str, dry_run: bool) -> tuple[bool, str]:
    if dry_run:
        print("--- would notify ---")
        print(text)
        print("--------------------")
        return True, "dry-run"
    if cfg.get("NOTIFY_CMD"):
        return send_via_cmd(cfg["NOTIFY_CMD"], text, job_id, status)
    if cfg.get("_transport") == "openclaw":
        ok_all, details = True, []
        for cid in cfg["_chat_ids"]:
            ok, detail = send_via_openclaw(cfg["_oc_cmd"], cid, text)
            ok_all = ok_all and ok
            details.append(detail)
        return ok_all, "; ".join(details)
    if cfg.get("_transport") == "telegram":
        ok_all, details = True, []
        for cid in cfg["_chat_ids"]:
            ok, detail = send_via_telegram(cfg["_token"], cid, text)
            ok_all = ok_all and ok
            details.append(detail)
        return ok_all, "; ".join(details)
    print(text)
    return True, "stdout"


def load_state(path: str) -> dict:
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return {}
    return {}


def save_state(path: str, state: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, path)


def terminal_rows(db_path: str):
    conn = sqlite3.connect(db_path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT id, status, goal, error, created_at, updated_at, input_json, result FROM multiagent_jobs "
            "WHERE status IN ('done','error') ORDER BY updated_at ASC"
        ).fetchall()
    except sqlite3.OperationalError:
        rows = conn.execute(
            "SELECT id, status, goal, error, created_at, updated_at FROM multiagent_jobs "
            "WHERE status IN ('done','error') ORDER BY updated_at ASC"
        ).fetchall()
    conn.close()
    return rows


def all_job_ids(db_path: str) -> set:
    conn = sqlite3.connect(db_path, timeout=5.0)
    ids = {row[0] for row in conn.execute("SELECT id FROM multiagent_jobs")}
    conn.close()
    return ids


def cmd_seed(db_path: str, state_path: str) -> int:
    rows = terminal_rows(db_path) if os.path.exists(db_path) else []
    state = load_state(state_path)
    notified = state.get("notified", {})
    for r in rows:
        notified[r["id"]] = r["status"]
    state["notified"] = notified
    save_state(state_path, state)
    print(f"council-notify: seeded {len(rows)} existing terminal council(s) as already-notified.")
    return 0


def cmd_test(cfg: dict) -> int:
    text = (
        "\u2705 Research Council notifier is live on the Pi (via your OpenClaw Telegram bot).\n"
        "You will get a message here when a council finishes."
    )
    ok, detail = deliver(cfg, text, "test", "test", dry_run=False)
    print(f"council-notify test: {'sent' if ok else 'FAILED'} via {cfg['_transport']} ({detail})")
    return 0 if ok else 1


def one_pass(db_path: str, state_path: str, cfg: dict, dry_run: bool, summary: bool = True) -> int:
    """Deliver notifications for newly-terminal councils. Returns count sent.

    Logging is event-driven: it prints a line only when it delivers or fails.
    `summary=True` (used by --once/cron) also prints a one-line tally. Under
    --watch, summary=False keeps the log quiet between real events.
    """
    if not os.path.exists(db_path):
        if summary:
            print(f"No council database at {db_path} yet.")
        return 0
    rows = terminal_rows(db_path)
    state = load_state(state_path)
    notified = state.get("notified", {})
    sent = 0
    for r in rows:
        if notified.get(r["id"]) == r["status"]:
            continue
        ok, detail = deliver(cfg, build_message(r), r["id"], r["status"], dry_run)
        if ok:
            sent += 1
            if not dry_run:
                notified[r["id"]] = r["status"]
            print(f"council-notify: delivered {r['status']} {r['id'][:8]} via {cfg['_transport']} ({detail})")
        else:
            print(f"council-notify: FAILED {r['id'][:8]}: {detail}", file=sys.stderr)
    if not dry_run:
        # Prune state to jobs still in the DB (the server TTL-deletes old jobs),
        # so council-notified.json stays bounded and consistent with the DB.
        known = all_job_ids(db_path)
        notified = {k: v for k, v in notified.items() if k in known}
        state["notified"] = notified
        save_state(state_path, state)
    if summary:
        print(f"council-notify: {sent} new notification(s); {len(notified)} tracked.")
    return sent


def main() -> int:
    ap = argparse.ArgumentParser(description="Notify when a Research Council finishes.")
    ap.add_argument("--db", default=default_db_path())
    ap.add_argument("--state", default=None)
    ap.add_argument("--once", action="store_true", help="Run a single pass (default).")
    ap.add_argument("--watch", action="store_true", help="Keep running, polling every --interval seconds.")
    ap.add_argument("--interval", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true", help="Detect and print, never send or mark.")
    ap.add_argument("--print-config", action="store_true", help="Show discovered config (redacted) and exit.")
    ap.add_argument("--test", action="store_true", help="Send one test message now and exit.")
    ap.add_argument("--seed", action="store_true", help="Mark current terminal councils as already-notified and exit.")
    args = ap.parse_args()

    state_path = args.state or default_state_path(args.db)
    cfg = resolve_config()

    if args.print_config:
        return print_config(cfg)
    if args.seed:
        return cmd_seed(args.db, state_path)
    if args.test:
        return cmd_test(cfg)
    if args.watch:
        print(f"council-notify: watching every {max(5, args.interval)}s, transport={cfg['_transport']}")
        last_heartbeat = time.time()
        try:
            while True:
                one_pass(args.db, state_path, cfg, args.dry_run, summary=False)
                now = time.time()
                if now - last_heartbeat >= 1800:  # ~30 min quiet heartbeat for liveness
                    print(f"council-notify: heartbeat ok (transport={cfg['_transport']})")
                    last_heartbeat = now
                time.sleep(max(5, args.interval))
        except KeyboardInterrupt:
            return 0
    return one_pass(args.db, state_path, cfg, args.dry_run, summary=True)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
council-status: inspect Research Council jobs directly on the Pi.

Reads the same SQLite state the multi-agent server writes
(data/multiagent_jobs.db). No auth token needed, no model tokens spent — just
SSH into the Pi and run it.

Examples:
  python3 scripts/council-status.py                 # list recent councils
  python3 scripts/council-status.py list --status running
  python3 scripts/council-status.py show 57d2c16f   # full result (id prefix ok)
  python3 scripts/council-status.py watch            # live-refresh the list
  python3 scripts/council-status.py list --json      # machine-readable
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone

from council_config import format_config_line, job_config


def default_db_path() -> str:
    env_dir = os.environ.get("MULTI_AGENT_DATA_DIR")
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = []
    if env_dir:
        candidates.append(os.path.join(env_dir, "multiagent_jobs.db"))
    candidates.append(os.path.join(here, "..", "data", "multiagent_jobs.db"))
    candidates.append(os.path.join(os.getcwd(), "data", "multiagent_jobs.db"))
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    return os.path.abspath(candidates[0])


def connect(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        sys.exit(f"No council database at {db_path}. Has a council run yet?")
    conn = sqlite3.connect(db_path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


def human_age(ms: float) -> str:
    secs = max(0, (time.time() * 1000 - ms) / 1000)
    if secs < 60:
        return f"{int(secs)}s"
    mins = secs / 60
    if mins < 60:
        return f"{int(mins)}m"
    hours = mins / 60
    if hours < 48:
        return f"{hours:.1f}h"
    return f"{hours / 24:.1f}d"


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def fetch_rows(conn, status=None, limit=20):
    sql = "SELECT id, status, goal, error, created_at, updated_at, input_json, result FROM multiagent_jobs"
    args = []
    if status:
        sql += " WHERE status = ?"
        args.append(status)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    args.append(max(1, min(200, limit)))
    try:
        return conn.execute(sql, args).fetchall()
    except sqlite3.OperationalError:
        sql = "SELECT id, status, goal, error, created_at, updated_at FROM multiagent_jobs"
        args = []
        if status:
            sql += " WHERE status = ?"
            args.append(status)
        sql += " ORDER BY updated_at DESC LIMIT ?"
        args.append(max(1, min(200, limit)))
        return conn.execute(sql, args).fetchall()


def cmd_list(conn, args) -> int:
    rows = fetch_rows(conn, status=args.status, limit=args.limit)
    if args.json:
        print(json.dumps([
            {
                "id": r["id"],
                "status": r["status"],
                "goal": r["goal"],
                "error": r["error"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
                "config": job_config(r),
            }
            for r in rows
        ], indent=2))
        return 0
    if not rows:
        print("No councils found.")
        return 0
    print(f"{'JOB ID':36}  {'STATUS':8}  {'AGE':>6}  CONFIG")
    print("-" * 110)
    for r in rows:
        cfg = format_config_line(job_config(r))
        print(f"{r['id']:36}  {r['status']:8}  {human_age(r['updated_at']):>6}  {cfg}")
        goal = (r["goal"] or "").replace("\n", " ")
        if len(goal) > 90:
            goal = goal[:89] + "\u2026"
        print(f"{'':36}  {goal}")
    running = sum(1 for r in rows if r["status"] == "running")
    print("-" * 100)
    print(f"{len(rows)} shown · {running} running")
    return 0


def cmd_show(conn, args) -> int:
    prefix = args.job_id.strip()
    rows = conn.execute(
        "SELECT * FROM multiagent_jobs WHERE id = ? OR id LIKE ? ORDER BY updated_at DESC",
        (prefix, prefix + "%"),
    ).fetchall()
    if not rows:
        sys.exit(f"No council matches id/prefix '{prefix}'.")
    if len(rows) > 1:
        print(f"Multiple councils match '{prefix}':")
        for r in rows:
            print(f"  {r['id']}  {r['status']}  {(r['goal'] or '')[:50]}")
        return 1
    r = rows[0]
    result = None
    if r["result"]:
        try:
            result = json.loads(r["result"])
        except json.JSONDecodeError:
            result = r["result"]
    if args.json:
        print(json.dumps({**dict(r), "result": result}, indent=2))
        return 0
    print(f"job_id : {r['id']}")
    print(f"status : {r['status']}")
    cfg = job_config(r)
    if cfg:
        print(f"config : {format_config_line(cfg)}")
        print(json.dumps(cfg, indent=2))
    print(f"goal   : {r['goal']}")
    print(f"started: {iso(r['created_at'])}  ({human_age(r['created_at'])} ago)")
    print(f"updated: {iso(r['updated_at'])}  ({human_age(r['updated_at'])} ago)")
    if r["error"]:
        print(f"error  : {r['error']}")
    if isinstance(result, dict):
        print("\n--- result ---")
        if result.get("answer"):
            print(result["answer"])
        meta_keys = ("model", "reasoning_effort", "rounds", "max_agents", "plugin_max_agents", "requested_agents", "timeout_sec", "config", "tools_invoked")
        meta = {k: result[k] for k in meta_keys if k in result}
        if meta:
            print("\n--- meta ---")
            print(json.dumps(meta, indent=2))
    elif result:
        print("\n--- result ---")
        print(result)
    return 0


def cmd_watch(conn_factory, args) -> int:
    try:
        while True:
            conn = conn_factory()
            os.system("clear" if os.name != "nt" else "cls")
            print(f"Research councils · refresh {args.interval}s · {datetime.now().strftime('%H:%M:%S')} · Ctrl-C to stop\n")
            cmd_list(conn, args)
            conn.close()
            time.sleep(max(1, args.interval))
    except KeyboardInterrupt:
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect Research Council jobs on the Pi.")
    parser.add_argument("--db", default=default_db_path(), help="Path to multiagent_jobs.db")
    sub = parser.add_subparsers(dest="cmd")

    p_list = sub.add_parser("list", help="List recent councils (default)")
    p_list.add_argument("--status", choices=["running", "done", "error"], help="Filter by status")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.add_argument("--json", action="store_true")

    p_show = sub.add_parser("show", help="Show one council (id or id prefix)")
    p_show.add_argument("job_id")
    p_show.add_argument("--json", action="store_true")

    p_watch = sub.add_parser("watch", help="Live-refresh the list")
    p_watch.add_argument("--status", choices=["running", "done", "error"])
    p_watch.add_argument("--limit", type=int, default=20)
    p_watch.add_argument("--interval", type=int, default=5)
    p_watch.add_argument("--json", action="store_true")

    args = parser.parse_args()
    cmd = args.cmd or "list"

    if cmd == "watch":
        return cmd_watch(lambda: connect(args.db), args)

    conn = connect(args.db)
    if cmd == "show":
        return cmd_show(conn, args)
    # default + list
    if not hasattr(args, "status"):
        args.status = None
        args.limit = 20
        args.json = False
    return cmd_list(conn, args)


if __name__ == "__main__":
    sys.exit(main())

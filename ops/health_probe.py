#!/usr/bin/env python3
"""Classify stack health from ops/manifest.yaml. No restarts. No secrets."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

OPS_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = OPS_DIR / "manifest.yaml"


def load_manifest() -> dict[str, Any]:
    with MANIFEST_PATH.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def run(cmd: list[str], timeout: float = 10) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def port_listen_pid(port: int) -> int | None:
    r = run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], timeout=5)
    for line in (r.stdout or "").splitlines():
        line = line.strip()
        if line.isdigit():
            return int(line)
    return None


def curl_status(url: str, timeout_sec: float) -> tuple[str, int | None, float]:
    """Return (kind, status_or_None, elapsed). kind in ok|timeout|refused|error."""
    t0 = time.monotonic()
    try:
        r = run(
            [
                "curl",
                "-sS",
                "-o",
                "/dev/null",
                "-w",
                "%{http_code}",
                "--max-time",
                str(timeout_sec),
                url,
            ],
            timeout=timeout_sec + 2,
        )
        elapsed = time.monotonic() - t0
        code_s = (r.stdout or "").strip()
        err = (r.stderr or "").lower()
        if r.returncode == 28 or "timed out" in err:
            return "timeout", None, elapsed
        if r.returncode == 7:
            return "refused", None, elapsed
        if not code_s.isdigit():
            return "error", None, elapsed
        return "ok", int(code_s), elapsed
    except subprocess.TimeoutExpired:
        return "timeout", None, time.monotonic() - t0


def curl_body(url: str, timeout_sec: float) -> tuple[str, str]:
    try:
        r = run(["curl", "-sS", "--max-time", str(timeout_sec), url], timeout=timeout_sec + 2)
        if r.returncode == 28:
            return "timeout", ""
        if r.returncode != 0:
            return "error", (r.stderr or "")[:200]
        return "ok", r.stdout or ""
    except subprocess.TimeoutExpired:
        return "timeout", ""


def token_present(pid: int) -> bool:
    try:
        env = Path(f"/proc/{pid}/environ").read_bytes()
    except OSError:
        return False
    return b"MCP_AUTH_TOKEN=" in env


def pm2_status(pm2_bin: str, name: str) -> str:
    try:
        r = run([pm2_bin, "jlist"], timeout=15)
        if r.returncode != 0 or not (r.stdout or "").strip():
            return "unknown"
        apps = json.loads(r.stdout)
        for a in apps:
            if a.get("name") == name:
                return a.get("pm2_env", {}).get("status", "unknown")
        return "missing"
    except Exception:
        return "unknown"


def systemd_user_active(unit: str) -> bool:
    r = run(["systemctl", "--user", "is-active", unit], timeout=5)
    return (r.stdout or "").strip() == "active"


def check_supervisor_conflicts(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    pm2_bin = manifest["paths"]["pm2_bin"]
    for svc in manifest.get("services", []):
        forbid = svc.get("forbid_systemd_unit")
        if forbid and Path(forbid).exists():
            issues.append(
                {
                    "service": svc["id"],
                    "detail": "forbidden_systemd_unit_exists",
                    "path": forbid,
                }
            )
        if svc.get("supervisor") == "systemd-user":
            st = pm2_status(pm2_bin, svc["id"])
            if st == "online":
                issues.append(
                    {
                        "service": svc["id"],
                        "detail": "also_online_under_pm2",
                    }
                )
    return issues


def classify(manifest: dict[str, Any]) -> dict[str, Any]:
    timeout = float(manifest.get("probe_timeout_sec", 5))
    pm2_bin = manifest["paths"]["pm2_bin"]
    evidence: dict[str, Any] = {"checks": {}}
    classes: list[str] = []

    conflicts = check_supervisor_conflicts(manifest)
    if conflicts:
        return {
            "class": "supervisor_conflict",
            "classes": ["supervisor_conflict"],
            "evidence": {"conflicts": conflicts},
            "ts": time.time(),
        }

    results: dict[str, Any] = {}

    for svc in manifest["services"]:
        sid = svc["id"]
        health = svc.get("health") or {}
        htype = health.get("type")
        rec: dict[str, Any] = {"id": sid, "type": htype}

        if htype == "cloudflared_ready":
            kind, body = curl_body(health["url"], timeout)
            rec["kind"] = kind
            ready_n = None
            if kind == "ok":
                try:
                    data = json.loads(body)
                    ready_n = int(data.get("readyConnections", 0))
                except Exception:
                    ready_n = None
            rec["readyConnections"] = ready_n
            min_n = int(health.get("min_ready_connections", 1))
            ok = kind == "ok" and ready_n is not None and ready_n >= min_n
            rec["ok"] = ok
            # Flap detection: compare PM2 restart_time to prior sample in state_dir
            restarts = None
            try:
                r = run([pm2_bin, "jlist"], timeout=15)
                for a in json.loads(r.stdout or "[]"):
                    if a.get("name") == svc.get("pm2_name"):
                        restarts = int(a.get("pm2_env", {}).get("restart_time", 0))
                        break
            except Exception:
                restarts = None
            rec["pm2_restarts"] = restarts
            state_dir = Path(manifest["paths"]["state_dir"])
            state_dir.mkdir(parents=True, exist_ok=True)
            flap_file = state_dir / "cloudflared-restarts.prev"
            threshold = int(manifest.get("tunnel_flap_threshold", 10))
            if restarts is not None and flap_file.exists():
                try:
                    prev = int(flap_file.read_text(encoding="utf-8").strip() or "0")
                except ValueError:
                    prev = restarts
                delta = restarts - prev
                rec["restart_delta"] = delta
                if delta >= threshold:
                    classes.append("tunnel_flapping")
                    ok = False
                    rec["ok"] = False
            if restarts is not None:
                flap_file.write_text(str(restarts), encoding="utf-8")
            if not ok and "tunnel_flapping" not in classes:
                classes.append("tunnel_unready")

        elif htype == "http_listen":
            port = int(health["port"])
            pid = port_listen_pid(port)
            rec["listen_pid"] = pid
            if pid is None:
                rec["ok"] = False
                classes.append("origin_down")
            else:
                if health.get("require_mcp_token_env") and not token_present(pid):
                    rec["token_present"] = False
                    rec["ok"] = False
                    classes.append("unknown")
                else:
                    rec["token_present"] = bool(health.get("require_mcp_token_env"))
                    kind, status, elapsed = curl_status(health["url"], timeout)
                    rec["http_kind"] = kind
                    rec["http_status"] = status
                    rec["elapsed"] = round(elapsed, 4)
                    expect = health.get("expect_status")
                    if kind == "timeout":
                        rec["ok"] = False
                        classes.append("origin_hang")
                    elif kind != "ok" or (expect is not None and status != expect):
                        if kind == "refused":
                            classes.append("origin_down")
                        else:
                            classes.append("unknown")
                        rec["ok"] = False
                    else:
                        rec["ok"] = True

        elif htype == "http":
            kind, status, elapsed = curl_status(health["url"], timeout)
            rec["http_kind"] = kind
            rec["http_status"] = status
            rec["elapsed"] = round(elapsed, 4)
            if health.get("accept_status_any"):
                ok = kind == "ok" and status is not None
            else:
                ok = kind == "ok" and status == int(health.get("expect_status", 200))
            rec["ok"] = ok
            if not ok:
                if sid == "shadow-hub":
                    classes.append("shadow_hub_down")
                elif sid == "shadow-engine":
                    classes.append("shadow_engine_down")
                else:
                    classes.append("unknown")

        elif htype == "pm2_online_only":
            st = pm2_status(pm2_bin, svc["pm2_name"])
            rec["pm2_status"] = st
            rec["ok"] = st == "online"
            # observe-only: do not add remediation class

        elif htype == "systemd_http":
            active = systemd_user_active(svc["systemd_unit"])
            rec["systemd_active"] = active
            kind, status, elapsed = curl_status(health["url"], timeout)
            rec["http_kind"] = kind
            rec["http_status"] = status
            rec["elapsed"] = round(elapsed, 4)
            if health.get("accept_status_any"):
                http_ok = kind == "ok" and status is not None
            else:
                http_ok = kind == "ok"
            rec["ok"] = active and http_ok
            if not rec["ok"]:
                classes.append("openclaw_inactive")

        else:
            rec["ok"] = False
            classes.append("unknown")

        if svc.get("supervisor") == "pm2" and "pm2_name" in svc:
            st = pm2_status(pm2_bin, svc["pm2_name"])
            rec["pm2_status"] = st
            if st != "online" and htype != "pm2_online_only" and rec.get("ok"):
                classes.append("unknown")
                rec["ok"] = False

        results[sid] = rec

    evidence["checks"] = results

    uniq: list[str] = []
    for c in classes:
        if c not in uniq:
            uniq.append(c)

    if not uniq:
        primary = "ok"
    elif "tunnel_flapping" in uniq:
        # Flapping supersedes tunnel_unready; escalate-only class
        primary = "tunnel_flapping"
    elif len(uniq) == 1:
        primary = uniq[0]
    else:
        actionable = [c for c in uniq if c != "unknown"]
        if len(actionable) == 1:
            primary = actionable[0]
        else:
            primary = "unknown"
            evidence["ambiguous_classes"] = uniq

    return {
        "class": primary,
        "classes": uniq,
        "evidence": evidence,
        "ts": time.time(),
    }


def main() -> int:
    manifest = load_manifest()
    result = classify(manifest)
    json.dump(result, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0 if result["class"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())

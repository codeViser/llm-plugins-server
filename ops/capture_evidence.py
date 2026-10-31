#!/usr/bin/env python3
"""Write scrubbed evidence pack before remediation. Never dumps secrets."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

OPS_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = OPS_DIR / "manifest.yaml"

SECRETISH = re.compile(
    r"(?i)(token|secret|password|authorization|bearer|api[_-]?key)\s*[:=]\s*\S+"
)
HOSTNAMEISH = re.compile(r"[a-z0-9]{8,}\.codeviser\.me", re.I)


def scrub(text: str) -> str:
    text = SECRETISH.sub(r"\1=[redacted]", text)
    text = HOSTNAMEISH.sub("[REDACTED].codeviser.me", text)
    return text


def run(cmd: list[str], timeout: float = 10) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return (r.stdout or "") + (r.stderr or "")
    except Exception as exc:
        return f"cmd_error: {exc}\n"


def port_listen_pid(port: int) -> int | None:
    out = run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], timeout=5)
    for line in out.splitlines():
        if line.strip().isdigit():
            return int(line.strip())
    return None


def capture(cls: str, probe: dict[str, Any]) -> Path:
    with MANIFEST_PATH.open(encoding="utf-8") as f:
        manifest = yaml.safe_load(f)
    evidence_dir = Path(manifest["paths"]["evidence_dir"])
    evidence_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = evidence_dir / f"{stamp}-{cls}.txt"

    lines: list[str] = [
        f"class={cls}",
        f"ts={time.time()}",
        "probe_json=",
        scrub(json.dumps(probe, indent=2)),
        "",
        "=== ss :3000 ===",
        scrub(run(["ss", "-tlnp"])),
        "",
    ]

    pid = port_listen_pid(3000)
    if pid:
        lines.append(f"listen_pid={pid}")
        lines.append(scrub(run(["ps", "-o", "pid,etime,pcpu,pmem,rss,stat,cmd", "-p", str(pid)])))
        try:
            status = Path(f"/proc/{pid}/status").read_text(encoding="utf-8", errors="replace")
            for key in ("Name", "State", "VmRSS", "Threads"):
                for row in status.splitlines():
                    if row.startswith(key):
                        lines.append(row)
        except OSError:
            pass
        # Token presence only — never value
        try:
            present = b"MCP_AUTH_TOKEN=" in Path(f"/proc/{pid}/environ").read_bytes()
            lines.append(f"MCP_AUTH_TOKEN_present={present}")
        except OSError:
            lines.append("MCP_AUTH_TOKEN_present=unknown")

    lines.append("")
    lines.append("=== Recv-Q hint (ss) ===")
    lines.append(scrub(run(["bash", "-lc", "ss -tlnp | grep ':3000' || true"])))

    err_log = Path.home() / ".pm2/logs/typingmind-proxy-error.log"
    if err_log.exists():
        lines.append("")
        lines.append("=== typingmind-proxy-error.log (tail, scrubbed) ===")
        try:
            raw = err_log.read_text(encoding="utf-8", errors="replace").splitlines()[-40:]
            for row in raw:
                if "NODE-CRON" in row or "missed execution" in row or "Error" in row or "FATAL" in row:
                    lines.append(scrub(row)[:500])
        except OSError:
            pass

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: capture_evidence.py <class> [probe.json|-]", file=sys.stderr)
        return 2
    cls = sys.argv[1]
    if len(sys.argv) >= 3 and sys.argv[2] != "-":
        probe = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    else:
        probe = json.load(sys.stdin)
    path = capture(cls, probe)
    print(str(path))
    return 0


if __name__ == "__main__":
    sys.exit(main())

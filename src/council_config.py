"""Extract the applied council config from a SQLite job row (no secrets)."""
from __future__ import annotations

import json
from typing import Any, Mapping


def _num(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value == value:
        return int(value)
    return None


def _parse(text: Any) -> dict:
    if not text:
        return {}
    if isinstance(text, dict):
        return text
    try:
        obj = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return {}
    return obj if isinstance(obj, dict) else {}


def job_config(row: Mapping[str, Any]) -> dict[str, Any]:
    """Return {model, plugin_max_agents, requested_agents, max_agents, timeout_sec}."""
    result = _parse(row["result"] if "result" in row.keys() else None)
    nested = result.get("config") if isinstance(result.get("config"), dict) else {}
    stored = _parse(row["input_json"] if "input_json" in row.keys() else None)

    model = nested.get("model") or result.get("model") or stored.get("model")
    api_model = nested.get("api_model") or result.get("api_model") or stored.get("api_model")
    reasoning_mode = nested.get("reasoning_mode")
    if reasoning_mode is None and "reasoning_mode" in result:
        reasoning_mode = result.get("reasoning_mode")
    if reasoning_mode is None:
        reasoning_mode = stored.get("reasoning_mode")
    reasoning_effort = nested.get("reasoning_effort")
    if reasoning_effort is None and "reasoning_effort" in result:
        reasoning_effort = result.get("reasoning_effort")
    if reasoning_effort is None:
        reasoning_effort = stored.get("reasoning_effort")
    plugin_max = _num(nested.get("plugin_max_agents")) or _num(result.get("plugin_max_agents")) or _num(stored.get("max_agents"))
    requested = nested.get("requested_agents")
    if requested is None and "requested_agents" in result:
        requested = result.get("requested_agents")
    if requested is None:
        requested = stored.get("requested_agents")
    max_agents = _num(nested.get("max_agents")) or _num(result.get("max_agents")) or _num(stored.get("applied_max_agents")) or plugin_max
    timeout_sec = _num(nested.get("timeout_sec")) or _num(result.get("timeout_sec")) or _num(stored.get("timeout_sec"))

    cfg = {
        "model": model or None,
        "api_model": api_model or None,
        "reasoning_mode": reasoning_mode if reasoning_mode is not None else None,
        "reasoning_effort": reasoning_effort if reasoning_effort is not None else None,
        "plugin_max_agents": plugin_max,
        "requested_agents": requested if requested is not None else None,
        "max_agents": max_agents,
        "timeout_sec": timeout_sec,
    }
    return {k: v for k, v in cfg.items() if v is not None}


def format_config_line(cfg: Mapping[str, Any]) -> str:
    model = cfg.get("model") or "?"
    api_model = cfg.get("api_model")
    reasoning_mode = cfg.get("reasoning_mode")
    reasoning_effort = cfg.get("reasoning_effort")
    cap = cfg.get("plugin_max_agents")
    used = cfg.get("max_agents")
    requested = cfg.get("requested_agents")
    if cap is not None and used is not None and cap != used:
        agents = f"{used}/{cap}"
    elif used is not None:
        agents = str(used)
    elif cap is not None:
        agents = str(cap)
    else:
        agents = "?"
    if requested is not None:
        agents = f"{agents} (requested {requested})"
    timeout = cfg.get("timeout_sec")
    timeout_s = f"{int(timeout) // 3600}h" if isinstance(timeout, int) and timeout >= 3600 else (f"{timeout}s" if timeout else None)
    model_part = model
    if api_model and api_model != model:
        model_part = f"{model} (api {api_model})"
    if reasoning_mode or reasoning_effort:
        if reasoning_mode:
            mode = f"reasoning {reasoning_mode}"
            if reasoning_effort:
                mode += f"/{reasoning_effort}"
        else:
            mode = f"reasoning effort {reasoning_effort}"
        model_part = f"{model_part} · {mode}"
    parts = [f"model {model_part}", f"agents {agents}"]
    if timeout_s:
        parts.append(f"timeout {timeout_s}")
    return " · ".join(parts)

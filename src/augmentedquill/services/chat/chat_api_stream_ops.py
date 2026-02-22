# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the chat api stream ops unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from augmentedquill.core.config import load_story_config
from augmentedquill.core.prompts import get_system_message, load_model_prompt_overrides
from augmentedquill.services.llm.llm_request_helpers import find_model_in_list


def normalize_chat_messages(value: Any) -> list[dict]:
    """Preserve OpenAI message fields including tool calls."""
    arr = value if isinstance(value, list) else []
    out: list[dict] = []
    for message in arr:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role", "")).strip().lower() or "user"
        normalized: dict = {"role": role}
        if "content" in message:
            content = message.get("content")
            normalized["content"] = None if content is None else str(content)
        name = message.get("name")
        if isinstance(name, str) and name:
            normalized["name"] = name
        tool_call_id = message.get("tool_call_id")
        if isinstance(tool_call_id, str) and tool_call_id:
            normalized["tool_call_id"] = tool_call_id
        tool_calls = message.get("tool_calls")
        if isinstance(tool_calls, list) and tool_calls:
            normalized["tool_calls"] = tool_calls
            if role == "assistant":
                normalized["content"] = None
        out.append(normalized)
    return out


def resolve_stream_model_context(payload: dict, machine: dict) -> dict:
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}
    model_type = (payload or {}).get("model_type") or "CHAT"
    selected_name = (
        (payload or {}).get("model_name")
        or openai_cfg.get(f"selected_{model_type.lower()}")
        or openai_cfg.get("selected")
    )

    base_url = (payload or {}).get("base_url")
    api_key = (payload or {}).get("api_key")
    model_id = (payload or {}).get("model")
    timeout_s = (payload or {}).get("timeout_s")

    chosen = None
    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    if isinstance(models, list) and models:
        chosen = find_model_in_list(models, selected_name) or models[0]

        base_url = chosen.get("base_url") or base_url
        api_key = chosen.get("api_key") or api_key
        model_id = chosen.get("model") or model_id
        timeout_s = chosen.get("timeout_s", 60) or timeout_s

    is_multimodal = True
    supports_function_calling = True
    if chosen:
        if chosen.get("is_multimodal") is False:
            is_multimodal = False
        if chosen.get("supports_function_calling") is False:
            supports_function_calling = False

    return {
        "openai_cfg": openai_cfg,
        "model_type": model_type,
        "selected_name": selected_name,
        "base_url": base_url,
        "api_key": api_key,
        "model_id": model_id,
        "timeout_s": timeout_s,
        "chosen": chosen,
        "is_multimodal": is_multimodal,
        "supports_function_calling": supports_function_calling,
    }


def ensure_system_message_if_missing(
    req_messages: list[dict],
    *,
    model_type: str,
    machine: dict,
    selected_name: str | None,
) -> None:
    has_system = any(msg.get("role") == "system" for msg in req_messages)
    if has_system:
        return

    sys_msg_key = "chat_llm"
    if model_type == "WRITING":
        sys_msg_key = "writing_llm"
    elif model_type == "EDITING":
        sys_msg_key = "editing_llm"

    model_overrides = load_model_prompt_overrides(machine, selected_name)
    system_content = get_system_message(sys_msg_key, model_overrides)
    req_messages.insert(0, {"role": "system", "content": system_content})


def resolve_story_llm_prefs(
    config_dir: Path, active_project_dir: Path | None
) -> tuple[float, Any]:
    story = load_story_config((active_project_dir or config_dir) / "story.json") or {}
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = (
        float(prefs.get("temperature", 0.7))
        if isinstance(prefs.get("temperature", 0.7), (int, float, str))
        else 0.7
    )
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens", None)
    return temperature, max_tokens

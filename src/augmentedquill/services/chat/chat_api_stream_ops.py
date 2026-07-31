# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chat api stream ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from augmentedquill.core.config import load_story_config
from augmentedquill.core.prompts import (
    get_system_message,
    load_model_prompt_overrides,
)
from augmentedquill.services.chat.chat_tool_decorator import MODEL_ROLES
from augmentedquill.services.chat.chat_tools.chapter_tools import (
    compose_current_chapter_state,
)
from augmentedquill.services.llm.llm_request_helpers import find_model_in_list

_PROVIDERS = ("openai", "anthropic", "google")


def _normalize_model_type(model_type: str | None) -> str:
    """Normalize model_type values to supported uppercase roles."""
    if model_type is None:
        return None
    value = str(model_type).strip().upper()
    return value if value in MODEL_ROLES else None


def _resolve_stream_selected_name(
    payload: dict, machine: dict, model_type: str
) -> str | None:
    """Resolve stream selected name."""
    selected_name = (payload or {}).get("model_name")
    if selected_name:
        return selected_name

    normalized_type = _normalize_model_type(model_type)
    if normalized_type:
        for provider in _PROVIDERS:
            provider_cfg = machine.get(provider) or {}
            if not isinstance(provider_cfg, dict):
                continue
            selected_name = provider_cfg.get(f"selected_{normalized_type.lower()}")
            if selected_name:
                return selected_name

    for provider in _PROVIDERS:
        provider_cfg = machine.get(provider) or {}
        if not isinstance(provider_cfg, dict):
            continue
        selected_name = provider_cfg.get("selected")
        if selected_name:
            return selected_name
    return None


def resolve_stream_model_context(payload: dict, machine: dict) -> dict:
    """Resolve Stream Model Context."""
    openai_cfg: dict[str, Any] = machine.get("openai") or {}
    model_type = str((payload or {}).get("model_type") or "CHAT").strip().upper()
    if model_type not in ("CHAT", "WRITING", "EDITING"):
        model_type = "CHAT"
    selected_name = _resolve_stream_selected_name(payload, machine, model_type)

    base_url = (payload or {}).get("base_url")
    api_key = (payload or {}).get("api_key")
    model_id = (payload or {}).get("model")
    timeout_s = (payload or {}).get("timeout_s")

    chosen = None
    default_model = None
    for provider in _PROVIDERS:
        provider_cfg = machine.get(provider) or {}
        models = provider_cfg.get("models") if isinstance(provider_cfg, dict) else None
        if not (isinstance(models, list) and models):
            continue

        if default_model is None:
            default_model = models[0]

        if selected_name:
            found = find_model_in_list(models, selected_name)
            if found:
                chosen = found
                break

    if chosen is None:
        chosen = default_model

    if isinstance(chosen, dict):
        base_url = base_url or chosen.get("base_url")
        api_key = api_key or chosen.get("api_key")
        model_id = model_id or chosen.get("model")
        timeout_s = (
            timeout_s
            if timeout_s not in (None, "")
            else chosen.get("timeout_s", 60) or timeout_s
        )

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
    active_project_dir: Path | None = None,
) -> None:
    """Ensure System Message If Missing."""
    has_system = any(msg.get("role") == "system" for msg in req_messages)
    if has_system:
        return

    sys_msg_key = "chat_llm"
    if model_type == "WRITING":
        sys_msg_key = "story_writer"
    elif model_type == "EDITING":
        sys_msg_key = "editing_llm"

    model_overrides = load_model_prompt_overrides(machine, selected_name)
    # determine project language so that the default system message
    # is in the correct language
    project_lang = "en"
    try:
        story = (
            load_story_config((active_project_dir or Path(".")) / "story.json") or {}
        )
        project_lang = str(story.get("language", "en") or "en")
    except Exception:
        pass
    system_content = get_system_message(
        sys_msg_key, model_overrides, language=project_lang
    )
    req_messages.insert(0, {"role": "system", "content": system_content})


def _build_current_chapter_tool_call() -> dict:
    """Build the assistant tool_call message for current chapter context."""
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "current_context",
                "type": "function",
                "function": {
                    "name": "get_current_chapter_id",
                    "arguments": "{}",
                },
            }
        ],
    }


def _ensure_current_chapter_tool_call(new_history: list[dict], tool_msg: dict) -> None:
    """Ensure there is an assistant tool_call immediately before a tool response."""
    if not tool_msg or tool_msg.get("name") != "get_current_chapter_id":
        return

    current_call_id = tool_msg.get("tool_call_id") or "current_context"

    if new_history:
        prev = new_history[-1]
        if prev.get("role") == "assistant" and isinstance(prev.get("tool_calls"), list):
            for c in prev.get("tool_calls", []):
                if (
                    isinstance(c, dict)
                    and c.get("id") == current_call_id
                    and c.get("function", {}).get("name") == "get_current_chapter_id"
                ):
                    return

    new_history.append(_build_current_chapter_tool_call())


def inject_chat_user_context(
    req_messages: list[dict], payload: dict, language: str = "en"
) -> None:
    """Inject current chapter context as a virtual tool message with canonical state."""
    import copy

    state = compose_current_chapter_state(payload)
    if not state:
        # Still return deep copies to prevent side effects
        req_messages[:] = [copy.deepcopy(m) for m in req_messages]
        return

    target_content = json.dumps(state, ensure_ascii=False)

    # We rebuild the history from scratch, ensuring all messages are NEW objects.
    new_history = []

    current_seq_context: str | None = None

    # Pre-calculate to know when we are at the last user message
    user_idxs = [idx for idx, m in enumerate(req_messages) if m.get("role") == "user"]
    last_user_idx = user_idxs[-1] if user_idxs else -1
    has_any_assistant = any(m.get("role") == "assistant" for m in req_messages)

    for i, msg in enumerate(req_messages):
        # Always create a deep copy of the original message first
        msg_copy = copy.deepcopy(msg)

        # Handle context tool messages (existing ones)
        if (
            msg_copy.get("role") == "tool"
            and msg_copy.get("name") == "get_current_chapter_id"
        ):
            msg_content = msg_copy.get("content")

            # Is this the start-of-chat context tool?
            is_start_tool = True
            for prev_msg in new_history:
                if prev_msg.get("role") == "user":
                    is_start_tool = False
                    break

            # If it's a stale start tool with no assistant yet, update it and continue.
            # CRITICAL: We only do this "silent update" if the tool DOES NOT have
            # our internal 'tool_call_id'. If it has 'current_context', it was
            # explicitly injected by us to mark a turn boundary.
            if (
                is_start_tool
                and not has_any_assistant
                and msg_copy.get("tool_call_id") != "current_context"
            ):
                try:
                    if json.loads(msg_content) != json.loads(target_content):
                        msg_copy["content"] = target_content
                        # tracker matches WHAT WAS THERE ORIGINALLY (the stale value)
                        # so that is_redundant will be False for the current turn,
                        # triggering a NEW injection for the correct context.
                        current_seq_context = msg_content
                        _ensure_current_chapter_tool_call(new_history, msg_copy)
                        new_history.append(msg_copy)
                        continue
                except Exception:
                    pass

            # Otherwise, track it as the last seen context
            current_seq_context = msg_content
            _ensure_current_chapter_tool_call(new_history, msg_copy)
            new_history.append(msg_copy)
            continue

        # Handle user messages: maybe inject before user
        if msg_copy.get("role") == "user":
            is_last_user = i == last_user_idx
            is_redundant = False

            if current_seq_context:
                try:
                    if json.loads(current_seq_context) == json.loads(target_content):
                        is_redundant = True
                except Exception:
                    if current_seq_context == target_content:
                        is_redundant = True

            # Check if this turn ALREADY has this content (to avoid double-injection within one turn)
            is_turn_redundant = False
            for prev in reversed(new_history):
                if prev.get("role") in ["user", "assistant"]:
                    break
                if (
                    prev.get("role") == "tool"
                    and prev.get("name") == "get_current_chapter_id"
                ):
                    try:
                        if json.loads(prev.get("content")) == json.loads(
                            target_content
                        ):
                            is_turn_redundant = True
                        break
                    except Exception:
                        pass

            # THE FINAL LOGIC:
            # Only inject before the LAST user message.
            # Injecting before historical user messages would put the CURRENT chapter
            # context at the wrong position and with the wrong (now-active) chapter.
            # Historical turns already had their context handled in prior LLM calls.
            should_inject = False
            if is_last_user and (current_seq_context is None or not is_redundant):
                should_inject = True

            if should_inject and not is_turn_redundant:
                new_history.append(_build_current_chapter_tool_call())
                new_history.append(
                    {
                        "role": "tool",
                        "name": "get_current_chapter_id",
                        "content": target_content,
                        "tool_call_id": "current_context",
                    }
                )
                current_seq_context = target_content

        new_history.append(msg_copy)

    # 3. Swap list contents
    req_messages[:] = new_history


def resolve_story_llm_prefs(
    config_dir: Path, active_project_dir: Path | None
) -> tuple[float, Any]:
    """Resolve Story Llm Prefs."""
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

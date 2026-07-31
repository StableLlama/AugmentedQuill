# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the llm request helpers unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx


def get_story_llm_preferences(
    *,
    config_dir: Any,
    get_active_project_dir: Callable[[], Any],
    load_story_config: Callable[[Any], dict[str, Any] | None],
) -> tuple[float, int | None]:
    """Load story-level LLM preferences and normalize values."""
    story = (
        load_story_config((get_active_project_dir() or config_dir) / "story.json") or {}
    )
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = prefs.get("temperature", 0.7)
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens")
    return temperature, max_tokens


def build_headers(api_key: str | None) -> dict[str, str]:
    """Build headers."""
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def build_timeout(timeout_s: int) -> httpx.Timeout:
    """Build timeout."""
    try:
        return httpx.Timeout(float(timeout_s or 60))
    except Exception:
        return httpx.Timeout(60.0)


def find_model_in_list(models: list, selected_name: str | None) -> dict | None:
    """Return the first model config dict whose "name" matches selected_name.

    Returns None when selected_name is falsy or no match is found, signalling
    that the caller should fall back to the first available model.
    """
    if not selected_name:
        return None
    for m in models:
        if isinstance(m, dict) and m.get("name") == selected_name:
            return m
    return None


def apply_native_tool_calling_mode(
    extra_body: dict[str, Any] | None,
    *,
    supports_function_calling: bool,
    tools: list[dict] | None,
    tool_choice: str | None,
) -> dict[str, Any]:
    """Force provider request options that keep native tool calling stable.

    Some OpenAI-compatible backends switch to template-driven thinking output when
    reasoning is enabled, which can cause pseudo-tool syntax to leak into
    reasoning channels instead of returning structured tool calls.
    """
    merged = dict(extra_body or {})
    if not (supports_function_calling and tools and tool_choice != "none"):
        return merged

    # Preserve any chat template kwargs provided by the model configuration.
    # We should not override the model's own choice about whether thinking templates
    # are enabled or disabled.
    chat_template_kwargs = merged.get("chat_template_kwargs")
    if isinstance(chat_template_kwargs, dict):
        merged["chat_template_kwargs"] = dict(chat_template_kwargs)
    return merged

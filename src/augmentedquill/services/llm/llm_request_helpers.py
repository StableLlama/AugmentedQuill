# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the llm request helpers unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from typing import Any, Dict, Callable

import httpx


def get_story_llm_preferences(
    *,
    config_dir,
    get_active_project_dir: Callable[[], Any],
    load_story_config: Callable[[Any], Dict[str, Any] | None],
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


def build_headers(api_key: str | None) -> Dict[str, str]:
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def build_timeout(timeout_s: int) -> httpx.Timeout:
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

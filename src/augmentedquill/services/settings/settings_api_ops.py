# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the settings api ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from augmentedquill.core.config import load_story_config, save_story_config
from augmentedquill.services.chapters.chapter_helpers import _normalize_chapter_entry


def _to_optional_float(value: Any) -> float | None:
    """Coerce *value* to float, returning None for empty/invalid input."""
    if value in (None, ""):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _to_optional_int(value: Any) -> int | None:
    """Coerce *value* to int, returning None for empty/invalid input."""
    if value in (None, ""):
        return None
    try:
        return int(value)
    except Exception:
        return None


def build_story_cfg_from_payload(story: dict) -> dict:
    """Build a normalized story configuration payload for persistence."""
    normalized_chapters = [
        _normalize_chapter_entry(chapter) for chapter in (story.get("chapters") or [])
    ]
    return {
        "project_title": (story.get("project_title") or "Untitled Project"),
        "format": (story.get("format") or "markdown"),
        "story_summary": (story.get("story_summary") or ""),
        # tags should be an array; avoid falling back to an empty string
        # which breaks JSON schema validation.  Use an empty list if not
        # provided.
        "tags": story.get("tags") if isinstance(story.get("tags"), list) else [],
        "chapters": normalized_chapters,
        "llm_prefs": {
            "temperature": float(story.get("llm_prefs", {}).get("temperature", 0.7)),
            "max_tokens": int(story.get("llm_prefs", {}).get("max_tokens", 16384)),
        },
    }


def validate_and_fill_openai_cfg_for_settings(
    openai_cfg: dict,
) -> tuple[dict | None, str | None]:
    """Validate OpenAI model configuration and backfill selected model fields."""
    models = openai_cfg.get("models")
    selected = openai_cfg.get("selected") or ""
    selected_chat = openai_cfg.get("selected_chat") or ""
    selected_writing = openai_cfg.get("selected_writing") or ""
    selected_editing = openai_cfg.get("selected_editing") or ""

    if not (isinstance(models, list) and models):
        return None, "At least one model must be configured in openai.models[]."

    name_counts: dict[str, int] = {}
    for model in models:
        if not isinstance(model, dict):
            continue
        name = (model.get("name", "") or "").strip()
        if not name:
            return None, "Each model must have a unique, non-empty name."
        name_counts[name] = name_counts.get(name, 0) + 1

    dups = [name for name, count in name_counts.items() if count > 1]
    if dups:
        return (
            None,
            f"Duplicate model name(s) not allowed: {', '.join(sorted(set(dups)))}",
        )

    if not selected:
        selected = models[0].get("name", "") if models else ""
    if not selected_chat:
        selected_chat = selected
    if not selected_writing:
        selected_writing = selected
    if not selected_editing:
        selected_editing = selected

    openai_cfg["selected"] = selected
    openai_cfg["selected_chat"] = selected_chat
    openai_cfg["selected_writing"] = selected_writing
    openai_cfg["selected_editing"] = selected_editing
    return openai_cfg, None


def clean_machine_openai_cfg_for_put(
    openai_cfg: dict,
) -> tuple[dict | None, str | None, str | None]:
    """Sanitize and validate machine OpenAI config for PUT operations."""
    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    selected = (
        (openai_cfg.get("selected") or "") if isinstance(openai_cfg, dict) else ""
    )
    selected_chat = (
        (openai_cfg.get("selected_chat") or "") if isinstance(openai_cfg, dict) else ""
    )
    selected_writing = (
        (openai_cfg.get("selected_writing") or "")
        if isinstance(openai_cfg, dict)
        else ""
    )
    selected_editing = (
        (openai_cfg.get("selected_editing") or "")
        if isinstance(openai_cfg, dict)
        else ""
    )

    if not (isinstance(models, list) and models):
        return None, None, "At least one model must be configured in openai.models[]."

    name_counts: dict[str, int] = {}
    cleaned_models: list[dict] = []
    for model in models:
        if not isinstance(model, dict):
            continue
        name = (model.get("name") or "").strip()
        base_url = (model.get("base_url") or "").strip()
        model_id = (model.get("model") or "").strip()
        api_key = model.get("api_key")
        timeout_s = model.get("timeout_s", 60)
        context_window_tokens = model.get("context_window_tokens")
        prompt_overrides = model.get("prompt_overrides", {})

        if not name:
            return None, None, "Each model must have a unique, non-empty name."
        if not base_url:
            return None, None, f"Model '{name}' is missing base_url."
        if not model_id:
            return None, None, f"Model '{name}' is missing model."

        name_counts[name] = name_counts.get(name, 0) + 1
        try:
            timeout_s_int = int(timeout_s)
        except Exception:
            timeout_s_int = 60

        stop_value = model.get("stop")
        if isinstance(stop_value, list):
            stop_clean = [str(entry) for entry in stop_value if str(entry).strip()]
        elif isinstance(stop_value, str):
            stop_clean = [
                entry.strip() for entry in stop_value.split("\n") if entry.strip()
            ]
        else:
            stop_clean = []

        extra_body_value = model.get("extra_body")
        if extra_body_value is None:
            extra_body_clean = ""
        elif isinstance(extra_body_value, str):
            extra_body_clean = extra_body_value
        else:
            try:
                extra_body_clean = json.dumps(extra_body_value)
            except Exception:
                extra_body_clean = ""

        cleaned_models.append(
            {
                "name": name,
                "base_url": base_url,
                "api_key": api_key,
                "timeout_s": timeout_s_int,
                "context_window_tokens": _to_optional_int(context_window_tokens),
                "model": model_id,
                "temperature": _to_optional_float(model.get("temperature")),
                "top_p": _to_optional_float(model.get("top_p")),
                "max_tokens": _to_optional_int(model.get("max_tokens")),
                "presence_penalty": _to_optional_float(model.get("presence_penalty")),
                "frequency_penalty": _to_optional_float(model.get("frequency_penalty")),
                "stop": stop_clean,
                "seed": _to_optional_int(model.get("seed")),
                "top_k": _to_optional_int(model.get("top_k")),
                "min_p": _to_optional_float(model.get("min_p")),
                "extra_body": extra_body_clean,
                "preset_id": (model.get("preset_id") or None),
                "writing_warning": (model.get("writing_warning") or None),
                "is_multimodal": model.get("is_multimodal"),
                "supports_function_calling": model.get("supports_function_calling"),
                "suggest_loop_guard_enabled": bool(
                    model.get("suggest_loop_guard_enabled", True)
                ),
                "suggest_loop_guard_ngram": _to_optional_int(
                    model.get("suggest_loop_guard_ngram")
                ),
                "suggest_loop_guard_min_repeats": _to_optional_int(
                    model.get("suggest_loop_guard_min_repeats")
                ),
                "suggest_loop_guard_max_regens": _to_optional_int(
                    model.get("suggest_loop_guard_max_regens")
                ),
                "prompt_overrides": prompt_overrides,
            }
        )

    dups = [name for name, count in name_counts.items() if count > 1]
    if dups:
        return (
            None,
            None,
            f"Duplicate model name(s) not allowed: {', '.join(sorted(set(dups)))}",
        )

    if not selected or selected not in [model.get("name") for model in cleaned_models]:
        selected = cleaned_models[0].get("name", "")

    available_names = [model.get("name") for model in cleaned_models]

    if not selected_chat or selected_chat not in available_names:
        selected_chat = selected
    if not selected_writing or selected_writing not in available_names:
        selected_writing = selected
    if not selected_editing or selected_editing not in available_names:
        selected_editing = selected

    return (
        {
            "openai": {
                "models": cleaned_models,
                "selected": selected,
                "selected_chat": selected_chat,
                "selected_writing": selected_writing,
                "selected_editing": selected_editing,
            }
        },
        selected,
        None,
    )


def update_story_field(story_path: Path, field: str, value: Any) -> None:
    """Update one top-level story field and persist the story config."""
    story = load_story_config(story_path) or {}
    story[field] = value
    story_path.parent.mkdir(parents=True, exist_ok=True)
    save_story_config(story_path, story)

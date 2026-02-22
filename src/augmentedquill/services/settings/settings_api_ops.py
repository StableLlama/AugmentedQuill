# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the settings api ops unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

from pathlib import Path

from augmentedquill.core.config import load_story_config, save_story_config
from augmentedquill.services.chapters.chapter_helpers import _normalize_chapter_entry


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def build_story_cfg_from_payload(story: dict) -> dict:
    normalized_chapters = [
        _normalize_chapter_entry(chapter) for chapter in (story.get("chapters") or [])
    ]
    return {
        "project_title": (story.get("project_title") or "Untitled Project"),
        "format": (story.get("format") or "markdown"),
        "story_summary": (story.get("story_summary") or ""),
        "tags": (story.get("tags") or ""),
        "chapters": normalized_chapters,
        "llm_prefs": {
            "temperature": float(story.get("llm_prefs", {}).get("temperature", 0.7)),
            "max_tokens": int(story.get("llm_prefs", {}).get("max_tokens", 2048)),
        },
    }


def validate_and_fill_openai_cfg_for_settings(
    openai_cfg: dict,
) -> tuple[dict | None, str | None]:
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
    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    selected = (
        (openai_cfg.get("selected") or "") if isinstance(openai_cfg, dict) else ""
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

        cleaned_models.append(
            {
                "name": name,
                "base_url": base_url,
                "api_key": api_key,
                "timeout_s": timeout_s_int,
                "model": model_id,
                "is_multimodal": model.get("is_multimodal"),
                "supports_function_calling": model.get("supports_function_calling"),
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

    if not selected:
        selected = cleaned_models[0].get("name", "")
    elif selected not in [model.get("name") for model in cleaned_models]:
        selected = cleaned_models[0].get("name", "")

    return {"openai": {"models": cleaned_models, "selected": selected}}, selected, None


def update_story_field(story_path: Path, field: str, value) -> None:
    story = load_story_config(story_path) or {}
    story[field] = value
    ensure_parent_dir(story_path)
    save_story_config(story_path, story)

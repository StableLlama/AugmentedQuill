# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the story api prompt ops unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

from pathlib import Path

from augmentedquill.services.llm import llm
from augmentedquill.core.config import load_machine_config
from augmentedquill.core.prompts import (
    get_system_message,
    get_user_prompt,
    load_model_prompt_overrides,
)


def resolve_model_runtime(payload: dict, model_type: str, base_dir: Path):
    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type=model_type
    )
    machine_config = load_machine_config(base_dir / "config" / "machine.json") or {}
    selected_model_name = llm.get_selected_model_name(payload, model_type=model_type)
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)
    return base_url, api_key, model_id, timeout_s, model_overrides


def build_chapter_summary_messages(
    *, mode: str, current_summary: str, chapter_text: str, model_overrides: dict
):
    sys_msg = {
        "role": "system",
        "content": get_system_message("chapter_summarizer", model_overrides),
    }
    if mode == "discard" or not current_summary:
        user_prompt = get_user_prompt(
            "chapter_summary_new",
            chapter_text=chapter_text,
            user_prompt_overrides=model_overrides,
        )
    else:
        user_prompt = get_user_prompt(
            "chapter_summary_update",
            existing_summary=current_summary,
            chapter_text=chapter_text,
            user_prompt_overrides=model_overrides,
        )
    return [sys_msg, {"role": "user", "content": user_prompt}]


def build_story_summary_messages(
    *,
    mode: str,
    current_story_summary: str,
    chapter_summaries: list[str],
    model_overrides: dict,
):
    sys_msg = {
        "role": "system",
        "content": get_system_message("story_summarizer", model_overrides),
    }
    if mode == "discard" or not current_story_summary:
        user_prompt = get_user_prompt(
            "story_summary_new",
            chapter_summaries="\n\n".join(chapter_summaries),
            user_prompt_overrides=model_overrides,
        )
    else:
        user_prompt = get_user_prompt(
            "story_summary_update",
            existing_summary=current_story_summary,
            chapter_summaries="\n\n".join(chapter_summaries),
            user_prompt_overrides=model_overrides,
        )
    return [sys_msg, {"role": "user", "content": user_prompt}]


def build_write_chapter_messages(
    *,
    project_title: str,
    chapter_title: str,
    chapter_summary: str,
    model_overrides: dict,
):
    sys_msg = {
        "role": "system",
        "content": get_system_message("story_writer", model_overrides),
    }
    user_prompt = get_user_prompt(
        "write_chapter",
        project_title=project_title,
        chapter_title=chapter_title,
        chapter_summary=chapter_summary,
        user_prompt_overrides=model_overrides,
    )
    return [sys_msg, {"role": "user", "content": user_prompt}]


def build_continue_chapter_messages(
    *,
    chapter_title: str,
    chapter_summary: str,
    existing_text: str,
    model_overrides: dict,
):
    sys_msg = {
        "role": "system",
        "content": get_system_message("story_continuer", model_overrides),
    }
    user_prompt = get_user_prompt(
        "continue_chapter",
        chapter_title=chapter_title,
        chapter_summary=chapter_summary,
        existing_text=existing_text,
        user_prompt_overrides=model_overrides,
    )
    return [sys_msg, {"role": "user", "content": user_prompt}]


def build_suggest_prompt(
    *,
    chapter_title: str,
    chapter_summary: str,
    current_text: str,
    model_overrides: dict,
) -> str:
    return get_user_prompt(
        "suggest_continuation",
        chapter_title=chapter_title or "",
        chapter_summary=chapter_summary or "",
        current_text=current_text or "",
        user_prompt_overrides=model_overrides,
    )

# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Shared generation preparation helpers used by streaming and non-streaming story flows."""

from __future__ import annotations

from fastapi import HTTPException

from augmentedquill.core.config import BASE_DIR
from augmentedquill.services.story.story_api_prompt_ops import (
    build_chapter_summary_messages,
    build_continue_chapter_messages,
    build_story_summary_messages,
    build_write_chapter_messages,
    resolve_model_runtime,
)
from augmentedquill.services.story.story_api_state_ops import (
    collect_chapter_summaries,
    ensure_chapter_slot,
    get_active_story_or_http_error,
    get_all_normalized_chapters,
    get_chapter_locator,
    get_normalized_chapters,
    read_text_or_http_500,
)


def prepare_story_summary_generation(payload: dict, mode: str) -> dict:
    mode = (mode or "").lower()
    if mode not in ("discard", "update", ""):
        raise HTTPException(status_code=400, detail="mode must be discard|update")

    _, story_path, story = get_active_story_or_http_error()
    chapters_data = get_all_normalized_chapters(story)
    current_story_summary = story.get("story_summary", "")

    chapter_summaries = collect_chapter_summaries(chapters_data)
    if not chapter_summaries:
        raise HTTPException(status_code=400, detail="No chapter summaries available")

    base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
        payload=payload,
        model_type="EDITING",
        base_dir=BASE_DIR,
    )
    messages = build_story_summary_messages(
        mode=mode,
        current_story_summary=current_story_summary,
        chapter_summaries=chapter_summaries,
        model_overrides=model_overrides,
    )
    return {
        "story": story,
        "story_path": story_path,
        "messages": messages,
        "base_url": base_url,
        "api_key": api_key,
        "model_id": model_id,
        "timeout_s": timeout_s,
    }


def prepare_chapter_summary_generation(payload: dict, chap_id: int, mode: str) -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")

    mode = (mode or "").lower()
    if mode not in ("discard", "update", ""):
        raise HTTPException(status_code=400, detail="mode must be discard|update")

    _, path, pos = get_chapter_locator(chap_id)
    chapter_text = read_text_or_http_500(path)
    _, story_path, story = get_active_story_or_http_error()

    chapters_data = get_normalized_chapters(story)
    ensure_chapter_slot(chapters_data, pos)
    current_summary = chapters_data[pos].get("summary", "")

    base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
        payload=payload,
        model_type="EDITING",
        base_dir=BASE_DIR,
    )
    messages = build_chapter_summary_messages(
        mode=mode,
        current_summary=current_summary,
        chapter_text=chapter_text,
        model_overrides=model_overrides,
    )

    return {
        "path": path,
        "pos": pos,
        "story": story,
        "story_path": story_path,
        "chapters_data": chapters_data,
        "messages": messages,
        "base_url": base_url,
        "api_key": api_key,
        "model_id": model_id,
        "timeout_s": timeout_s,
    }


def prepare_write_chapter_generation(payload: dict, chap_id: int) -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")

    _, path, pos = get_chapter_locator(chap_id)
    _, _, story = get_active_story_or_http_error()

    chapters_data = get_normalized_chapters(story)
    if pos >= len(chapters_data):
        raise HTTPException(
            status_code=400, detail="No summary available for this chapter"
        )

    summary = chapters_data[pos].get("summary", "").strip()
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
        payload=payload,
        model_type="WRITING",
        base_dir=BASE_DIR,
    )
    messages = build_write_chapter_messages(
        project_title=story.get("project_title", "Story"),
        chapter_title=title,
        chapter_summary=summary,
        model_overrides=model_overrides,
    )

    return {
        "path": path,
        "story": story,
        "messages": messages,
        "base_url": base_url,
        "api_key": api_key,
        "model_id": model_id,
        "timeout_s": timeout_s,
    }


def prepare_continue_chapter_generation(payload: dict, chap_id: int) -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")

    _, path, pos = get_chapter_locator(chap_id)
    existing = read_text_or_http_500(path)

    _, _, story = get_active_story_or_http_error()
    chapters_data = get_normalized_chapters(story)
    if pos >= len(chapters_data):
        raise HTTPException(
            status_code=400, detail="No summary available for this chapter"
        )

    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
        payload=payload,
        model_type="WRITING",
        base_dir=BASE_DIR,
    )
    messages = build_continue_chapter_messages(
        chapter_title=title,
        chapter_summary=summary,
        existing_text=existing,
        model_overrides=model_overrides,
    )

    return {
        "path": path,
        "existing": existing,
        "messages": messages,
        "base_url": base_url,
        "api_key": api_key,
        "model_id": model_id,
        "timeout_s": timeout_s,
    }

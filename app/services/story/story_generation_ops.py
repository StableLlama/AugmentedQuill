# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the story generation ops unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

from fastapi import HTTPException

from app.core.config import BASE_DIR, save_story_config
from app.services.llm import llm
from app.services.story.story_api_prompt_ops import (
    build_chapter_summary_messages,
    build_continue_chapter_messages,
    build_story_summary_messages,
    build_write_chapter_messages,
    resolve_model_runtime,
)
from app.services.story.story_api_state_ops import (
    collect_chapter_summaries,
    ensure_chapter_slot,
    get_active_story_or_http_error,
    get_chapter_locator,
    get_normalized_chapters,
    read_text_or_http_500,
)


async def generate_story_summary(
    *, mode: str = "", payload: dict | None = None
) -> dict:
    payload = payload or {}
    mode = (mode or "").lower()
    if mode not in ("discard", "update", ""):
        raise HTTPException(status_code=400, detail="mode must be discard|update")

    _, story_path, story = get_active_story_or_http_error()
    chapters_data = get_normalized_chapters(story)
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

    data = await llm.unified_chat_complete(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    )

    new_summary = data.get("content", "")
    story["story_summary"] = new_summary
    save_story_config(story_path, story)
    return {"ok": True, "summary": new_summary}


async def generate_chapter_summary(
    *, chap_id: int, mode: str = "", payload: dict | None = None
) -> dict:
    payload = payload or {}
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

    data = await llm.unified_chat_complete(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    )

    new_summary = data.get("content", "")
    chapters_data[pos]["summary"] = new_summary
    story["chapters"] = chapters_data
    save_story_config(story_path, story)

    title_for_response = chapters_data[pos].get("title") or path.name
    return {
        "ok": True,
        "summary": new_summary,
        "chapter": {
            "id": chap_id,
            "title": title_for_response,
            "filename": path.name,
            "summary": new_summary,
        },
    }


async def write_chapter_from_summary(
    *, chap_id: int, payload: dict | None = None
) -> dict:
    payload = payload or {}
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

    data = await llm.unified_chat_complete(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    )

    content = data.get("content", "")
    path.write_text(content, encoding="utf-8")
    return {"ok": True, "content": content}


async def continue_chapter_from_summary(
    *, chap_id: int, payload: dict | None = None
) -> dict:
    payload = payload or {}
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

    data = await llm.unified_chat_complete(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    )

    appended = data.get("content", "")
    new_content = (
        existing + ("\n" if existing and not existing.endswith("\n") else "") + appended
    )
    path.write_text(new_content, encoding="utf-8")

    return {"ok": True, "appended": appended, "content": new_content}

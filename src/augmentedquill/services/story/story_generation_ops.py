# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the story generation ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from augmentedquill.core.config import save_story_config
from augmentedquill.services.llm import llm
from augmentedquill.services.story.story_api_prompt_ops import (  # noqa: F401
    resolve_model_runtime,
)
from augmentedquill.services.story.story_generation_common import (
    prepare_chapter_summary_generation,
    prepare_continue_chapter_generation,
    prepare_story_summary_generation,
    prepare_write_chapter_generation,
)


async def generate_story_summary(
    *, mode: str = "", payload: dict | None = None
) -> dict:
    """Generate Story Summary."""
    payload = payload or {}
    prepared = prepare_story_summary_generation(payload, mode)

    data = await llm.unified_chat_complete(
        messages=prepared["messages"],
        base_url=prepared["base_url"],
        api_key=prepared["api_key"],
        model_id=prepared["model_id"],
        timeout_s=prepared["timeout_s"],
    )

    new_summary = data.get("content", "")
    prepared["story"]["story_summary"] = new_summary
    save_story_config(prepared["story_path"], prepared["story"])
    return {"ok": True, "summary": new_summary}


async def generate_chapter_summary(
    *, chap_id: int, mode: str = "", payload: dict | None = None
) -> dict:
    """Generate Chapter Summary."""
    payload = payload or {}
    prepared = prepare_chapter_summary_generation(payload, chap_id, mode)

    data = await llm.unified_chat_complete(
        messages=prepared["messages"],
        base_url=prepared["base_url"],
        api_key=prepared["api_key"],
        model_id=prepared["model_id"],
        timeout_s=prepared["timeout_s"],
    )

    new_summary = data.get("content", "")
    prepared["chapters_data"][prepared["pos"]]["summary"] = new_summary
    prepared["story"]["chapters"] = prepared["chapters_data"]
    save_story_config(prepared["story_path"], prepared["story"])

    title_for_response = (
        prepared["chapters_data"][prepared["pos"]].get("title") or prepared["path"].name
    )
    return {
        "ok": True,
        "summary": new_summary,
        "chapter": {
            "id": chap_id,
            "title": title_for_response,
            "filename": prepared["path"].name,
            "summary": new_summary,
        },
    }


async def write_chapter_from_summary(
    *, chap_id: int, payload: dict | None = None
) -> dict:
    """Write Chapter From Summary."""
    payload = payload or {}
    prepared = prepare_write_chapter_generation(payload, chap_id)

    data = await llm.unified_chat_complete(
        messages=prepared["messages"],
        base_url=prepared["base_url"],
        api_key=prepared["api_key"],
        model_id=prepared["model_id"],
        timeout_s=prepared["timeout_s"],
    )

    content = data.get("content", "")
    prepared["path"].write_text(content, encoding="utf-8")
    return {"ok": True, "content": content}


async def continue_chapter_from_summary(
    *, chap_id: int, payload: dict | None = None
) -> dict:
    """Continue Chapter From Summary."""
    payload = payload or {}
    prepared = prepare_continue_chapter_generation(payload, chap_id)

    data = await llm.unified_chat_complete(
        messages=prepared["messages"],
        base_url=prepared["base_url"],
        api_key=prepared["api_key"],
        model_id=prepared["model_id"],
        timeout_s=prepared["timeout_s"],
    )

    appended = data.get("content", "")
    new_content = (
        prepared["existing"]
        + (
            "\n"
            if prepared["existing"] and not prepared["existing"].endswith("\n")
            else ""
        )
        + appended
    )
    prepared["path"].write_text(new_content, encoding="utf-8")

    return {"ok": True, "appended": appended, "content": new_content}

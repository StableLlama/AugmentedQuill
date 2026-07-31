# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the story generation ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import json
from pathlib import Path

from augmentedquill.core.config import save_story_config
from augmentedquill.services.chat.chat_tool_decorator import (
    EDITING_ROLE,
    execute_registered_tool,
    tool_message,
)
from augmentedquill.services.llm import llm
from augmentedquill.services.scenes.scene_generation_service import (
    auto_link_chapter_generation,
)
from augmentedquill.services.story.story_api_prompt_ops import (  # noqa: F401
    resolve_model_runtime,
)
from augmentedquill.services.story.story_generation_common import (
    prepare_chapter_summary_generation,
    prepare_continue_chapter_generation,
    prepare_story_summary_generation,
    prepare_write_chapter_generation,
)


async def _complete_with_tool_calls(
    *,
    caller_id: str,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None = None,
    model_type: str | None = None,
    tools: list[dict] | None = None,
    max_rounds: int = 4,
) -> dict:
    """Execute native tool calls and return the final assistant response."""
    current_messages = [dict(m) for m in messages]
    for _ in range(max_rounds):
        response = await llm.unified_chat_complete(
            caller_id=caller_id,
            model_type=model_type,
            messages=current_messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
            model_name=model_name,
            tools=tools,
        )

        tool_calls = response.get("tool_calls", []) or []
        if not tool_calls:
            return response

        assistant_msg = {"role": "assistant"}
        if response.get("content"):
            assistant_msg["content"] = response["content"]
        assistant_msg["tool_calls"] = tool_calls
        current_messages.append(assistant_msg)

        for tcall in tool_calls:
            func = tcall.get("function", {})
            name = func.get("name")
            arguments = func.get("arguments", "{}")
            if isinstance(arguments, str):
                try:
                    args_obj = json.loads(arguments)
                except Exception:
                    args_obj = {}
            elif isinstance(arguments, dict):
                args_obj = arguments
            else:
                args_obj = {}

            tool_response = await execute_registered_tool(
                name,
                args_obj,
                tcall.get("id") or "",
                {"_tool_role": EDITING_ROLE},
                {},
                tool_role=EDITING_ROLE,
            )
            if "role" not in tool_response:
                tool_response = tool_message(name, tcall.get("id") or "", tool_response)
            current_messages.append(tool_response)

    return response


async def generate_story_summary(
    *, mode: str = "", payload: dict | None = None, active: Path | None = None
) -> dict:
    """Generate Story Summary."""
    payload = payload or {}
    prepared = prepare_story_summary_generation(payload, mode, active=active)

    # When rewriting an existing summary, clear the current story summary first.
    # This avoids a race where the model calls tools like get_project_overview
    # and receives the stale summary that should be rewritten.
    backup_summary = None
    if mode.lower() == "discard":
        backup_summary = prepared["story"].get("story_summary", "")
        prepared["story"]["story_summary"] = ""
        save_story_config(prepared["story_path"], prepared["story"])

    try:
        data = await _complete_with_tool_calls(
            caller_id="story_generation.generate_story_summary",
            messages=prepared["messages"],
            base_url=prepared["base_url"],
            api_key=prepared["api_key"],
            model_id=prepared["model_id"],
            timeout_s=prepared["timeout_s"],
            model_name=prepared.get("model_name"),
            model_type=prepared.get("model_type"),
            tools=prepared.get("tools"),
        )
    except Exception:
        if mode.lower() == "discard":
            prepared["story"]["story_summary"] = backup_summary or ""
            save_story_config(prepared["story_path"], prepared["story"])
        raise

    new_summary = data.get("content", "")
    prepared["story"]["story_summary"] = new_summary
    save_story_config(prepared["story_path"], prepared["story"])
    return {"ok": True, "summary": new_summary}


async def generate_chapter_summary(
    *,
    chap_id: int,
    mode: str = "",
    payload: dict | None = None,
    active: Path | None = None,
) -> dict:
    """Generate Chapter Summary."""
    payload = payload or {}
    prepared = prepare_chapter_summary_generation(payload, chap_id, mode, active=active)

    backup_summary = None
    if mode.lower() == "discard":
        backup_summary = prepared["chapters_data"][prepared["pos"]].get("summary", "")
        prepared["chapters_data"][prepared["pos"]]["summary"] = ""
        prepared["story"]["chapters"] = prepared["chapters_data"]
        save_story_config(prepared["story_path"], prepared["story"])

    try:
        data = await _complete_with_tool_calls(
            caller_id="story_generation.generate_chapter_summary",
            messages=prepared["messages"],
            base_url=prepared["base_url"],
            api_key=prepared["api_key"],
            model_id=prepared["model_id"],
            timeout_s=prepared["timeout_s"],
            model_name=prepared.get("model_name"),
            model_type=prepared.get("model_type"),
            tools=prepared.get("tools"),
        )
    except Exception:
        if mode.lower() == "discard":
            prepared["chapters_data"][prepared["pos"]]["summary"] = backup_summary or ""
            prepared["story"]["chapters"] = prepared["chapters_data"]
            save_story_config(prepared["story_path"], prepared["story"])
        raise

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
    *, chap_id: int, payload: dict | None = None, active: Path | None = None
) -> dict:
    """Write Chapter From Summary."""
    payload = payload or {}
    prepared = prepare_write_chapter_generation(payload, chap_id, active=active)

    data = await llm.unified_chat_complete(
        caller_id="story_generation.write_chapter_from_summary",
        model_type=prepared.get("model_type"),
        messages=prepared["messages"],
        base_url=prepared["base_url"],
        api_key=prepared["api_key"],
        model_id=prepared["model_id"],
        timeout_s=prepared["timeout_s"],
        model_name=prepared.get("model_name"),
    )

    content = data.get("content", "")
    prepared["path"].write_text(content, encoding="utf-8")

    try:
        await auto_link_chapter_generation(
            project_dir=active or prepared["path"].parent.parent,
            chap_id=chap_id,
            start_offset=0,
            end_offset=len(content),
            payload=payload,
        )
    except Exception:
        # Scene linking should not block prose generation when linking fails.
        pass

    return {"ok": True, "content": content}


async def continue_chapter_from_summary(
    *, chap_id: int, payload: dict | None = None, active: Path | None = None
) -> dict:
    """Continue Chapter From Summary."""
    payload = payload or {}
    prepared = prepare_continue_chapter_generation(payload, chap_id, active=active)

    data = await llm.unified_chat_complete(
        caller_id="story_generation.continue_chapter_from_summary",
        model_type=prepared.get("model_type"),
        messages=prepared["messages"],
        base_url=prepared["base_url"],
        api_key=prepared["api_key"],
        model_id=prepared["model_id"],
        timeout_s=prepared["timeout_s"],
        model_name=prepared.get("model_name"),
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

    try:
        append_start = len(new_content) - len(appended)
        await auto_link_chapter_generation(
            project_dir=active or prepared["path"].parent.parent,
            chap_id=chap_id,
            start_offset=max(0, append_start),
            end_offset=len(new_content),
            payload=payload,
        )
    except Exception:
        # Scene linking should not block prose generation when linking fails.
        pass

    return {"ok": True, "appended": appended, "content": new_content}

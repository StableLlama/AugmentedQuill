# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

from pathlib import Path
from fastapi import HTTPException

from app.projects import get_active_project_dir
from app.config import load_story_config
from app import llm as _llm
from app.prompts import get_system_message, get_user_prompt, load_model_prompt_overrides
from app.config import load_machine_config
from .chapter_helpers import (
    _chapter_by_id_or_404,
    _get_chapter_metadata_entry,
)


async def _story_generate_summary_helper(*, chap_id: int, mode: str = "") -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")

    _, path, pos = _chapter_by_id_or_404(chap_id)
    try:
        chapter_text = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    target_entry = _get_chapter_metadata_entry(story, chap_id, path)
    current_summary = target_entry.get("summary", "") if target_entry else ""

    base_url, api_key, model_id, timeout_s = _llm.resolve_openai_credentials(
        {}, model_type="EDITING"
    )

    # Load model-specific prompt overrides
    machine_config = (
        load_machine_config(
            Path(__file__).resolve().parent.parent.parent / "config" / "machine.json"
        )
        or {}
    )
    openai_cfg = machine_config.get("openai", {})
    selected_model_name = openai_cfg.get("selected_editing") or openai_cfg.get(
        "selected"
    )
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("chapter_summarizer", model_overrides),
    }
    mode_l = (mode or "").lower()
    if mode_l == "discard" or not current_summary:
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
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    data = await _llm.openai_chat_complete(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    )
    choices = (data or {}).get("choices") or []
    new_summary = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            new_summary = msg.get("content", "") or ""
            new_summary = _llm.strip_thinking_tags(new_summary)

    if target_entry is not None:
        target_entry["summary"] = new_summary

    from app.config import save_story_config

    save_story_config(story_path, story)
    title_for_response = (
        target_entry.get("title") if target_entry else None
    ) or path.name
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


async def _story_write_helper(*, chap_id: int) -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = _chapter_by_id_or_404(chap_id)
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    target_entry = _get_chapter_metadata_entry(story, chap_id, path)
    summary = target_entry.get("summary", "") if target_entry else ""

    base_url, api_key, model_id, timeout_s = _llm.resolve_openai_credentials(
        {}, model_type="WRITING"
    )

    # Load model-specific prompt overrides
    machine_config = (
        load_machine_config(
            Path(__file__).resolve().parent.parent.parent / "config" / "machine.json"
        )
        or {}
    )
    openai_cfg = machine_config.get("openai", {})
    selected_model_name = openai_cfg.get("selected_writing") or openai_cfg.get(
        "selected"
    )
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("story_writer", model_overrides),
    }
    user_prompt = get_user_prompt(
        "write_chapter",
        project_title=story.get("project_title") or "",
        chapter_summary=summary,
        user_prompt_overrides=model_overrides,
    )
    data = await _llm.openai_chat_complete(
        messages=[sys_msg, {"role": "user", "content": user_prompt}],
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    )
    choices = (data or {}).get("choices") or []
    content = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            content = msg.get("content", "") or ""
            content = _llm.strip_thinking_tags(content)
    path.write_text(content, encoding="utf-8")
    return {
        "ok": True,
        "content": content,
        "chapter": {"id": idx, "filename": path.name},
    }


async def _story_continue_helper(*, chap_id: int) -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = _chapter_by_id_or_404(chap_id)
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    target_entry = _get_chapter_metadata_entry(story, chap_id, path)
    summary = target_entry.get("summary", "") if target_entry else ""
    current = path.read_text(encoding="utf-8") if path.exists() else ""

    base_url, api_key, model_id, timeout_s = _llm.resolve_openai_credentials(
        {}, model_type="WRITING"
    )

    # Load model-specific prompt overrides
    machine_config = (
        load_machine_config(
            Path(__file__).resolve().parent.parent.parent / "config" / "machine.json"
        )
        or {}
    )
    openai_cfg = machine_config.get("openai", {})
    selected_model_name = openai_cfg.get("selected_writing") or openai_cfg.get(
        "selected"
    )
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("story_continuer", model_overrides),
    }
    user_prompt = get_user_prompt(
        "continue_chapter",
        chapter_summary=summary,
        existing_text=current,
        user_prompt_overrides=model_overrides,
    )
    data = await _llm.openai_chat_complete(
        messages=[sys_msg, {"role": "user", "content": user_prompt}],
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    )
    choices = (data or {}).get("choices") or []
    add = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            add = msg.get("content", "") or ""
            add = _llm.strip_thinking_tags(add)
    new_content = (
        current + ("\n\n" if current and not current.endswith("\n\n") else "") + add
    ).strip("\n") + "\n"
    path.write_text(new_content, encoding="utf-8")
    return {"ok": True, "appended": add, "chapter": {"id": idx, "filename": path.name}}


async def _story_generate_story_summary_helper(*, mode: str = "") -> dict:
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    from app.helpers.project_helpers import _project_overview

    ov = _project_overview()
    p_type = ov.get("project_type", "novel")

    all_chapters = []
    if p_type == "series":
        for book in ov.get("books", []):
            all_chapters.extend(book.get("chapters", []))
    else:
        all_chapters = ov.get("chapters", [])

    current_story_summary = story.get("story_summary", "")

    # Collect all chapter summaries
    chapter_summaries = []
    for chapter in all_chapters:
        summary = chapter.get("summary", "").strip()
        title = chapter.get("title", "").strip() or f"Chapter {chapter.get('id')}"
        if summary:
            chapter_summaries.append(f"{title}:\n{summary}")

    if not chapter_summaries:
        raise HTTPException(status_code=400, detail="No chapter summaries available")

    base_url, api_key, model_id, timeout_s = _llm.resolve_openai_credentials(
        {}, model_type="EDITING"
    )

    # Load model-specific prompt overrides
    machine_config = (
        load_machine_config(
            Path(__file__).resolve().parent.parent.parent / "config" / "machine.json"
        )
        or {}
    )
    openai_cfg = machine_config.get("openai", {})
    selected_model_name = openai_cfg.get("selected_editing") or openai_cfg.get(
        "selected"
    )
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("story_summarizer", model_overrides),
    }
    mode_l = (mode or "").lower()
    if mode_l == "discard" or not current_story_summary:
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
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    data = await _llm.openai_chat_complete(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    )
    choices = (data or {}).get("choices") or []
    new_summary = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            new_summary = msg.get("content", "") or ""
            new_summary = _llm.strip_thinking_tags(new_summary)

    story["story_summary"] = new_summary
    from app.config import save_story_config

    save_story_config(story_path, story)
    return {"ok": True, "summary": new_summary}

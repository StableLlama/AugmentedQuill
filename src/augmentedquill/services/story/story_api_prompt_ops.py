# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the story api prompt ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from typing import Any
from pathlib import Path

from augmentedquill.services.llm import llm
from augmentedquill.core.config import load_machine_config
from augmentedquill.core.prompts import (
    get_system_message,
    get_user_prompt,
    load_model_prompt_overrides,
)
from augmentedquill.services.chat.chat_tool_decorator import (
    EDITING_ROLE,
    get_tool_schemas,
)


def _ensure_tools_loaded() -> Any:
    """Force load tool modules to ensure they are registered without causing circular imports at module level."""
    # We import here to avoid circular dependencies with story_generation_ops which imports us
    import augmentedquill.services.chat.chat_tools.chapter_tools  # noqa: F401
    import augmentedquill.services.chat.chat_tools.story_tools  # noqa: F401
    import augmentedquill.services.chat.chat_tools.project_tools  # noqa: F401
    import augmentedquill.services.chat.chat_tools.sourcebook_tools  # noqa: F401


def _get_read_only_tool_schemas(project_type: str | None = None) -> list[dict]:
    """Return a filtered tool schema list with only read-only story/chapter context tools."""
    tools = get_tool_schemas(EDITING_ROLE, project_type=project_type) or []
    relevant_names = {
        "manage_project",
        "manage_story_core",
        "get_chapter_metadata",
        "get_chapter_content",
        "get_chapter_summary",
        "get_chapter_summaries",
        "search_and_replace",
        "manage_sourcebook",
    }
    return [t for t in tools if t.get("function", {}).get("name") in relevant_names]


def resolve_model_runtime(payload: dict, model_type: str, base_dir: Path) -> Any:
    """Resolve runtime model credentials and prompt overrides for a request."""
    base_url, api_key, model_id, timeout_s, model_name = llm.resolve_openai_credentials(
        payload, model_type=model_type
    )
    machine_config = load_machine_config(base_dir / "config" / "machine.json") or {}
    # model_name returned from resolve_openai_credentials is the selected name!
    model_overrides = load_model_prompt_overrides(machine_config, model_name)
    return (
        base_url,
        api_key,
        model_id,
        timeout_s,
        model_name,
        model_overrides,
        model_type,
    )


def _build_messages(
    *,
    system_message_key: str,
    user_prompt_key: str,
    model_overrides: dict,
    language: str | None = None,
    **prompt_kwargs: Any,
) -> list[dict[str, str]]:
    """Build a two-message system/user prompt pair for story generation flows.

    ``language`` is the story/project language code and is forwarded to the
    prompt helpers.
    """
    sys_msg = {
        "role": "system",
        "content": get_system_message(
            system_message_key, model_overrides, language=language, **prompt_kwargs
        ),
    }
    user_prompt = get_user_prompt(
        user_prompt_key,
        language=language,
        user_prompt_overrides=model_overrides,
        **prompt_kwargs,
    )
    return [sys_msg, {"role": "user", "content": user_prompt}]


def build_chapter_summary_messages(
    *,
    mode: str,
    current_summary: str,
    chapter_text: str,
    content_label: str,
    model_overrides: dict,
    story_summary: str | None = None,
    story_tags: str = "",
    language: str | None = None,
    project_type: str | None = None,
) -> Any:
    """Build messages for creating or updating a chapter summary."""
    _ensure_tools_loaded()
    sys_parts = [
        get_system_message("chapter_summarizer", model_overrides, language=language)
    ]

    if story_summary:
        sys_parts.append(
            get_system_message(
                "story_context_block",
                model_overrides,
                language=language,
                story_summary=story_summary,
                story_tags=story_tags,
            )
        )

    tools = _get_read_only_tool_schemas(project_type=project_type)
    if tools:
        tool_lines: list[str] = []
        for t in tools:
            fn = t.get("function", {}).get("name")
            if not fn:
                continue
            desc = t.get("function", {}).get("description", "")
            if desc:
                tool_lines.append(f"- {fn}: {desc}")
            else:
                tool_lines.append(f"- {fn}")
        tools_list = "\n".join(tool_lines)

        sys_parts.append(
            get_system_message(
                "tool_instruction_block",
                model_overrides,
                language=language,
                tools_list=tools_list,
            )
        )

    sys_msg = {
        "role": "system",
        "content": "\n\n".join(part for part in sys_parts if part),
    }
    if mode == "discard" or not current_summary:
        user_prompt = get_user_prompt(
            "chapter_summary_new",
            language=language,
            content_label=content_label,
            chapter_text=chapter_text,
            user_prompt_overrides=model_overrides,
        )
    else:
        user_prompt = get_user_prompt(
            "chapter_summary_update",
            language=language,
            content_label=content_label,
            existing_summary=current_summary,
            chapter_text=chapter_text,
            user_prompt_overrides=model_overrides,
        )
    return [sys_msg, {"role": "user", "content": user_prompt}]


def build_story_summary_messages(
    *,
    mode: str,
    current_story_summary: str,
    source_summaries: list[str],
    summary_heading: str,
    model_overrides: dict,
    language: str | None = None,
    project_type: str | None = None,
) -> Any:
    """Build messages for creating or updating a story-level summary."""
    sys_parts = [
        get_system_message("story_summarizer", model_overrides, language=language)
    ]

    tools = _get_read_only_tool_schemas(project_type=project_type)
    if tools:
        tool_lines: list[str] = []
        for t in tools:
            fn = t.get("function", {}).get("name")
            if not fn:
                continue
            desc = t.get("function", {}).get("description", "")
            if desc:
                tool_lines.append(f"- {fn}: {desc}")
            else:
                tool_lines.append(f"- {fn}")
        tools_list = "\n".join(tool_lines)

        sys_parts.append(
            get_system_message(
                "tool_instruction_block",
                model_overrides,
                language=language,
                tools_list=tools_list,
            )
        )

    sys_msg = {
        "role": "system",
        "content": "\n\n".join(sys_parts),
    }
    if mode == "discard" or not current_story_summary:
        user_prompt = get_user_prompt(
            "story_summary_new",
            language=language,
            summary_heading=summary_heading,
            source_summaries="\n\n".join(source_summaries),
            user_prompt_overrides=model_overrides,
        )
    else:
        user_prompt = get_user_prompt(
            "story_summary_update",
            language=language,
            existing_summary=current_story_summary,
            summary_heading=summary_heading,
            source_summaries="\n\n".join(source_summaries),
            user_prompt_overrides=model_overrides,
        )
    return [sys_msg, {"role": "user", "content": user_prompt}]


def build_write_chapter_messages(
    *,
    project_type_label: str,
    story_title: str,
    story_summary: str,
    story_tags: str,
    background: str,
    chapter_title: str,
    chapter_summary: str,
    chapter_conflicts: str,
    chapter_notes: str,
    model_overrides: dict,
    language: str | None = None,
) -> Any:
    """Build messages for first-pass chapter drafting."""
    return _build_messages(
        system_message_key="story_writer",
        user_prompt_key="write_chapter",
        model_overrides=model_overrides,
        language=language,
        project_type_label=project_type_label,
        story_title=story_title,
        story_summary=story_summary,
        story_tags=story_tags,
        background=background,
        chapter_title=chapter_title,
        chapter_summary=chapter_summary,
        chapter_conflicts=chapter_conflicts,
        chapter_notes=chapter_notes,
    )


def build_continue_chapter_messages(
    *,
    project_type_label: str,
    story_title: str,
    story_summary: str,
    story_tags: str,
    background: str,
    chapter_title: str,
    chapter_summary: str,
    chapter_conflicts: str,
    chapter_notes: str,
    existing_text: str,
    model_overrides: dict,
    language: str | None = None,
) -> Any:
    """Build messages for continuing an existing chapter draft."""
    return _build_messages(
        system_message_key="story_continuer",
        user_prompt_key="continue_chapter",
        model_overrides=model_overrides,
        language=language,
        project_type_label=project_type_label,
        story_title=story_title,
        story_summary=story_summary,
        story_tags=story_tags,
        background=background,
        chapter_title=chapter_title,
        chapter_summary=chapter_summary,
        chapter_conflicts=chapter_conflicts,
        chapter_notes=chapter_notes,
        existing_text=existing_text,
    )


def build_ai_action_messages(
    *,
    target: str,
    action: str,
    project_type_label: str,
    story_title: str,
    story_summary: str,
    story_tags: str,
    background: str = "",
    chapter_title: str,
    chapter_summary: str,
    chapter_conflicts: str,
    chapter_notes: str = "",
    existing_content: str,
    chapter_summaries: str = "",
    style_tags: str = "",
    content_label: str | None = None,
    model_overrides: dict,
    language: str | None = None,
    project_type: str | None = None,
) -> Any:
    """Build messages for generic AI Actions (Extend/Rewrite/Summary)."""
    _ensure_tools_loaded()
    # Map target/action to prompt keys
    if target == "summary":
        # 'write' is used for generating a new summary (empty or missing existing summary)
        # 'rewrite' is used for rewriting an existing summary.
        if action in ("write", "rewrite"):
            sys_key = "ai_action_summary_rewrite"
            user_key = "chapter_summary_new"
        else:
            sys_key = "ai_action_summary_update"
            user_key = "chapter_summary_update"
    elif target == "book_summary":
        sys_key = "ai_action_summary_rewrite"
        user_key = (
            "story_summary_new"
            if action in ("write", "rewrite")
            else "story_summary_update"
        )
    elif target == "story_summary":
        sys_key = "ai_action_summary_rewrite"
        if project_type == "short-story":
            # Short-story has no chapters; use the story draft text as the source
            # (same template family as chapter summaries, with chapter_text = story draft).
            user_key = (
                "chapter_summary_new"
                if action in ("write", "rewrite")
                else "chapter_summary_update"
            )
        else:
            # Novel/series: source material is chapter or book summaries.
            user_key = (
                "story_summary_new"
                if action in ("write", "rewrite")
                else "story_summary_update"
            )
    else:
        # Keep chapter Extend/Rewrite on the same continuation-style prompt path.
        if action in ("extend", "rewrite"):
            sys_key = "ai_action_chapter_extend"
            user_key = "chapter_ai_prefill_task"
        else:
            sys_key = f"ai_action_chapter_{action}"
            user_key = f"ai_action_chapter_{action}_user"

    # Additional placeholders for EDITING tasks
    story_context = ""
    tool_instructions = ""
    if target in ("summary", "story_summary", "book_summary"):
        if story_summary:
            story_context = get_system_message(
                "story_context_block",
                model_overrides,
                language=language,
                story_summary=story_summary,
                story_tags=story_tags,
            )

        tools = _get_read_only_tool_schemas(project_type=project_type)
        if tools:
            tool_lines: list[str] = []
            for t in tools:
                fn = t.get("function", {}).get("name")
                if not fn:
                    continue
                desc = t.get("function", {}).get("description", "")
                if desc:
                    tool_lines.append(f"- {fn}: {desc}")
                else:
                    tool_lines.append(f"- {fn}")

            tools_list = "\n".join(tool_lines)

            tool_instructions = get_system_message(
                "tool_instruction_block",
                model_overrides,
                language=language,
                tools_list=tools_list,
            )

    # Prefer a localized label for the provided text when available.
    if content_label is None:
        content_label = get_system_message(
            "chapter_text_label",
            model_overrides,
            language=language,
        )

    # Heading and canonical source alias used by story/book-level summary templates.
    if target == "book_summary":
        summary_heading = get_system_message(
            "chapter_summaries_label", model_overrides, language=language
        )
    elif target == "story_summary":
        label_key = (
            "book_summaries_label"
            if project_type == "series"
            else "chapter_summaries_label"
        )
        summary_heading = get_system_message(
            label_key, model_overrides, language=language
        )
    else:
        summary_heading = ""

    existing_text_section = (
        f"Existing draft text (do not change):\n\n{existing_content}"
        if existing_content
        else ""
    )
    return _build_messages(
        system_message_key=sys_key,
        user_prompt_key=user_key,
        model_overrides=model_overrides,
        language=language,
        project_type_label=project_type_label,
        story_title=story_title,
        story_summary=story_summary,
        story_tags=story_tags,
        chapter_title=chapter_title,
        chapter_summary=chapter_summary,
        chapter_conflicts=chapter_conflicts,
        chapter_notes=chapter_notes,
        existing_content=existing_content,
        chapter_text=existing_content,
        existing_text=existing_content,
        existing_text_section=existing_text_section,
        existing_summary=chapter_summary,
        chapter_summaries=chapter_summaries,
        source_summaries=chapter_summaries,
        summary_heading=summary_heading,
        style_tags=style_tags,
        content_label=content_label,
        background=background,
        story_context=story_context,
        tool_instructions=tool_instructions,
    )

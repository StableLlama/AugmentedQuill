# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chapter prose tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import calendar
import json
import re
from datetime import UTC, datetime
from typing import Any

from pydantic import AliasChoices, Field

from augmentedquill.core.config import load_story_config
from augmentedquill.core.prompts import get_user_prompt
from augmentedquill.services.chapters.chapter_helpers import _chapter_by_id_or_404
from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    ToolModel,
    chat_tool,
)
from augmentedquill.services.chat.chat_tools.chapter_tools import MARKER
from augmentedquill.services.projects.projects import (
    get_active_project_dir,
)
from augmentedquill.services.projects.projects import (
    write_chapter_content as _write_chapter_content,
)
from augmentedquill.services.scenes.scene_markers import strip_internal_markers
from augmentedquill.utils.json_repair import apply_typographic_quotes

_BRACKET_TOKEN_RE = re.compile(r"\[[^\]]+\]")


def _current_utc_datetime() -> datetime:
    return datetime.now(UTC)


def _parse_origin_datetime(origin_date: str) -> datetime | None:
    cleaned = _BRACKET_TOKEN_RE.sub("", origin_date.strip())
    if not cleaned:
        return None
    if "T" not in cleaned:
        cleaned = f"{cleaned}T00:00:00+00:00"
    elif cleaned.endswith("Z"):
        cleaned = f"{cleaned[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _replace_year_safe(value: datetime, year: int) -> datetime:
    if value.month == 2 and value.day == 29 and not calendar.isleap(year):
        return value.replace(year=year, day=28)
    return value.replace(year=year)


def _add_months_safe(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    target_year = value.year + month_index // 12
    target_month = month_index % 12 + 1
    max_day = calendar.monthrange(target_year, target_month)[1]
    return value.replace(
        year=target_year, month=target_month, day=min(value.day, max_day)
    )


def _format_age_text(origin_dt: datetime, reference_dt: datetime) -> str | None:
    if origin_dt > reference_dt:
        return None

    years = reference_dt.year - origin_dt.year
    anniversary = _replace_year_safe(origin_dt, origin_dt.year + years)
    if anniversary > reference_dt:
        years -= 1
        anniversary = _replace_year_safe(origin_dt, origin_dt.year + years)

    months = 0
    cursor = anniversary
    while True:
        next_cursor = _add_months_safe(cursor, 1)
        if next_cursor <= reference_dt:
            months += 1
            cursor = next_cursor
            continue
        break

    days = (reference_dt.date() - cursor.date()).days

    if years >= 3:
        return f"{years} years old"
    if years >= 1:
        month_unit = "month" if months == 1 else "months"
        return f"{years} years and {months} {month_unit} old"
    if months >= 1:
        day_unit = "day" if days == 1 else "days"
        return f"{months} months and {days} {day_unit} old"
    day_unit = "day" if days == 1 else "days"
    return f"{days} {day_unit} old"


def _format_sourcebook_entry_age_prompt(entry: dict, language: str) -> str:
    origin_date = str(entry.get("origin_date") or "").strip()
    if not origin_date:
        return ""

    origin_dt = _parse_origin_datetime(origin_date)
    if not origin_dt:
        return ""

    reference_dt = _current_utc_datetime()
    age_text = _format_age_text(origin_dt, reference_dt)
    if not age_text:
        return ""

    return get_user_prompt(
        "sourcebook_entry_age",
        language=language,
        age_text=age_text,
        as_of_date=reference_dt.date().isoformat(),
    )


def _count_leading_newlines(text: str) -> int:
    count = 0
    for char in text:
        if char != "\n":
            break
        count += 1
    return count


def _join_appended_prose(existing: str, generated_text: str) -> str:
    if not generated_text:
        return existing

    leading_nl = _count_leading_newlines(generated_text)
    if leading_nl >= 2:
        body = generated_text.lstrip("\n")
        return existing.rstrip("\n") + "\n\n" + body

    if leading_nl == 1:
        body = generated_text.lstrip("\n")
        return existing.rstrip("\n") + "\n" + body

    prefix = existing.rstrip("\n")
    if (
        prefix
        and not prefix[-1].isspace()
        and not generated_text.startswith((" ", "\t", "\n"))
    ):
        return prefix + " " + generated_text
    return prefix + generated_text


def _extract_tail_paragraphs(text: str, max_paragraphs: int = 3) -> str:
    """Return the last few paragraphs used as append anchoring context."""
    stripped = text.strip()
    if not stripped:
        return ""

    paragraphs = [p.strip() for p in stripped.split("\n\n") if p.strip()]
    if not paragraphs:
        return stripped

    return "\n\n".join(paragraphs[-max_paragraphs:])


def _format_sourcebook_entry_prompt(entry: dict, language: str) -> str:
    """Format a sourcebook entry compactly for the WRITING LLM prompt."""
    name = entry.get("name", "")
    category = entry.get("category") or get_user_prompt(
        "sourcebook_entry_unknown_category", language=language
    )
    description = entry.get("description", "").strip()
    if not description:
        description = get_user_prompt(
            "sourcebook_entry_missing_description",
            language=language,
        )

    relations = entry.get("relations") or []
    relation_lines: list[str] = []
    for relation in relations:
        relation_type = relation.get("relation", "")
        target_id = relation.get("target_id", "")
        direction = relation.get("direction", "forward")
        if relation_type and target_id:
            relation_lines.append(f"{relation_type} ({direction}) -> {target_id}")
    relation_text = (
        "; ".join(relation_lines)
        if relation_lines
        else get_user_prompt(
            "sourcebook_entry_relations_none",
            language=language,
        )
    )

    summary = get_user_prompt(
        "sourcebook_entry_summary",
        language=language,
        name=name,
        category=category,
        description=description,
    )
    age_line = _format_sourcebook_entry_age_prompt(entry, language=language)
    relations_line = get_user_prompt(
        "sourcebook_entry_relations",
        language=language,
        relation_text=relation_text,
    )

    parts = [summary]
    if age_line:
        parts.append(age_line)
    parts.append(relations_line)
    return "\n".join(parts)


def _build_sourcebook_entries_context(entry_names: list[str], language: str) -> str:
    """Build a compact sourcebook context block for the writing prompt."""
    from augmentedquill.services.sourcebook.sourcebook_helpers import (
        sourcebook_get_entry,
    )

    seen_ids: set[str] = set()
    lines: list[str] = []
    for name_or_synonym in entry_names:
        if not isinstance(name_or_synonym, str) or not name_or_synonym.strip():
            continue
        entry = sourcebook_get_entry(name_or_synonym)
        if not entry:
            continue
        entry_id = str(entry.get("id") or "")
        if entry_id in seen_ids:
            continue
        seen_ids.add(entry_id)
        lines.append(_format_sourcebook_entry_prompt(entry, language=language))

    if not lines:
        return ""

    return (
        get_user_prompt("sourcebook_entries_block", language=language)
        + "\n"
        + "\n".join(lines)
    )


# ============================================================================
# call_writing_llm
# ============================================================================


class CallWritingLlmParams(ToolModel):
    """Represents the CallWritingLlmParams type."""

    instruction: str = Field(
        ...,
        description="The task for the WRITING LLM for this single stateless request (e.g. 'Rewrite this paragraph to be more descriptive'). Do not assume it has prior chapter knowledge.",
    )
    context: str = Field(
        ...,
        description="All text/context the WRITING LLM needs for this stateless call (relevant chapter excerpt, constraints, conflict status, style/POV requirements, and any needed identifiers).",
    )
    preceding_content: str | None = Field(
        None,
        validation_alias=AliasChoices("preceding_content", "preceeding_content"),
        description="Optional prose immediately preceding the insertion point. In append mode, if omitted, the system auto-fills this with the last paragraphs of the target chapter.",
    )
    sourcebook_entries: list[str] | None = Field(
        None,
        description="Optional list of sourcebook entry names or synonyms to include in the WRITING LLM prompt. Matching entries are resolved by name or synonym and added compactly with category, description, and relations.",
    )
    write_mode: str | None = Field(
        None,
        description="How to persist output: 'append' (add to end of chapter), 'replace' (replace the single occurrence of replace_target in the chapter with the generated text — replace_target is required), 'replace_all' (REPLACES THE COMPLETE EXISTING CONTENT of the chapter/draft with the newly generated text — all prior content is lost), 'insert_at_marker' (insert at ~~~ marker), or None (return text without writing).",
    )
    replace_target: str | None = Field(
        None,
        description="Required when write_mode='replace': the exact text passage to search for in the chapter. The first occurrence is replaced with the generated text. Must match the existing text exactly.",
    )
    chap_id: int | None = Field(
        None,
        description="Chapter ID to write to when writing into a chapter. The active schema indicates whether this parameter is required.",
    )


@chat_tool(
    description="Delegate a creative writing or rewriting task to the WRITING LLM. Stateless behavior: it only sees instruction/context provided in this call, so include all required chapter context and exact IDs explicitly. Can optionally write the output directly to a chapter with write_mode: 'append' adds to end, 'replace' substitutes a specific passage (set replace_target to the exact text to swap out — only the first occurrence is replaced), 'replace_all' REPLACES THE COMPLETE EXISTING CONTENT of the chapter/draft (all prior text is permanently overwritten — use only for full rewrites), 'insert_at_marker' inserts at ~~~ marker. Without write_mode, just returns generated text.",
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="delegation",
    project_types=("short-story", "novel", "series"),
)
async def call_writing_llm(
    params: CallWritingLlmParams, payload: dict, mutations: dict
) -> Any:
    """Execute the writing LLM tool with provided parameters and return the generated prose."""
    from augmentedquill.core.config import BASE_DIR, load_machine_config
    from augmentedquill.core.prompts import (
        get_system_message,
        get_user_prompt,
        load_model_prompt_overrides,
    )
    from augmentedquill.services.llm import llm

    base_url, api_key, model_id, timeout_s, model_name = llm.resolve_openai_credentials(
        payload, model_type="WRITING"
    )

    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    project_lang = str(story.get("language", "en") or "en")

    from augmentedquill.services.exceptions import BadRequestError

    # Enforce conflict-first workflow: writing requires at least one defined conflict.
    story_conflicts = story.get("conflicts") or []
    has_conflicts = bool(story_conflicts)
    project_type = str(story.get("project_type") or "")
    if not has_conflicts and project_type in ("novel", "series"):
        chapters = []
        if project_type == "novel":
            chapters = story.get("chapters") or []
        else:
            books = story.get("books") or []
            for book in books:
                for chapter in book.get("chapters") or []:
                    chapters.append(chapter)

        for c in chapters:
            if isinstance(c, dict) and c.get("conflicts"):
                has_conflicts = True
                break

    if not has_conflicts:
        raise BadRequestError(
            "No conflicts are set in the story or chapters. "
            "Set conflicts and resolution directions before calling call_writing_llm."
        )

    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    model_overrides = load_model_prompt_overrides(machine_config, model_name)
    system_prompt = get_system_message(
        "story_writer", model_overrides, language=project_lang
    )

    resolved_chap_id: int | None = None
    resolved_path = None
    existing_for_append = ""
    if params.write_mode == "append":
        resolved_chap_id = params.chap_id
        if resolved_chap_id is None:
            if project_type == "short-story":
                resolved_chap_id = 1
            else:
                raise BadRequestError(
                    "chap_id is required when write_mode is set for chapter-based projects (novel/series). "
                    "Call get_project_overview to see available chapter IDs."
                )
        _, resolved_path, _ = _chapter_by_id_or_404(resolved_chap_id)
        existing_for_append = resolved_path.read_text(encoding="utf-8")

    preceding_content = params.preceding_content
    if params.write_mode == "append" and not preceding_content:
        # The anchor is built from the raw (marker-inclusive) file, but the
        # WRITING LLM must only ever see clean prose — never internal
        # scene/annotation marker tokens.  The marker-inclusive text is still
        # used for the on-disk append below.
        preceding_content = _extract_tail_paragraphs(
            strip_internal_markers(existing_for_append)
        )

    user_content = get_user_prompt(
        "call_writing_llm_request",
        language=project_lang,
        instruction=params.instruction,
        context=params.context,
    )

    sourcebook_context = _build_sourcebook_entries_context(
        params.sourcebook_entries or [], project_lang
    )
    user_content = get_user_prompt(
        "call_writing_llm_request",
        language=project_lang,
        instruction=params.instruction,
        context=params.context,
        sourcebook_entries=sourcebook_context,
    )

    if preceding_content:
        user_content += get_user_prompt(
            "call_writing_llm_preceding_anchor",
            language=project_lang,
            preceding_content=preceding_content,
        )

    messages = [
        {
            "role": "system",
            "content": system_prompt,
        },
        {
            "role": "user",
            "content": user_content,
        },
    ]

    stream_queue = mutations.get("_stream_queue")

    if stream_queue is not None:
        # Streaming path: emit prose chunks so the frontend can show live progress.

        accumulated = ""
        # Resolve write_mode and chap_id early so we can include them in events.
        # (Actual persistence happens after streaming completes below.)
        preview_write_mode = params.write_mode or "return_only"
        preview_chap_id: int | None = (
            resolved_chap_id if resolved_chap_id is not None else params.chap_id
        )
        if (
            preview_chap_id is None
            and params.write_mode
            and project_type == "short-story"
        ):
            preview_chap_id = 1

        await stream_queue.put(
            (
                "prose_start",
                {"chap_id": preview_chap_id, "write_mode": preview_write_mode},
            )
        )

        async for chunk in llm.unified_chat_stream(
            caller_id="chat_tools.call_writing_llm",
            model_type="WRITING",
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
            model_name=model_name,
            supports_function_calling=False,
            skip_validation=True,
        ):
            if "content" in chunk:
                accumulated += chunk["content"]
                await stream_queue.put(
                    (
                        "prose_chunk",
                        {
                            "accumulated": accumulated,
                            "chap_id": preview_chap_id,
                            "write_mode": preview_write_mode,
                        },
                    )
                )

        generated_text = apply_typographic_quotes(accumulated, language=project_lang)
    else:
        # Non-streaming path (fallback / backward-compat).
        response = await llm.unified_chat_complete(
            caller_id="chat_tools.call_writing_llm",
            model_type="WRITING",
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
            model_name=model_name,
        )
        generated_text = apply_typographic_quotes(
            response.get("content", ""), language=project_lang
        )

    # If write_mode is specified, persist the generated text
    if params.write_mode:
        # Auto-detect chapter ID for short-story projects if not provided
        chap_id = resolved_chap_id if resolved_chap_id is not None else params.chap_id
        if chap_id is None:
            if project_type == "short-story":
                chap_id = 1  # Short-story projects use pseudo-chapter ID 1
            else:
                raise BadRequestError(
                    "chap_id is required when write_mode is set for chapter-based projects (novel/series). "
                    "Call get_project_overview to see available chapter IDs."
                )

        # Validate chapter exists and get path
        if resolved_path is None:
            _, path, _ = _chapter_by_id_or_404(chap_id)
        else:
            path = resolved_path

        if params.write_mode == "append":
            # Append to end of chapter (like continue_chapter)
            existing = existing_for_append or path.read_text(encoding="utf-8")
            new_content = _join_appended_prose(existing, generated_text)
            _write_chapter_content(chap_id, new_content)
            mutations["story_changed"] = True
            return {
                "generated_text": generated_text,
                "written": True,
                "write_mode": "append",
                "chap_id": chap_id,
            }

        elif params.write_mode == "replace":
            # Replace first occurrence of replace_target with generated text.
            if not params.replace_target:
                raise BadRequestError(
                    "replace_target is required when write_mode='replace'. "
                    "Provide the exact text passage to search for and replace."
                )
            existing = path.read_text(encoding="utf-8")
            if params.replace_target not in existing:
                raise BadRequestError(
                    f"replace_target not found in chapter {chap_id}. "
                    "Ensure the text matches the chapter content exactly."
                )
            new_content = existing.replace(params.replace_target, generated_text, 1)
            _write_chapter_content(chap_id, new_content)
            mutations["story_changed"] = True
            return {
                "generated_text": generated_text,
                "written": True,
                "write_mode": "replace",
                "chap_id": chap_id,
            }

        elif params.write_mode == "replace_all":
            # Replace entire chapter content — ALL prior content is overwritten.
            _write_chapter_content(chap_id, generated_text)
            mutations["story_changed"] = True
            return {
                "generated_text": generated_text,
                "written": True,
                "write_mode": "replace_all",
                "replaced_complete_content": True,
                "chap_id": chap_id,
                "status": "Complete chapter content has been replaced with the newly generated text.",
            }

        elif params.write_mode == "insert_at_marker":
            # Insert at ~~~ marker (replace marker with text)
            existing = path.read_text(encoding="utf-8")
            marker_pos = existing.find(MARKER)
            if marker_pos < 0:
                raise BadRequestError(
                    f"Marker '{MARKER}' not found in chapter {chap_id}. "
                    "Place the marker where you want text inserted."
                )
            new_content = (
                existing[:marker_pos]
                + generated_text
                + existing[marker_pos + len(MARKER) :]
            )
            _write_chapter_content(chap_id, new_content)
            mutations["story_changed"] = True
            return {
                "generated_text": generated_text,
                "written": True,
                "write_mode": "insert_at_marker",
                "chap_id": chap_id,
            }

        else:
            raise BadRequestError(
                f"Invalid write_mode: {params.write_mode}. "
                "Use 'append', 'replace', 'replace_all', 'insert_at_marker', or omit for return-only."
            )

    # Default: just return the generated text without writing
    return {"generated_text": generated_text}


# ============================================================================
# call_editing_assistant
# ============================================================================


class CallEditingAssistantParams(ToolModel):
    """Represents the CallEditingAssistantParams type."""

    task: str = Field(
        ...,
        description="The task the user wants the editor to perform on existing project prose (e.g., 'Fix the grammar in the current draft', 'Rewrite paragraph 2 to be more descriptive').",
    )
    chapter_id: int | None = Field(
        None,
        description="Optional chapter ID to set as the active writing unit for chapter-based EDITING sessions. Omit this for short-story projects.",
    )
    book_id: str | None = Field(
        None,
        description="Optional book ID (series only). Used together with chapter_id to disambiguate the active chapter.",
    )


@chat_tool(
    description="Delegate a prose editing task to the EDITING LLM. Use ONLY when existing prose text in the project must be corrected, refined, rewritten, or structurally revised. Do NOT use for character analysis, psychological insights, world-building questions, brainstorming, research, or any task that does not directly modify or review actual stored project prose.",
    allowed_roles=(CHAT_ROLE,),
    capability="delegation",
    project_types=("short-story", "novel", "series"),
)
async def call_editing_assistant(
    params: CallEditingAssistantParams, payload: dict, mutations: dict
) -> Any:
    """Execute the editing assistant tool and return revised prose based on the provided instructions."""
    from augmentedquill.core.config import BASE_DIR, load_machine_config
    from augmentedquill.core.prompts import (
        get_system_message,
        get_user_prompt,
        load_model_prompt_overrides,
    )
    from augmentedquill.services.chat.chat_tool_decorator import (
        execute_registered_tool,
        get_registered_tool_schemas,
    )
    from augmentedquill.services.llm import llm

    # Resolve EDITING model
    base_url, api_key, model_id, timeout_s, model_name = llm.resolve_openai_credentials(
        payload, model_type="EDITING"
    )

    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    model_overrides = load_model_prompt_overrides(machine_config, model_name)
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None) or {}
    project_lang = str(story.get("language", "en") or "en")
    sys_msg = get_system_message("editing_llm", model_overrides, language=project_lang)

    ctx_note = ""
    if params.chapter_id is not None:
        ctx_note = f"\nActive chapter ID for this task: {params.chapter_id}"
        if params.book_id:
            ctx_note += f", book ID: {params.book_id}"

    user_content = get_user_prompt(
        "call_editing_assistant_request",
        language=project_lang,
        task=params.task,
        context_note=ctx_note,
    )

    messages = [
        {"role": "system", "content": sys_msg},
        {"role": "user", "content": user_content},
    ]

    # Build base payload so EDITING tools can resolve the active chapter automatically
    base_nested_payload = dict(payload or {})
    if params.chapter_id is not None:
        base_nested_payload["active_chapter_id"] = params.chapter_id
    if params.book_id is not None:
        base_nested_payload["active_book_id"] = params.book_id

    _editing_project_type: str | None = None
    try:
        if active:
            _story_cfg = load_story_config(active / "story.json") or {}
            _editing_project_type = _story_cfg.get("project_type") or None
    except Exception:
        pass

    tools = get_registered_tool_schemas(
        model_type=EDITING_ROLE, project_type=_editing_project_type
    )

    final_output = ""
    recommended_updates: list[dict] = []
    for _ in range(7):  # max 7 steps
        try:
            res = await llm.unified_chat_complete(
                caller_id="chat_tools.call_editing_assistant",
                model_type="EDITING",
                messages=messages,
                base_url=base_url,
                api_key=api_key,
                model_id=model_id,
                timeout_s=timeout_s,
                model_name=model_name,
                tools=tools,
            )
        except Exception as e:
            # Llama.cpp and some endpoints return 500 when tool call JSON is malformed
            # Catching it gives the subagent a chance to adjust (e.g. use smaller chunk sizes)
            err_msg = str(e)
            messages.append(
                {
                    "role": "user",
                    "content": f"System Warning: Your previous attempt failed with an API/parsing error ({err_msg}). This typically occurs if your output was truncated due to length limits or formed invalid JSON. Please try again using smaller operations, shorter text chunks, or a different approach.",
                }
            )
            continue

        tool_calls = res.get("tool_calls", [])
        content = res.get("content", "")

        assistant_msg = {"role": "assistant"}
        if content:
            assistant_msg["content"] = content
        if tool_calls:
            assistant_msg["tool_calls"] = tool_calls

        messages.append(assistant_msg)

        if not tool_calls:
            final_output = content
            break

        for tcall in tool_calls:
            func = tcall.get("function", {})
            f_name = func.get("name")
            f_args = func.get("arguments", "{}")
            if isinstance(f_args, str):
                try:
                    args_obj = json.loads(f_args)
                except Exception:
                    args_obj = {}
            else:
                args_obj = f_args

            tcall_id = tcall.get("id")

            nested_payload = dict(base_nested_payload)
            nested_payload["_tool_role"] = EDITING_ROLE

            tool_res = await execute_registered_tool(
                f_name,
                args_obj,
                tcall_id,
                nested_payload,
                mutations,
                tool_role=EDITING_ROLE,
            )
            if "role" not in tool_res:
                from augmentedquill.services.chat.chat_tool_decorator import (
                    tool_message,
                )

                tool_res = tool_message(f_name, tcall_id, tool_res)

            if f_name == "recommend_metadata_updates":
                try:
                    tool_content = json.loads(tool_res.get("content") or "{}")
                except Exception:
                    tool_content = {}
                recommendation = tool_content.get("recommended_updates")
                if recommendation:
                    recommended_updates.append(recommendation)
            messages.append(tool_res)

    if not final_output:
        final_output = "Task completed using tools."

    final_output = apply_typographic_quotes(final_output, language=project_lang)
    result = {"message": "Editing Assistant finished", "response": final_output}
    if recommended_updates:
        result["recommended_updates"] = recommended_updates
    return result

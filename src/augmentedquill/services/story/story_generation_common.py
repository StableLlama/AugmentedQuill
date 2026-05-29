# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the story generation common unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from typing import Any
import re
from pathlib import Path

from augmentedquill.services.exceptions import BadRequestError
from augmentedquill.services.chat.chat_tool_decorator import EDITING_ROLE, WRITING_ROLE

from augmentedquill.core.config import BASE_DIR, save_story_config
from augmentedquill.services.story.story_api_prompt_ops import (
    _get_read_only_tool_schemas,
    build_ai_action_messages,
    build_chapter_summary_messages,
    build_continue_chapter_messages,
    build_story_summary_messages,
    build_write_chapter_messages,
    get_system_message,
    resolve_model_runtime,
)
from augmentedquill.services.projects.project_chapter_ops import (
    update_chapter_metadata_in_project,
)
from augmentedquill.services.story.story_api_state_ops import (
    collect_book_summaries,
    collect_chapter_summaries,
    ensure_chapter_slot,
    get_active_story_or_raise,
    get_all_normalized_chapters,
    get_chapter_locator,
    get_normalized_chapters,
    read_text_or_raise,
)


def _resolve_story_draft_path(active: Any, story: dict) -> Any:
    """Resolve story draft path."""
    return active / str(story.get("content_file") or "content.md")


def _build_chapter_heading_prefix(chapter_title: str) -> str:
    """Build the imposed heading prefix used for chapter rewrite continuations."""
    title = (chapter_title or "").strip()
    if not title:
        return ""
    return f"# {title}\n\n"


def _build_prefill_for_chapter_action(
    *, action: str, chapter_title: str, existing_content: str
) -> str | None:
    """Build assistant prefill text for chapter Rewrite/Extend actions."""
    if action not in ("rewrite", "extend"):
        return None

    heading_prefix = _build_chapter_heading_prefix(chapter_title)
    if action == "rewrite":
        return heading_prefix

    # Extend continues from the full current draft, prefixed with a temporary
    # heading when absent so the model stays in the same markdown structure.
    text = existing_content or ""
    if heading_prefix and text.startswith(heading_prefix):
        return text
    return f"{heading_prefix}{text}" if heading_prefix else text


def sanitize_prompt(prompt: str) -> str:
    """Remove empty labels and collapse blank lines in a prompt."""
    lines = prompt.splitlines()
    filtered: list[str] = []

    def _is_label_line(text: str) -> bool:
        """Return True if this line looks like a label line (key: or key: value)."""
        return bool(re.match(r"^[A-Za-z'\- ]+:", text))

    for i, line in enumerate(lines):
        # drop any line that looks like a label with nothing after colon
        # UNLESS the next lines contain actual content for this label.
        if re.match(r"^[A-Za-z'\- ]+:\s*$", line):
            has_content = False
            for next_line in lines[i + 1 :]:
                next_line = next_line.strip()
                if not next_line:
                    continue
                if next_line == "---":
                    break
                if _is_label_line(next_line):
                    break
                has_content = True
                break
            if not has_content:
                continue
        filtered.append(line)

    # collapse consecutive blank lines
    cleaned: list[str] = []
    prev_blank = False
    for line in filtered:
        if not line.strip():
            if not prev_blank:
                cleaned.append("")
            prev_blank = True
        else:
            cleaned.append(line)
            prev_blank = False
    return "\n".join(cleaned)


def normalize_included_markdown_headings(text: str) -> str:
    """Normalize markdown heading levels in included context blocks."""
    if not isinstance(text, str) or not text.strip():
        return text

    lines = text.splitlines()
    heading_levels: list[int] = []
    for line in lines:
        match = re.match(r"^(#{1,6})\s+", line)
        if match:
            heading_levels.append(len(match.group(1)))

    if not heading_levels:
        return text

    min_level = min(heading_levels)
    shift = 3 - min_level
    if shift == 0:
        return text

    def _adjust(line: str) -> str:
        match = re.match(r"^(#{1,6})\s+(.*)$", line)
        if not match:
            return line
        current = len(match.group(1))
        new_level = current + shift
        new_level = max(1, min(6, new_level))
        return f"{'#' * new_level} {match.group(2)}"

    return "\n".join(_adjust(line) for line in lines)


def _coerce_scene_id(raw_id: object) -> int | None:
    """Return a positive integer scene ID when the stored value is valid."""
    if isinstance(raw_id, int) and raw_id > 0:
        return raw_id
    if isinstance(raw_id, str) and raw_id.isdigit():
        parsed = int(raw_id)
        return parsed if parsed > 0 else None
    return None


def _iter_story_scenes(story: dict) -> list[dict[str, Any]]:
    """Return scene dicts with stable IDs from the story config."""
    raw_scenes = story.get("scenes") or {}
    items: list[dict[str, Any]] = []

    if isinstance(raw_scenes, dict):
        iterable = raw_scenes.items()
    elif isinstance(raw_scenes, list):
        iterable = [
            (scene.get("id"), scene) for scene in raw_scenes if isinstance(scene, dict)
        ]
    else:
        iterable = []

    for raw_id, scene_data in iterable:
        if not isinstance(scene_data, dict):
            continue
        scene_id = _coerce_scene_id(scene_data.get("id", raw_id))
        if scene_id is None:
            continue
        items.append({"id": scene_id, **scene_data})

    return items


def _scene_matches_scope(
    scene: dict[str, Any], *, scope: str, chap_id: int | None
) -> bool:
    """Return whether a scene is linked into the requested prose scope."""
    link = scene.get("prose_link")
    if not isinstance(link, dict):
        # Unlinked scenes are planning entities and should still participate in
        # deterministic scene guidance for both story and chapter scopes.
        return True

    if scope == "story":
        return link.get("scope_type") == "story"

    if link.get("scope_type") != "chapter" or chap_id is None:
        return False

    raw_chapter_id = link.get("chapter_id")
    if isinstance(raw_chapter_id, int):
        return raw_chapter_id == chap_id
    if isinstance(raw_chapter_id, str):
        stripped = raw_chapter_id.strip()
        return stripped == str(chap_id) or (
            stripped.isdigit() and int(stripped) == chap_id
        )
    return False


def _scene_sort_key(scene: dict[str, Any]) -> tuple[int, int, int, int]:
    """Sort scoped scenes by prose position, then deterministically by ID."""
    link = scene.get("prose_link") if isinstance(scene.get("prose_link"), dict) else {}
    start_offset = link.get("start_offset")
    has_start = isinstance(start_offset, int)
    scene_id = int(scene.get("id") or 0)
    return (
        0 if has_start else 1,
        int(start_offset) if has_start else 10**12,
        scene_id,
        scene_id,
    )


def _scene_reference_ids(scene: dict[str, Any]) -> list[str]:
    """Collect stable sourcebook IDs referenced by a scene."""
    ids: list[str] = []
    for field_name in (
        "active_characters",
        "passive_characters",
        "sourcebook_entry_ids",
    ):
        values = scene.get(field_name)
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, str):
                stripped = value.strip()
                if stripped and stripped not in ids:
                    ids.append(stripped)

    location = scene.get("location")
    if isinstance(location, str):
        stripped = location.strip()
        if stripped and stripped not in ids:
            ids.append(stripped)

    return ids


def _format_scene_brief(scene: dict[str, Any], *, include_summary: bool = True) -> str:
    """Render one compact scene guidance block for writing prompts."""
    lines: list[str] = []
    summary = str(scene.get("summary") or "").strip()
    if include_summary and summary:
        lines.append(f"Summary: {summary}")

    active_characters = scene.get("active_characters")
    if isinstance(active_characters, list):
        active = ", ".join(
            str(value).strip() for value in active_characters if str(value).strip()
        )
        if active:
            lines.append(f"Active characters: {active}")

    passive_characters = scene.get("passive_characters")
    if isinstance(passive_characters, list):
        passive = ", ".join(
            str(value).strip() for value in passive_characters if str(value).strip()
        )
        if passive:
            lines.append(f"Passive characters: {passive}")

    location = str(scene.get("location") or "").strip()
    if location:
        lines.append(f"Location: {location}")

    return "\n".join(lines)


def get_scene_context_for_scope(
    *,
    story: dict,
    scope: str,
    chap_id: int | None,
    current_text: str,
    include_all_scenes: bool,
) -> dict[str, Any]:
    """Derive deterministic scene guidance and referenced sourcebook IDs.

    For chapter continuation/relevance, this identifies the current scene from
    the end of the current prose and the immediately following linked scene.
    For rewrite, callers can request the full in-scope scene list.
    """
    scoped_scenes = [
        scene
        for scene in _iter_story_scenes(story)
        if _scene_matches_scope(scene, scope=scope, chap_id=chap_id)
    ]
    scoped_scenes.sort(key=_scene_sort_key)

    if not scoped_scenes:
        return {"scene_block": "", "sourcebook_ids": [], "scenes": []}

    selected_scenes: list[dict[str, Any]]
    if include_all_scenes:
        selected_scenes = scoped_scenes
    else:
        cursor = max(0, len(current_text or ""))
        current_index: int | None = None
        for index, scene in enumerate(scoped_scenes):
            link = scene.get("prose_link") or {}
            start_offset = int(link.get("start_offset") or 0)
            end_offset = link.get("end_offset")
            scene_end = float("inf") if end_offset is None else int(end_offset)

            if start_offset < cursor <= scene_end:
                current_index = index
                break
            if cursor == start_offset:
                current_index = index - 1 if index > 0 else None
                break
            if cursor >= scene_end:
                current_index = index
                continue
            if cursor < start_offset:
                break

        selected_scenes = []
        if current_index is not None:
            selected_scenes.append(scoped_scenes[current_index])
            if current_index + 1 < len(scoped_scenes):
                selected_scenes.append(scoped_scenes[current_index + 1])
        elif scoped_scenes:
            selected_scenes.append(scoped_scenes[0])

        if not selected_scenes:
            return {"scene_block": "", "sourcebook_ids": [], "scenes": []}

    sourcebook_ids: list[str] = []
    for scene in selected_scenes:
        for entry_id in _scene_reference_ids(scene):
            if entry_id not in sourcebook_ids:
                sourcebook_ids.append(entry_id)

    scene_lines: list[str] = []
    if include_all_scenes:
        scene_lines.append("## Scene plan for this draft")
        for index, scene in enumerate(selected_scenes, start=1):
            scene_lines.append(f"### Scene {index}")
            scene_lines.append(_format_scene_brief(scene) or "Summary: (empty)")
    else:
        scene_lines.append("## Current scene")
        scene_lines.append(
            _format_scene_brief(selected_scenes[0]) or "Summary: (empty)"
        )
        if len(selected_scenes) > 1:
            scene_lines.append("## Next scene preview")
            scene_lines.append(
                "Preview only: reference this next scene summary but do not include it in the generated output."
            )
            next_summary = str(selected_scenes[1].get("summary") or "").strip()
            scene_lines.append(
                f"Summary: {next_summary}" if next_summary else "Summary: (empty)"
            )

    return {
        "scene_block": "\n".join(scene_lines),
        "sourcebook_ids": sourcebook_ids,
        "scenes": selected_scenes,
    }


def get_scene_context_for_target(
    *,
    story: dict,
    scope: str,
    chap_id: int | None,
    target_scene_id: int,
    include_following_scenes: int,
) -> dict[str, Any]:
    """Build deterministic context centered on one scene and its successors."""
    context = get_scene_context_for_scope(
        story=story,
        scope=scope,
        chap_id=chap_id,
        current_text="",
        include_all_scenes=True,
    )
    scoped_scenes = context.get("scenes") or []
    if not scoped_scenes:
        return {"scene_block": "", "sourcebook_ids": [], "scenes": []}

    target_index = next(
        (
            idx
            for idx, scene in enumerate(scoped_scenes)
            if int(scene.get("id") or 0) == target_scene_id
        ),
        -1,
    )
    if target_index < 0:
        return context

    take_count = max(1, include_following_scenes + 1)
    selected = scoped_scenes[target_index : target_index + take_count]
    if not selected:
        return {"scene_block": "", "sourcebook_ids": [], "scenes": []}

    sourcebook_ids: list[str] = []
    for scene in selected:
        for entry_id in _scene_reference_ids(scene):
            if entry_id not in sourcebook_ids:
                sourcebook_ids.append(entry_id)

    scene_lines: list[str] = []
    for index, scene in enumerate(selected):
        if index == 0:
            scene_lines.append("## Current scene")
            scene_lines.append(_format_scene_brief(scene) or "Summary: (empty)")
        elif index == 1:
            scene_lines.append("## Next scene preview")
            scene_lines.append(
                "Preview only: reference this next scene summary but do not include it in the generated output."
            )
            next_summary = str(scene.get("summary") or "").strip()
            scene_lines.append(
                f"Summary: {next_summary}" if next_summary else "Summary: (empty)"
            )
        else:
            scene_lines.append(f"## Following scene {index}")
            scene_lines.append(_format_scene_brief(scene) or "Summary: (empty)")

    return {
        "scene_block": "\n".join(scene_lines),
        "sourcebook_ids": sourcebook_ids,
        "scenes": selected,
    }


def gather_writing_context(
    story: dict,
    chapters_data: list[dict],
    pos: int,
    title: str,
    summary: str,
    payload: dict | None = None,
) -> dict:
    """Gather common context for writing tasks (conflicts, tags, background)."""
    project_type = str(story.get("project_type", "novel") or "novel")
    project_type_label = {
        "short-story": "Short Story",
        "novel": "Novel",
        "series": "Series",
    }.get(project_type, project_type.replace("-", " ").title())

    # story-level info
    story_title = story.get("project_title", "")
    story_summary = story.get("story_summary", "")
    if project_type == "short-story":
        # Short stories use a single prose unit; avoid repeating story_summary
        # when the chapter-summary is already the canonical summary text.
        story_summary = ""
    tags = story.get("tags", [])
    if isinstance(tags, list):
        story_tags = ", ".join(str(t) for t in tags)
    else:
        story_tags = str(tags)

    # conflicts
    raw_conflicts = (
        story.get("conflicts", [])
        if pos is None
        else chapters_data[pos].get("conflicts", [])
    )
    conflict_lines = []
    if isinstance(raw_conflicts, list):
        for c in raw_conflicts:
            desc = c.get("description", "").strip()
            res = c.get("resolution", "").strip()
            if desc and not c.get("resolved", False):
                line = f"- {desc}"
                if res:
                    line += f" -> {res}"
                conflict_lines.append(line)
    conflicts_text = "\n".join(conflict_lines)

    # story notes
    story_notes = normalize_included_markdown_headings(
        str(story.get("notes", "") or "").strip()
    )

    # draft notes
    chapter_notes = ""
    try:
        if pos is None:
            chapter_notes = str(story.get("notes", "") or "").strip()
        else:
            chapter_notes = str(chapters_data[pos].get("notes", "") or "").strip()
    except Exception:
        chapter_notes = ""
    chapter_notes = normalize_included_markdown_headings(chapter_notes)

    # background (sourcebook)
    background = ""
    try:
        from augmentedquill.services.sourcebook.sourcebook_helpers import (
            sourcebook_search_entries,
            sourcebook_get_entry,
        )

        queries = []
        if title:
            queries.append(title)
        if summary:
            queries.append(summary)
        seen = set()
        lines = []
        for q in queries:
            for entry in sourcebook_search_entries(q):
                eid = entry.get("id")
                if not eid or eid in seen:
                    continue
                seen.add(eid)
                desc = entry.get("description", "")
                lines.append(f"[{entry.get('name', eid)}]\n" f"{desc}\n")

        # include any explicitly checked entries passed by the client
        checked = (payload or {}).get("checked_sourcebook") or []
        if isinstance(checked, list):
            for sid in checked:
                try:
                    entry = sourcebook_get_entry(sid)
                except Exception:
                    entry = None
                if entry:
                    eid = entry.get("id")
                    if eid and eid not in seen:
                        seen.add(eid)
                        desc = entry.get("description", "")
                        lines.append(f"[{entry.get('name', eid)}]\n" f"{desc}\n")

        background = normalize_included_markdown_headings("\n".join(lines))
    except Exception:
        # sourcebook is optional; don't fail generation if it's broken
        pass

    return {
        "project_type_label": project_type_label,
        "story_title": story_title,
        "story_summary": story_summary,
        "story_tags": story_tags,
        "story_notes": story_notes,
        "background": background,
        "chapter_conflicts": conflicts_text,
        "chapter_notes": chapter_notes,
    }


def _clear_summary_for_rewrite(prepared: dict, active: Path) -> None:
    """Helper for summary for rewrite.."""
    target = prepared.get("target")
    action = prepared.get("action")
    if action != "rewrite" or target not in (
        "summary",
        "story_summary",
        "book_summary",
    ):
        return

    prepared["_summary_rewrite_backup"] = None

    if target == "summary":
        chap_id = prepared.get("chap_id")
        if isinstance(chap_id, int):
            current_summary = (
                prepared["chapters_data"][prepared["pos"]].get("summary", "")
                if prepared.get("pos") is not None
                else ""
            )
            if current_summary:
                prepared["_summary_rewrite_backup"] = {
                    "target": "summary",
                    "chap_id": chap_id,
                    "summary": current_summary,
                }
                update_chapter_metadata_in_project(
                    active=active,
                    chap_id=chap_id,
                    summary="",
                )
    else:
        current_summary = str(prepared["story"].get("story_summary", "") or "")
        if current_summary:
            prepared["_summary_rewrite_backup"] = {
                "target": "story_summary",
                "summary": current_summary,
            }
            prepared["story"]["story_summary"] = ""
            save_story_config(prepared["story_path"], prepared["story"])


def _restore_summary_for_rewrite(prepared: dict) -> None:
    """Helper for summary for rewrite.."""
    backup = prepared.get("_summary_rewrite_backup")
    if not backup:
        return

    if backup.get("target") == "summary":
        update_chapter_metadata_in_project(
            active=prepared["active"],
            chap_id=backup["chap_id"],
            summary=backup["summary"],
        )
    else:
        prepared["story"]["story_summary"] = backup["summary"]
        save_story_config(prepared["story_path"], prepared["story"])


def prepare_story_summary_generation(
    payload: dict, mode: str, active: Path | None = None
) -> dict:
    """Prepare Story Summary Generation."""
    mode = (mode or "").lower()
    if mode not in ("discard", "update", ""):
        raise BadRequestError("mode must be discard|update")

    active, story_path, story = get_active_story_or_raise(active=active)
    if story.get("project_type") == "short-story":
        content_path = _resolve_story_draft_path(active, story)
        story_text = read_text_or_raise(content_path, message="Failed to read story")
        if not story_text.strip():
            raise BadRequestError("No story content available")

        (
            base_url,
            api_key,
            model_id,
            timeout_s,
            model_name,
            model_overrides,
            model_type,
        ) = resolve_model_runtime(
            payload=payload,
            model_type=EDITING_ROLE,
            base_dir=BASE_DIR,
        )
        content_label = get_system_message(
            "chapter_text_label",
            model_overrides,
            language=story.get("language", "en"),
        )
        messages = build_chapter_summary_messages(
            mode=mode,
            current_summary=story.get("story_summary", ""),
            chapter_text=story_text,
            content_label=content_label,
            model_overrides=model_overrides,
            language=story.get("language", "en"),
            project_type="short-story",
        )
        return {
            "story": story,
            "story_path": story_path,
            "messages": messages,
            "base_url": base_url,
            "api_key": api_key,
            "model_id": model_id,
            "model_name": model_name,
            "model_type": model_type,
            "timeout_s": timeout_s,
            "tools": (
                _get_read_only_tool_schemas(project_type="short-story")
                if model_type == EDITING_ROLE
                else None
            ),
        }

    current_story_summary = story.get("story_summary", "")

    if story.get("project_type") == "series":
        source_summaries = collect_book_summaries(story.get("books", []))
        if not source_summaries:
            raise BadRequestError("No book summaries available")
    else:
        chapters_data = get_all_normalized_chapters(story)
        source_summaries = collect_chapter_summaries(chapters_data)
        if not source_summaries:
            raise BadRequestError("No chapter summaries available")

    base_url, api_key, model_id, timeout_s, model_name, model_overrides, model_type = (
        resolve_model_runtime(
            payload=payload,
            model_type=EDITING_ROLE,
            base_dir=BASE_DIR,
        )
    )
    language = story.get("language", "en")
    if story.get("project_type") == "series":
        summary_heading = get_system_message(
            "book_summaries_label", model_overrides, language=language
        )
    else:
        summary_heading = get_system_message(
            "chapter_summaries_label", model_overrides, language=language
        )
    messages = build_story_summary_messages(
        mode=mode,
        current_story_summary=current_story_summary,
        source_summaries=source_summaries,
        summary_heading=summary_heading,
        model_overrides=model_overrides,
        language=language,
        project_type=story.get("project_type"),
    )
    return {
        "story": story,
        "story_path": story_path,
        "messages": messages,
        "base_url": base_url,
        "api_key": api_key,
        "model_id": model_id,
        "model_name": model_name,
        "model_type": model_type,
        "timeout_s": timeout_s,
        "tools": (
            _get_read_only_tool_schemas(project_type=story.get("project_type"))
            if model_type == EDITING_ROLE
            else None
        ),
    }


def prepare_chapter_summary_generation(
    payload: dict, chap_id: int, mode: str, active: Path | None = None
) -> dict:
    """Prepare Chapter Summary Generation."""
    if not isinstance(chap_id, int):
        raise BadRequestError("chap_id is required")

    mode = (mode or "").lower()
    if mode not in ("discard", "update", ""):
        raise BadRequestError("mode must be discard|update")

    _, path, pos = get_chapter_locator(chap_id, active=active)
    chapter_text = read_text_or_raise(path)
    _, story_path, story = get_active_story_or_raise(active=active)

    chapters_data = get_normalized_chapters(story)
    ensure_chapter_slot(chapters_data, pos)
    current_summary = chapters_data[pos].get("summary", "")

    base_url, api_key, model_id, timeout_s, model_name, model_overrides, model_type = (
        resolve_model_runtime(
            payload=payload,
            model_type=EDITING_ROLE,
            base_dir=BASE_DIR,
        )
    )
    content_label = get_system_message(
        "chapter_text_label",
        model_overrides,
        language=story.get("language", "en"),
    )

    messages = build_chapter_summary_messages(
        mode=mode,
        current_summary=current_summary,
        chapter_text=chapter_text,
        content_label=content_label,
        model_overrides=model_overrides,
        story_summary=story.get("story_summary"),
        language=story.get("language", "en"),
        project_type=story.get("project_type"),
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
        "model_name": model_name,
        "model_type": model_type,
        "timeout_s": timeout_s,
        "tools": (
            _get_read_only_tool_schemas(project_type=story.get("project_type"))
            if model_type == EDITING_ROLE
            else None
        ),
    }


def prepare_write_chapter_generation(
    payload: dict, chap_id: int, active: Path | None = None
) -> dict:
    """Prepare Write Chapter Generation."""
    if not isinstance(chap_id, int):
        raise BadRequestError("chap_id is required")

    _, path, pos = get_chapter_locator(chap_id, active=active)
    _, _, story = get_active_story_or_raise(active=active)

    chapters_data = get_normalized_chapters(story)
    if pos >= len(chapters_data):
        raise BadRequestError("No summary available for this chapter")

    summary = chapters_data[pos].get("summary", "").strip()
    title = chapters_data[pos].get("title") or path.name

    context = gather_writing_context(
        story=story,
        chapters_data=chapters_data,
        pos=pos,
        title=title,
        summary=summary,
        payload=payload,
    )

    base_url, api_key, model_id, timeout_s, model_name, model_overrides, model_type = (
        resolve_model_runtime(
            payload=payload,
            model_type=WRITING_ROLE,
            base_dir=BASE_DIR,
        )
    )
    messages = build_write_chapter_messages(
        project_type_label=context["project_type_label"],
        story_title=context["story_title"],
        story_summary=context["story_summary"],
        story_tags=context["story_tags"],
        background=context["background"],
        chapter_title=title,
        chapter_summary=summary,
        chapter_conflicts=context["chapter_conflicts"],
        chapter_notes=context["chapter_notes"],
        model_overrides=model_overrides,
        language=story.get("language", "en"),
    )

    return {
        "path": path,
        "story": story,
        "messages": messages,
        "base_url": base_url,
        "api_key": api_key,
        "model_id": model_id,
        "model_name": model_name,
        "model_type": model_type,
        "timeout_s": timeout_s,
    }


def prepare_continue_chapter_generation(
    payload: dict, chap_id: int, active: Path | None = None
) -> dict:
    """Prepare Continue Chapter Generation."""
    if not isinstance(chap_id, int):
        raise BadRequestError("chap_id is required")

    _, path, pos = get_chapter_locator(chap_id, active=active)
    existing = read_text_or_raise(path)

    _, _, story = get_active_story_or_raise(active=active)
    chapters_data = get_normalized_chapters(story)
    if pos >= len(chapters_data):
        raise BadRequestError("No summary available for this chapter")

    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    context = gather_writing_context(
        story=story,
        chapters_data=chapters_data,
        pos=pos,
        title=title,
        summary=summary,
        payload=payload,
    )

    base_url, api_key, model_id, timeout_s, model_name, model_overrides, model_type = (
        resolve_model_runtime(
            payload=payload,
            model_type=WRITING_ROLE,
            base_dir=BASE_DIR,
        )
    )
    messages = build_continue_chapter_messages(
        project_type_label=context["project_type_label"],
        story_title=context["story_title"],
        story_summary=context["story_summary"],
        story_tags=context["story_tags"],
        background=context["background"],
        chapter_title=title,
        chapter_summary=summary,
        chapter_conflicts=context["chapter_conflicts"],
        chapter_notes=context["chapter_notes"],
        existing_text=existing,
        model_overrides=model_overrides,
        language=story.get("language", "en"),
    )

    return {
        "path": path,
        "existing": existing,
        "messages": messages,
        "base_url": base_url,
        "api_key": api_key,
        "model_id": model_id,
        "model_name": model_name,
        "model_type": model_type,
        "timeout_s": timeout_s,
    }


def prepare_ai_action_generation(payload: dict, active: Path | None = None) -> dict:
    """Prepare generic AI action generation (Extend/Rewrite/Summary)."""
    target = payload.get("target")  # 'summary' | 'chapter' | 'story'
    action = payload.get("action")  # 'update' | 'rewrite' | 'extend'
    chap_id = payload.get("chap_id")

    active, story_path, story = get_active_story_or_raise(active=active)
    project_type = story.get("project_type", "novel")

    # For story_summary the correct scope is determined entirely by project_type:
    # short-story reads from the prose file; novel/series derives from
    # chapter/book summaries and needs no file path.  Ignore whatever scope the
    # frontend sent so the behaviour is correct for all project types.
    if target == "story_summary":
        scope = "story" if project_type == "short-story" else "chapter"
    else:
        scope = str(
            payload.get("scope")
            or ("story" if project_type == "short-story" else "chapter")
        ).lower()

    if scope == "story":
        path = _resolve_story_draft_path(active, story)
        pos = None
    else:
        if target in ("summary", "chapter") and not chap_id:
            raise BadRequestError("chap_id is required for chapter-level actions")
        if chap_id:
            _, path, pos = get_chapter_locator(chap_id, active=active)
        else:
            path, pos = None, None

    chapters_data = get_all_normalized_chapters(story)

    if scope == "story":
        chapter_summary = story.get("story_summary", "")
        chapter_title = story.get("project_title") or path.name
    elif pos is not None:
        ensure_chapter_slot(chapters_data, pos)
        chapter_summary = chapters_data[pos].get("summary", "")
        chapter_title = chapters_data[pos].get("title") or path.name
    else:
        chapter_summary = ""
        chapter_title = ""

    # Read the current chapter text once (if we have a chapter path).
    actual_chapter_text = read_text_or_raise(path) if path else None

    existing_content = payload.get("current_text")
    if not isinstance(existing_content, str):
        existing_content = actual_chapter_text or ""

    response_prefill = (
        _build_prefill_for_chapter_action(
            action=action,
            chapter_title=chapter_title,
            existing_content=existing_content,
        )
        if target == "chapter"
        else None
    )
    extra_body = None
    if response_prefill:
        # Hint OpenAI-compatible template backends to continue the prefilled
        # assistant turn instead of starting a fresh assistant response.
        extra_body = {
            "chat_template_kwargs": {
                "continue_final_message": True,
                "enable_thinking": False,
            }
        }

    # Decide whether the provided text should be treated as notes.
    source_hint = payload.get("source")
    is_notes_source = source_hint == "notes"

    # For short-story story-level summary the source is always the story draft on
    # disk, not whatever current_text the frontend may have sent.  Mirror the
    # validation done by prepare_story_summary_generation.
    if target == "story_summary" and project_type == "short-story":
        if not actual_chapter_text or not actual_chapter_text.strip():
            raise BadRequestError("No story content available to generate summary from")
        existing_content = actual_chapter_text
    if (
        not is_notes_source
        and isinstance(existing_content, str)
        and actual_chapter_text is not None
        and existing_content.strip()
        and existing_content.strip() != actual_chapter_text.strip()
    ):
        is_notes_source = True

    prepared = {
        "target": target,
        "action": action,
        "chap_id": chap_id,
        "path": path,
        "pos": pos,
        "story": story,
        "story_path": story_path,
        "chapters_data": chapters_data,
        "existing_content": existing_content,
    }
    _clear_summary_for_rewrite(prepared, active)

    chapter_summaries_list = collect_chapter_summaries(chapters_data)
    chapter_summaries_text = "\n\n".join(chapter_summaries_list)

    # For a series story-level summary the source material should be book summaries,
    # not individual chapter summaries (mirrors prepare_story_summary_generation).
    if target == "story_summary" and project_type == "series":
        book_summaries_list = collect_book_summaries(story.get("books", []))
        if book_summaries_list:
            chapter_summaries_text = "\n\n".join(book_summaries_list)

    scene_context: dict[str, Any] = {"scene_block": "", "sourcebook_ids": []}
    payload_with_scene_entries = dict(payload)
    if target == "chapter" and action in ("extend", "rewrite"):
        scene_context = get_scene_context_for_scope(
            story=story,
            scope=scope,
            chap_id=chap_id if isinstance(chap_id, int) else None,
            current_text=existing_content,
            include_all_scenes=action == "rewrite",
        )
        merged_sourcebook_ids = list(
            payload_with_scene_entries.get("checked_sourcebook") or []
        )
        for entry_id in scene_context.get("sourcebook_ids", []):
            if entry_id not in merged_sourcebook_ids:
                merged_sourcebook_ids.append(entry_id)
        if merged_sourcebook_ids:
            payload_with_scene_entries["checked_sourcebook"] = merged_sourcebook_ids

    context = gather_writing_context(
        story=story,
        chapters_data=chapters_data,
        pos=pos,
        title=chapter_title,
        summary=chapter_summary,
        payload=payload_with_scene_entries,
    )
    if scene_context.get("scene_block"):
        context["background"] = "\n\n".join(
            part
            for part in [context.get("background", ""), scene_context["scene_block"]]
            if part
        )

    model_type = (
        EDITING_ROLE
        if target in ("summary", "story_summary", "book_summary")
        else WRITING_ROLE
    )
    base_url, api_key, model_id, timeout_s, model_name, model_overrides, model_type = (
        resolve_model_runtime(
            payload=payload,
            model_type=model_type,
            base_dir=BASE_DIR,
        )
    )

    messages = build_ai_action_messages(
        target=target,
        action=action,
        project_type_label=context["project_type_label"],
        story_title=context["story_title"],
        story_summary=context["story_summary"],
        story_tags=context["story_tags"],
        background=context["background"],
        chapter_title=chapter_title,
        chapter_summary=chapter_summary,
        chapter_conflicts=context["chapter_conflicts"],
        chapter_notes=context["chapter_notes"],
        existing_content=existing_content,
        chapter_summaries=chapter_summaries_text,
        style_tags=context["story_tags"],
        content_label=get_system_message(
            "chapter_notes_label" if is_notes_source else "chapter_text_label",
            {},
            language=story.get("language", "en"),
        ),
        model_overrides=model_overrides,
        language=story.get("language", "en"),
        project_type=project_type,
    )

    # Sanitize the last message content (the user prompt)
    if messages and len(messages) > 0:
        # If the backend is streaming but no text reaches the frontend, it often
        # means the prompt formatting failed or returned an empty string.
        # We ensure it's sanitized but also present.
        messages[-1]["content"] = sanitize_prompt(messages[-1]["content"])

    return {
        "target": target,
        "action": action,
        "chap_id": chap_id,
        "path": path,
        "pos": pos,
        "story": story,
        "story_path": story_path,
        "chapters_data": chapters_data,
        "existing_content": existing_content,
        "active": active,
        "_summary_rewrite_backup": prepared.get("_summary_rewrite_backup"),
        "messages": messages,
        "base_url": base_url,
        "api_key": api_key,
        "model_id": model_id,
        "model_name": model_name,
        "model_type": model_type,
        "timeout_s": timeout_s,
        "response_prefill": response_prefill,
        "extra_body": extra_body,
        "tools": (
            _get_read_only_tool_schemas(project_type=project_type)
            if model_type == EDITING_ROLE
            else None
        ),
    }

# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the story generation common unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from typing import Any
from datetime import datetime, timezone
import calendar
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
from augmentedquill.services.scenes.scene_markers import remove_markers


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

    def _heading_level(text: str) -> int | None:
        match = re.match(r"^\s{0,3}(#{1,6})\s+\S", text)
        if not match:
            return None
        return len(match.group(1))

    pruned: list[str] = []
    index = 0
    while index < len(filtered):
        line = filtered[index]
        level = _heading_level(line)
        if level is not None and level >= 2:
            lookahead = index + 1
            while lookahead < len(filtered) and not filtered[lookahead].strip():
                lookahead += 1

            drop_heading = False
            if lookahead >= len(filtered):
                drop_heading = True
            else:
                next_line = filtered[lookahead]
                next_level = _heading_level(next_line)
                if next_line.strip() == "---":
                    drop_heading = True
                elif next_level is not None and next_level <= level:
                    drop_heading = True
                elif next_line.strip().lower().startswith("task:"):
                    drop_heading = True

            if drop_heading:
                index += 1
                while index < len(filtered) and not filtered[index].strip():
                    index += 1
                continue

        pruned.append(line)
        index += 1

    # collapse consecutive blank lines
    cleaned: list[str] = []
    prev_blank = False
    for line in pruned:
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
    scene: dict[str, Any],
    *,
    scope: str,
    chap_id: int | None,
    chap_book_id: str | None = None,
) -> bool:
    """Return whether a scene is linked into the requested prose scope."""
    link = scene.get("prose_link")
    if not isinstance(link, dict):
        # Legacy scenes without a persisted prose_link cannot be scoped reliably
        # to a specific chapter/story draft and must not leak into Extend/Rewrite
        # scene guidance.
        return False

    if scope == "story":
        return link.get("scope_type") == "story"

    if link.get("scope_type") != "chapter" or chap_id is None:
        return False

    raw_chapter_id = link.get("chapter_id")
    chapter_match = False
    if isinstance(raw_chapter_id, int):
        chapter_match = raw_chapter_id == chap_id
    elif isinstance(raw_chapter_id, str):
        stripped = raw_chapter_id.strip()
        chapter_match = stripped == str(chap_id) or (
            stripped.isdigit() and int(stripped) == chap_id
        )

    if not chapter_match:
        return False

    expected_book_id = (chap_book_id or "").strip() or None
    linked_book_id = str(link.get("book_id") or "").strip() or None
    if expected_book_id is None:
        return linked_book_id is None
    return linked_book_id == expected_book_id


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


_TEMPORAL_BRACKET_TOKEN_RE = re.compile(r"\[[^\]]+\]")
_INLINE_SCENE_MARKER_RE = re.compile(r"<!--\s*scene:\d+:(?:start|end)\s*-->")


def _visible_offset_to_raw_offset(raw_text: str, visible_offset: int) -> int:
    """Map marker-stripped offsets back to raw text offsets."""
    target = max(0, int(visible_offset))
    cursor_raw = 0
    cursor_visible = 0

    for match in _INLINE_SCENE_MARKER_RE.finditer(raw_text):
        segment_len = match.start() - cursor_raw
        if cursor_visible + segment_len >= target:
            return cursor_raw + (target - cursor_visible)
        cursor_visible += segment_len
        cursor_raw = match.end()

    remaining = len(raw_text) - cursor_raw
    if cursor_visible + remaining >= target:
        return cursor_raw + (target - cursor_visible)
    return len(raw_text)


def _cursor_for_scene_selection(current_text: str, scope_text: str | None) -> int:
    """Resolve a stable cursor offset for scene-range selection."""
    visible_cursor = len(_INLINE_SCENE_MARKER_RE.sub("", current_text or ""))
    if not scope_text or not _INLINE_SCENE_MARKER_RE.search(scope_text):
        return max(0, visible_cursor)
    return _visible_offset_to_raw_offset(scope_text, visible_cursor)


def _parse_temporal_datetime(raw_value: str) -> datetime | None:
    """Parse normalized temporal strings (optionally with bracket annotations)."""
    cleaned = _TEMPORAL_BRACKET_TOKEN_RE.sub("", raw_value.strip())
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
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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


def _format_compact_age(origin_dt: datetime, scene_dt: datetime) -> str | None:
    negative = False
    start_dt = origin_dt
    end_dt = scene_dt
    if scene_dt < origin_dt:
        negative = True
        start_dt, end_dt = scene_dt, origin_dt

    years = end_dt.year - start_dt.year
    anniversary = _replace_year_safe(start_dt, start_dt.year + years)
    if anniversary > end_dt:
        years -= 1
        anniversary = _replace_year_safe(start_dt, start_dt.year + years)

    months = 0
    cursor = anniversary
    while True:
        next_cursor = _add_months_safe(cursor, 1)
        if next_cursor <= end_dt:
            months += 1
            cursor = next_cursor
            continue
        break

    remainder = end_dt - cursor
    total_seconds = int(remainder.total_seconds())
    days, rem = divmod(total_seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, seconds = divmod(rem, 60)

    compact = None
    if years > 0:
        compact = f"{years}y"
    elif months > 0:
        compact = f"{months}m"
    elif days > 0:
        compact = f"{days}d"
    elif hours > 0:
        compact = f"{hours}h"
    elif minutes > 0:
        compact = f"{minutes}min"
    elif seconds > 0:
        compact = f"{seconds}s"
    else:
        compact = "0s"

    return f"-{compact}" if negative else compact


def _extract_scene_time(scene: dict[str, Any]) -> datetime | None:
    scene_time = scene.get("scene_time")
    if isinstance(scene_time, dict):
        raw_value = scene_time.get("temporal_zoned_datetime")
        if isinstance(raw_value, str):
            parsed = _parse_temporal_datetime(raw_value)
            if parsed is not None:
                return parsed

    raw_time = scene.get("time")
    if isinstance(raw_time, str):
        return _parse_temporal_datetime(raw_time)
    return None


def _active_character_age_map(scene: dict[str, Any]) -> dict[str, str]:
    """Build compact age labels for active character refs when possible."""
    scene_dt = _extract_scene_time(scene)
    if scene_dt is None:
        return {}

    active_characters = scene.get("active_characters")
    if not isinstance(active_characters, list) or not active_characters:
        return {}

    try:
        from augmentedquill.services.sourcebook.sourcebook_helpers import (
            sourcebook_get_entry,
        )
    except Exception:
        return {}

    labels: dict[str, str] = {}
    for raw_ref in active_characters:
        ref = str(raw_ref).strip()
        if not ref or ref in labels:
            continue
        try:
            entry = sourcebook_get_entry(ref)
        except Exception:
            entry = None
        if not isinstance(entry, dict):
            continue
        origin_date = entry.get("origin_date")
        if not isinstance(origin_date, str) or not origin_date.strip():
            continue

        origin_dt = _parse_temporal_datetime(origin_date)
        if origin_dt is None:
            continue
        compact_age = _format_compact_age(origin_dt, scene_dt)
        if compact_age:
            labels[ref] = compact_age
    return labels


def _format_scene_brief(
    scene: dict[str, Any],
    *,
    include_summary: bool = True,
    active_character_ages: dict[str, str] | None = None,
) -> str:
    """Render one compact scene guidance block for writing prompts."""
    lines: list[str] = []
    summary = str(scene.get("summary") or "").strip()
    if include_summary and summary:
        lines.append(f"Summary: {summary}")

    beats = scene.get("beats")
    if isinstance(beats, list):
        beat_lines: list[str] = []
        for index, beat in enumerate(beats, start=1):
            beat_text = ""
            if isinstance(beat, dict):
                beat_text = str(beat.get("text") or "").strip()
            else:
                beat_text = str(beat).strip()
            if beat_text:
                beat_lines.append(f"{index}. {beat_text}")
        if beat_lines:
            lines.append("Beats:")
            lines.extend(beat_lines)

    active_characters = scene.get("active_characters")
    if isinstance(active_characters, list):
        labels = active_character_ages or {}
        active_items: list[str] = []
        for value in active_characters:
            ref = str(value).strip()
            if not ref:
                continue
            age = labels.get(ref)
            active_items.append(f"{ref} [{age}]" if age else ref)
        active = ", ".join(active_items)
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
    chap_book_id: str | None = None,
    current_text: str,
    scope_text: str | None = None,
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
        if _scene_matches_scope(
            scene,
            scope=scope,
            chap_id=chap_id,
            chap_book_id=chap_book_id,
        )
    ]
    scoped_scenes.sort(key=_scene_sort_key)

    if not scoped_scenes:
        return {"scene_block": "", "sourcebook_ids": [], "scenes": []}

    selected_scenes: list[dict[str, Any]]
    if include_all_scenes:
        selected_scenes = scoped_scenes
    else:
        cursor = _cursor_for_scene_selection(current_text or "", scope_text)
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
            scene_lines.append(
                _format_scene_brief(
                    scene,
                    active_character_ages=_active_character_age_map(scene),
                )
                or "Summary: (empty)"
            )
    else:
        scene_lines.append("## Current scene")
        scene_lines.append(
            _format_scene_brief(
                selected_scenes[0],
                active_character_ages=_active_character_age_map(selected_scenes[0]),
            )
            or "Summary: (empty)"
        )
        if len(selected_scenes) > 1:
            scene_lines.append("## Next scene preview")
            scene_lines.append(
                "Preview only: reference this next scene summary but do not include it in the generated output."
            )
            scene_lines.append(
                _format_scene_brief(
                    selected_scenes[1],
                    active_character_ages=_active_character_age_map(selected_scenes[1]),
                )
                or "Summary: (empty)"
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
    chap_book_id: str | None = None,
    target_scene_id: int,
    include_following_scenes: int,
) -> dict[str, Any]:
    """Build deterministic context centered on one scene and its successors."""
    context = get_scene_context_for_scope(
        story=story,
        scope=scope,
        chap_id=chap_id,
        chap_book_id=chap_book_id,
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
            scene_lines.append(
                _format_scene_brief(
                    scene,
                    active_character_ages=_active_character_age_map(scene),
                )
                or "Summary: (empty)"
            )
        elif index == 1:
            scene_lines.append("## Next scene preview")
            scene_lines.append(
                "Preview only: reference this next scene summary but do not include it in the generated output."
            )
            scene_lines.append(
                _format_scene_brief(
                    scene,
                    active_character_ages=_active_character_age_map(scene),
                )
                or "Summary: (empty)"
            )
        else:
            scene_lines.append(f"## Following scene {index}")
            scene_lines.append(
                _format_scene_brief(
                    scene,
                    active_character_ages=_active_character_age_map(scene),
                )
                or "Summary: (empty)"
            )

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

    # Scene markers are an internal persistence detail and should never appear
    # in chapter Extend/Rewrite prompts.
    if target == "chapter" and action in ("extend", "rewrite"):
        existing_content = remove_markers(existing_content)

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

    actual_chapter_text_for_compare = (
        remove_markers(actual_chapter_text)
        if isinstance(actual_chapter_text, str)
        else actual_chapter_text
    )
    if (
        not is_notes_source
        and isinstance(existing_content, str)
        and actual_chapter_text_for_compare is not None
        and existing_content.strip()
        and existing_content.strip() != actual_chapter_text_for_compare.strip()
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
    chapter_book_id: str | None = None
    if (
        scope == "chapter"
        and project_type == "series"
        and isinstance(path, Path)
        and path.parent.name == "chapters"
        and path.parent.parent.parent.name == "books"
    ):
        chapter_book_id = path.parent.parent.name
    if target == "chapter" and action in ("extend", "rewrite"):
        scene_context = get_scene_context_for_scope(
            story=story,
            scope=scope,
            chap_id=chap_id if isinstance(chap_id, int) else None,
            chap_book_id=chapter_book_id,
            current_text=existing_content,
            scope_text=actual_chapter_text,
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
    if target == "chapter" and action in ("extend", "rewrite"):
        story_notes = str(context.get("story_notes") or "").strip()
        story_notes_block = f"## Story notes\n{story_notes}" if story_notes else ""
        scene_guidance_block = (
            f"# Scene guidance\n\n{scene_context['scene_block']}"
            if scene_context.get("scene_block")
            else ""
        )
        section_blocks = [
            section
            for section in [
                (
                    f"## Background\n{context.get('background', '').strip()}"
                    if str(context.get("background", "")).strip()
                    else ""
                ),
                story_notes_block,
                scene_guidance_block,
            ]
            if section
        ]
        context["background"] = "\n\n---\n\n".join(section_blocks)

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
        existing_content=(
            "" if target == "chapter" and action == "extend" else existing_content
        ),
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

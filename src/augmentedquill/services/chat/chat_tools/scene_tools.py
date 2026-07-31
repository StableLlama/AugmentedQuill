# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the scene tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import ConfigDict, Field

from augmentedquill.core.config import load_story_config
from augmentedquill.models.scene import (
    SceneBeat,
    SceneChronologyTime,
    SceneCreateRequest,
    SceneId,
    SceneLinkProseRequest,
    SceneReorderProseRequest,
    SceneTagPersonalDatetime,
    SceneUpdateRequest,
)
from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
    ToolModel,
    chat_tool,
)
from augmentedquill.services.chat.chat_tools.metadata_patching import (
    IntListPatch,
    StringListPatch,
    TextPatch,
    apply_int_list_patch,
    apply_string_list_patch,
    apply_text_patch,
)
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.services.scenes.scene_service import (
    create_scene,
    delete_scene,
    get_scene,
    link_prose,
    list_scenes,
    reorder_scene_prose,
    update_scene,
)


def _resolve_project_type(project_dir: Path) -> str:
    """Return the active project type or a safe default."""
    story = load_story_config(project_dir / "story.json") or {}
    project_type = story.get("project_type")
    if isinstance(project_type, str) and project_type.strip():
        return project_type.strip().lower()
    return "short-story"


def _sanitize_prose_link_for_llm(
    prose_link: dict[str, Any] | None,
    project_type: str,
) -> dict[str, Any] | None:
    """Hide internal prose-link details not intended for LLM-facing tools."""
    if not isinstance(prose_link, dict):
        return None

    scope_type = str(prose_link.get("scope_type") or "").strip().lower()
    if scope_type not in {"story", "chapter", "unlinked"}:
        return None

    result: dict[str, Any] = {"scope_type": scope_type}

    if scope_type == "chapter":
        chapter_id = prose_link.get("chapter_id")
        if chapter_id not in (None, ""):
            result["chapter_id"] = chapter_id
        if project_type == "series":
            book_id = prose_link.get("book_id")
            if book_id not in (None, ""):
                result["book_id"] = book_id

    return result


def _sanitize_scene_for_llm(scene: dict[str, Any], project_type: str) -> dict[str, Any]:
    """Return a scene payload safe for LLM tool consumption."""
    sanitized = dict(scene)
    sanitized["prose_link"] = _sanitize_prose_link_for_llm(
        scene.get("prose_link") if isinstance(scene, dict) else None,
        project_type,
    )

    beats = sanitized.get("beats")
    if isinstance(beats, list):
        cleaned_beats: list[Any] = []
        for beat in beats:
            if isinstance(beat, dict):
                beat_copy = dict(beat)
                beat_copy.pop("prose_link", None)
                cleaned_beats.append(beat_copy)
            else:
                cleaned_beats.append(beat)
        sanitized["beats"] = cleaned_beats

    return sanitized


def _parse_scene_time(scene: dict[str, Any]) -> datetime | None:
    """Parse normalized scene time values into an aware datetime."""
    scene_time = scene.get("scene_time")
    if not isinstance(scene_time, dict):
        return None
    raw = scene_time.get("temporal_zoned_datetime")
    if not isinstance(raw, str) or not raw.strip():
        return None

    cleaned = re.sub(r"\[[^\]]*\]", "", raw).strip()
    if not cleaned:
        return None

    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def _scene_id_key(scene: dict[str, Any]) -> str:
    return str(scene.get("id") or "")


def _scene_scope_bucket(scene: dict[str, Any]) -> int:
    prose_link = scene.get("prose_link")
    if not isinstance(prose_link, dict):
        return 2
    scope_type = str(prose_link.get("scope_type") or "").strip().lower()
    if scope_type == "story":
        return 0
    if scope_type == "chapter":
        return 1
    return 2


def _coerce_optional_int(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _scene_narrative_sort_key(
    scene: dict[str, Any],
    project_type: str,
    novel_chapter_numbers: dict[str, int],
    series_book_numbers: dict[str, int],
    series_chapter_numbers: dict[tuple[str, str], int],
) -> tuple[int, int, int, int, str]:
    prose_link = scene.get("prose_link")
    if not isinstance(prose_link, dict):
        return (2, 0, 0, 2**60, _scene_id_key(scene))

    bucket = _scene_scope_bucket(scene)
    book_number = 0
    chapter_number = 0
    if project_type == "novel" and bucket == 1:
        chapter_id = str(prose_link.get("chapter_id") or "").strip()
        if chapter_id:
            chapter_number = (
                novel_chapter_numbers.get(chapter_id)
                or _coerce_optional_int(chapter_id)
                or 0
            )
    elif project_type == "series" and bucket == 1:
        book_id = str(prose_link.get("book_id") or "").strip()
        chapter_id = str(prose_link.get("chapter_id") or "").strip()
        if book_id:
            book_number = (
                series_book_numbers.get(book_id) or _coerce_optional_int(book_id) or 0
            )
        if book_id and chapter_id:
            chapter_number = (
                series_chapter_numbers.get((book_id, chapter_id))
                or _coerce_optional_int(chapter_id)
                or 0
            )

    start_offset = _coerce_optional_int(prose_link.get("start_offset"))
    if start_offset is None:
        start_offset = 2**60

    return (bucket, book_number, chapter_number, start_offset, _scene_id_key(scene))


def _scene_narrative_order_indices(
    scenes: list[dict[str, Any]],
    project_type: str,
    project_dir: Path,
) -> dict[str, int]:
    story = load_story_config(project_dir / "story.json") or {}
    novel_chapter_numbers, series_book_numbers, series_chapter_numbers = (
        _chapter_number_maps_for_llm(story)
    )
    ordered = sorted(
        scenes,
        key=lambda scene: _scene_narrative_sort_key(
            scene,
            project_type,
            novel_chapter_numbers,
            series_book_numbers,
            series_chapter_numbers,
        ),
    )
    return {_scene_id_key(scene): idx for idx, scene in enumerate(ordered)}


def _scene_temporal_order_violations(scenes: list[dict[str, Any]]) -> set[str]:
    epochs: dict[str, datetime] = {}
    for scene in scenes:
        parsed = _parse_scene_time(scene)
        if parsed is not None:
            epochs[_scene_id_key(scene)] = parsed

    violations: set[str] = set()
    for scene in scenes:
        scene_id = _scene_id_key(scene)
        scene_epoch = epochs.get(scene_id)
        if scene_epoch is None:
            continue
        causes = scene.get("causes")
        if not isinstance(causes, list):
            continue
        for cause_id in causes:
            effect_key = str(cause_id)
            effect_epoch = epochs.get(effect_key)
            if effect_epoch is None:
                continue
            if scene_epoch > effect_epoch:
                violations.add(scene_id)
                violations.add(effect_key)
    return violations


def _scene_narrative_order_violations(
    scenes: list[dict[str, Any]],
    project_type: str,
    project_dir: Path,
) -> set[str]:
    indices = _scene_narrative_order_indices(scenes, project_type, project_dir)
    violations: set[str] = set()
    for scene in scenes:
        scene_id = _scene_id_key(scene)
        scene_index = indices.get(scene_id)
        if scene_index is None:
            continue
        causes = scene.get("causes")
        if not isinstance(causes, list):
            continue
        for cause_id in causes:
            effect_key = str(cause_id)
            effect_index = indices.get(effect_key)
            if effect_index is None:
                continue
            if scene_index > effect_index:
                violations.add(scene_id)
                violations.add(effect_key)
    return violations


def _annotate_scene_for_llm(
    scene_payload: dict[str, Any],
    scene: dict[str, Any],
    chronological_violations: set[str],
    narrative_violations: set[str],
) -> dict[str, Any]:
    scene_id = _scene_id_key(scene)
    if scene_id in chronological_violations:
        scene_payload["causes_violate_chronological_order"] = True
    if scene_id in narrative_violations:
        scene_payload["causes_might_violate_narrative_order"] = True
    return scene_payload


def _scene_payload_for_llm(
    scene: dict[str, Any],
    project_type: str,
    chronological_violations: set[str],
    narrative_violations: set[str],
) -> dict[str, Any]:
    payload = _sanitize_scene_for_llm(scene, project_type)
    return _annotate_scene_for_llm(
        payload,
        scene,
        chronological_violations,
        narrative_violations,
    )


def _chapter_number_maps_for_llm(
    story: dict[str, Any],
) -> tuple[
    dict[str, int],
    dict[str, int],
    dict[tuple[str, str], int],
]:
    """Build chapter/book index maps used in compact ordering snapshots."""
    novel_chapter_numbers: dict[str, int] = {}
    series_book_numbers: dict[str, int] = {}
    series_chapter_numbers: dict[tuple[str, str], int] = {}

    chapters = story.get("chapters")
    if isinstance(chapters, list):
        for chapter_number, chapter in enumerate(chapters, start=1):
            chapter_id = str(chapter_number)
            if isinstance(chapter, dict) and chapter.get("id") not in (None, ""):
                chapter_id = str(chapter.get("id")).strip()
            if chapter_id:
                novel_chapter_numbers[chapter_id] = chapter_number

    books = story.get("books")
    if isinstance(books, list):
        for book_number, book in enumerate(books, start=1):
            if not isinstance(book, dict):
                continue
            book_id = str(book.get("id") or book.get("folder") or "").strip()
            if book_id:
                series_book_numbers[book_id] = book_number

            chapters_in_book = book.get("chapters")
            if not isinstance(chapters_in_book, list):
                continue
            for chapter_number, chapter in enumerate(chapters_in_book, start=1):
                chapter_id = str(chapter_number)
                if isinstance(chapter, dict) and chapter.get("id") not in (None, ""):
                    chapter_id = str(chapter.get("id")).strip()
                if book_id and chapter_id:
                    series_chapter_numbers[(book_id, chapter_id)] = chapter_number

    return novel_chapter_numbers, series_book_numbers, series_chapter_numbers


def _chapter_target_ids_from_numbers(
    project_dir: Path,
    project_type: str,
    chapter_number: Any,
    book_number: Any,
    current_scene: dict[str, Any],
) -> tuple[str | None, str | None, str | None]:
    """Resolve chapter/book IDs from chapter_number/book_number inputs."""
    if chapter_number is None:
        return None, None, None

    chapter_num = _coerce_positive_int(chapter_number)
    if chapter_num is None:
        return None, None, "chapter_number must be a positive integer or null."

    story = load_story_config(project_dir / "story.json") or {}
    current_link = current_scene.get("prose_link")

    if project_type == "series":
        books = story.get("books")
        if not isinstance(books, list) or not books:
            return None, None, "Series project has no books configured."

        book_id: str | None = None
        target_book_num = _coerce_positive_int(book_number)
        if target_book_num is not None:
            if target_book_num < 1 or target_book_num > len(books):
                return (
                    None,
                    None,
                    f"book_number '{target_book_num}' is out of range.",
                )
            chosen_book = books[target_book_num - 1]
            if isinstance(chosen_book, dict):
                book_id = str(
                    chosen_book.get("id") or chosen_book.get("folder") or ""
                ).strip()
        elif (
            isinstance(current_link, dict)
            and str(current_link.get("scope_type") or "") == "chapter"
        ):
            book_id = _coerce_optional_id(current_link.get("book_id"))
        elif len(books) == 1 and isinstance(books[0], dict):
            book_id = str(books[0].get("id") or books[0].get("folder") or "").strip()

        if not book_id:
            return (
                None,
                None,
                "book_number is required for series chapter placement.",
            )

        chosen_book_obj = next(
            (
                book
                for book in books
                if isinstance(book, dict)
                and str(book.get("id") or book.get("folder") or "").strip() == book_id
            ),
            None,
        )
        if not isinstance(chosen_book_obj, dict):
            return None, None, "Resolved book could not be found in story config."

        chapters_in_book = chosen_book_obj.get("chapters")
        if not isinstance(chapters_in_book, list) or not chapters_in_book:
            return None, None, f"Book '{book_id}' has no chapters configured."
        if chapter_num < 1 or chapter_num > len(chapters_in_book):
            return (
                None,
                None,
                f"chapter_number '{chapter_num}' is out of range for selected book.",
            )

        chapter_obj = chapters_in_book[chapter_num - 1]
        chapter_id = str(chapter_num)
        if isinstance(chapter_obj, dict) and chapter_obj.get("id") not in (None, ""):
            chapter_id = str(chapter_obj.get("id")).strip()
        return chapter_id, book_id, None

    chapters = story.get("chapters")
    if not isinstance(chapters, list) or not chapters:
        return None, None, "Project has no chapters configured."
    if chapter_num < 1 or chapter_num > len(chapters):
        return None, None, f"chapter_number '{chapter_num}' is out of range."

    chapter_obj = chapters[chapter_num - 1]
    chapter_id = str(chapter_num)
    if isinstance(chapter_obj, dict) and chapter_obj.get("id") not in (None, ""):
        chapter_id = str(chapter_obj.get("id")).strip()
    return chapter_id, None, None


def _coerce_positive_int(value: Any) -> int | None:
    """Best-effort conversion for numeric chapter/book IDs."""
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit():
        parsed = int(value)
        if parsed > 0:
            return parsed
    return None


def _coerce_optional_id(value: Any) -> str | None:
    """Normalize optional IDs from int/string inputs."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _scene_matches_chapter_scope(
    scene: dict[str, Any],
    chapter_id: str | None,
    book_id: str | None,
    project_type: str,
) -> bool:
    """Return true when scene is in the requested chapter (or unlinked if chapter is None)."""
    link = scene.get("prose_link")
    if chapter_id is None:
        if not isinstance(link, dict):
            return True
        return str(link.get("scope_type") or "") == "unlinked"

    if not isinstance(link, dict):
        return False
    if str(link.get("scope_type") or "") != "chapter":
        return False
    if _coerce_optional_id(link.get("chapter_id")) != chapter_id:
        return False
    if project_type == "series":
        return _coerce_optional_id(link.get("book_id")) == book_id
    return True


def _execute_scene_move(
    *,
    active: Path,
    project_type: str,
    scene_id: int,
    source_chapter_id: Any,
    source_book_id: Any,
    target_chapter_id: Any,
    target_book_id: Any,
    move_position: Any,
) -> dict[str, Any]:
    """Execute move with resilient source/target semantics.

    Source fields are hints for stale model context and do not hard-fail the move.
    """
    source_scene = get_scene(active, scene_id)
    if source_scene is None:
        return {"error": f"Scene '{scene_id}' not found"}

    source_chapter = _coerce_optional_id(source_chapter_id)
    source_book = _coerce_optional_id(source_book_id)
    target_chapter = _coerce_optional_id(target_chapter_id)
    target_book = _coerce_optional_id(target_book_id)

    if project_type == "series":
        if source_chapter is not None and not source_book:
            return {
                "error": "Invalid scene move",
                "message": "source_book_id is required for series chapter moves.",
            }
        if target_chapter is not None and not target_book:
            return {
                "error": "Invalid scene move",
                "message": "target_book_id is required for series chapter moves.",
            }

    requested_position = move_position
    if isinstance(requested_position, str):
        pos_text = requested_position.strip().lower()
        if pos_text == "end":
            requested_position = "end"
        elif pos_text.isdigit():
            requested_position = int(pos_text)
    if isinstance(requested_position, int) and requested_position < 0:
        return {
            "error": "Invalid scene move",
            "message": "move_position must be >= 0 or 'end'.",
        }

    target_scenes = [
        s
        for s in list_scenes(active)
        if int(s.get("id") or 0) != scene_id
        and _scene_matches_chapter_scope(
            s,
            target_chapter,
            target_book,
            project_type,
        )
    ]

    if not target_scenes:
        target_scope_type = "chapter" if target_chapter else "unlinked"
        try:
            link_prose(
                active,
                scene_id,
                SceneLinkProseRequest(
                    scope_type=target_scope_type,
                    chapter_id=target_chapter,
                    book_id=target_book,
                    start_offset=0,
                    end_offset=0,
                ),
            )
        except (ValueError, KeyError) as exc:
            return {
                "error": "Invalid scene move",
                "message": str(exc),
            }
    else:
        target_size = len(target_scenes)
        place_before = True
        if requested_position == "end" or (
            isinstance(requested_position, int) and requested_position >= target_size
        ):
            anchor_scene_id = int(target_scenes[-1].get("id") or 0)
            place_before = False
        else:
            position_index = (
                int(requested_position) if isinstance(requested_position, int) else 0
            )
            anchor_scene_id = int(target_scenes[position_index].get("id") or 0)

        try:
            _ = reorder_scene_prose(
                active,
                SceneReorderProseRequest(
                    source_scene_id=scene_id,
                    target_scene_id=anchor_scene_id,
                    place_before=place_before,
                ),
            )
        except (ValueError, KeyError) as exc:
            return {
                "error": "Invalid scene move",
                "message": str(exc),
            }

    result: dict[str, Any] = {
        "ok": True,
        "current_scene_order": _scene_ordering_snapshot_for_llm(active, project_type),
    }
    if (
        source_chapter is not None or source_book is not None
    ) and not _scene_matches_chapter_scope(
        source_scene,
        source_chapter,
        source_book,
        project_type,
    ):
        result["warning"] = (
            "source scope hint did not match current scene location; move applied anyway."
        )
    return result


def _scene_ordering_snapshot_for_llm(
    project_dir: Path, project_type: str
) -> list[dict[str, Any]]:
    """Return compact narration-order snapshot for LLM resynchronization."""
    story = load_story_config(project_dir / "story.json") or {}
    scenes = list_scenes(project_dir)
    novel_chapter_numbers, series_book_numbers, series_chapter_numbers = (
        _chapter_number_maps_for_llm(story)
    )

    snapshot: list[dict[str, Any]] = []
    chapter_positions_novel: dict[str, int] = {}
    chapter_positions_series: dict[tuple[str, str], int] = {}
    for scene in scenes:
        entry: dict[str, Any] = {
            "scene_id": int(scene.get("id") or 0),
            "summary": str(scene.get("summary") or ""),
        }
        prose_link = scene.get("prose_link")

        if project_type == "novel":
            chapter_number: int | None = None
            if (
                isinstance(prose_link, dict)
                and prose_link.get("scope_type") == "chapter"
            ):
                chapter_id = str(prose_link.get("chapter_id") or "").strip()
                chapter_number = novel_chapter_numbers.get(chapter_id)
                if chapter_number is None:
                    chapter_number = _coerce_positive_int(chapter_id)
                if chapter_id:
                    entry["chapter_position"] = chapter_positions_novel.get(
                        chapter_id, 0
                    )
                    chapter_positions_novel[chapter_id] = (
                        int(entry["chapter_position"]) + 1
                    )
                else:
                    entry["chapter_position"] = None
            entry["chapter_number"] = chapter_number

        if project_type == "series":
            book_number: int | None = None
            chapter_number: int | None = None
            if (
                isinstance(prose_link, dict)
                and prose_link.get("scope_type") == "chapter"
            ):
                book_id = str(prose_link.get("book_id") or "").strip()
                chapter_id = str(prose_link.get("chapter_id") or "").strip()
                if book_id:
                    book_number = series_book_numbers.get(book_id)
                    if book_number is None:
                        book_number = _coerce_positive_int(book_id)
                if book_id and chapter_id:
                    chapter_number = series_chapter_numbers.get((book_id, chapter_id))
                if chapter_number is None:
                    chapter_number = _coerce_positive_int(chapter_id)
                if book_id and chapter_id:
                    chapter_scope = (book_id, chapter_id)
                    entry["chapter_position"] = chapter_positions_series.get(
                        chapter_scope, 0
                    )
                    chapter_positions_series[chapter_scope] = (
                        int(entry["chapter_position"]) + 1
                    )
                else:
                    entry["chapter_position"] = None
            entry["book_number"] = book_number
            entry["chapter_number"] = chapter_number

        snapshot.append(entry)

    return snapshot


def _scene_scope_key(
    scene: dict[str, Any], project_type: str
) -> tuple[str | None, str | None]:
    """Return scope key as (chapter_id, book_id) where chapter_id=None means unlinked."""
    prose_link = scene.get("prose_link")
    if not isinstance(prose_link, dict):
        return (None, None)
    if str(prose_link.get("scope_type") or "") != "chapter":
        return (None, None)
    chapter_id = _coerce_optional_id(prose_link.get("chapter_id"))
    if chapter_id is None:
        return (None, None)
    if project_type == "series":
        return (chapter_id, _coerce_optional_id(prose_link.get("book_id")))
    return (chapter_id, None)


def _list_scenes_for_llm(
    project_dir: Path,
    project_type: str,
    scope_keys: set[tuple[str | None, str | None]] | None = None,
) -> list[dict[str, Any]]:
    """Return list payload shape for scenes, optionally filtered to specific scopes."""
    scenes = list_scenes(project_dir)
    chronological_violations = _scene_temporal_order_violations(scenes)
    narrative_violations = _scene_narrative_order_violations(
        scenes, project_type, project_dir
    )
    numbering_by_scene_id: dict[int, dict[str, Any]] = {
        int(entry.get("scene_id") or 0): entry
        for entry in _scene_ordering_snapshot_for_llm(project_dir, project_type)
    }

    result: list[dict[str, Any]] = []
    for scene in scenes:
        if (
            scope_keys is not None
            and _scene_scope_key(scene, project_type) not in scope_keys
        ):
            continue
        scene_payload = _scene_payload_for_llm(
            scene,
            project_type,
            chronological_violations,
            narrative_violations,
        )
        scene_id = int(scene.get("id") or 0)
        numbering = numbering_by_scene_id.get(scene_id, {})
        if project_type == "novel":
            scene_payload["chapter_number"] = numbering.get("chapter_number")
            scene_payload["chapter_position"] = numbering.get("chapter_position")
        elif project_type == "series":
            scene_payload["chapter_number"] = numbering.get("chapter_number")
            scene_payload["chapter_position"] = numbering.get("chapter_position")
            scene_payload["book_number"] = numbering.get("book_number")
        result.append(scene_payload)
    return result


def _scoped_compact_scene_order_for_llm(
    project_dir: Path,
    project_type: str,
    scope_keys: set[tuple[str | None, str | None]],
) -> list[dict[str, Any]]:
    """Return compact scene ordering entries for affected chapter scopes only."""
    scenes = list_scenes(project_dir)
    allowed_scene_ids = {
        str(scene.get("id"))
        for scene in scenes
        if _scene_scope_key(scene, project_type) in scope_keys
        and scene.get("id") is not None
    }
    chronological_violations = _scene_temporal_order_violations(scenes)
    narrative_violations = _scene_narrative_order_violations(
        scenes, project_type, project_dir
    )
    compact_order = _scene_ordering_snapshot_for_llm(project_dir, project_type)
    result: list[dict[str, Any]] = []
    for entry in compact_order:
        scene_id = str(entry.get("scene_id") or "")
        if scene_id not in allowed_scene_ids:
            continue
        if scene_id in chronological_violations:
            entry["causes_violate_chronological_order"] = True
        if scene_id in narrative_violations:
            entry["causes_might_violate_narrative_order"] = True
        result.append(entry)
    return result


class ManageScenesUpdateData(ToolModel):
    """Payload for scene updates covering content, chronology, causality, and metadata."""

    model_config = ConfigDict(extra="forbid")

    summary: str | None = Field(None, description="Optional full replacement summary.")
    summary_patch: TextPatch | None = Field(
        None,
        description="Optional patch operation for partially editing summary.",
    )
    beats: list[SceneBeat] | None = Field(
        None,
        description="Optional full replacement beats list.",
    )
    active_characters: list[str] | None = Field(
        None,
        description="Optional full replacement active character IDs.",
    )
    active_characters_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for active characters.",
    )
    passive_characters: list[str] | None = Field(
        None,
        description="Optional full replacement passive character IDs.",
    )
    passive_characters_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for passive characters.",
    )
    sourcebook_entry_ids: list[str] | None = Field(
        None,
        description="Optional full replacement sourcebook entry IDs.",
    )
    sourcebook_entry_ids_patch: StringListPatch | None = Field(
        None,
        description="Optional patch operation for sourcebook entry IDs.",
    )
    location: str | None = Field(
        None, description="Optional full replacement location."
    )
    time: str | None = Field(None, description="Optional full replacement time.")
    scene_time: SceneChronologyTime | str | None = Field(
        None,
        description=(
            "Optional scene chronology time. "
            "RECOMMENDED FORMAT: ISO 8601 datetime string with timezone (e.g., '1985-11-05T20:00:00Z' or '1985-11-05T14:30:00+05:30'). "
            "ALSO ACCEPTED (gracefully normalized): "
            "date-only ('1985-11-05' → uses 12:00:00 UTC), "
            "date+time ('1985-11-05 14:30' → adds :00 seconds and UTC), "
            "time-only ('14:30' or '14:30:45' → uses today's date, :00 seconds if omitted, UTC if no timezone), "
            "time with timezone ('14:30+05:30' → uses today's date), "
            "or dict forms {'temporal_zoned_datetime': 'ISO_STRING'} or {'value': 'SHORTHAND_STRING'}. "
            "When date is omitted, the current date is used; missing seconds default to :00; missing timezone defaults to Z (UTC). "
            "All forms are stored internally as complete ISO 8601 format."
        ),
    )
    color_tag: str | None = Field(
        None,
        description="Optional full replacement color tag.",
    )
    causes: list[SceneId] | None = Field(
        None,
        description=(
            "Optional full replacement causes list for scene-to-scene causal links "
            "in story logic (cause/effect relationships) using integer scene IDs. "
            "Example: [1, 2, 3]."
        ),
        json_schema_extra={"examples": [[1, 2, 3]]},
    )
    causes_patch: IntListPatch | None = Field(
        None,
        description=(
            "Optional patch operation for causes scene IDs. "
            "Example: {add:[1,2]}, {remove:[3]}, or {set:[1,2,3]}."
        ),
        json_schema_extra={"examples": [{"add": [1, 2]}]},
    )
    pinboard_x: float | None = Field(None, description="Optional pinboard x position.")
    pinboard_y: float | None = Field(None, description="Optional pinboard y position.")
    status: str | None = Field(None, description="Optional full replacement status.")
    tag_personal_datetimes: list[SceneTagPersonalDatetime] | None = Field(
        None,
        description=(
            "Optional list of per-tag personal age overrides. Each entry has: "
            "role ('active'|'passive'|'sourcebook'), ref (character name for active/passive "
            "or sourcebook entry ID for sourcebook), index (0-based position within the "
            "role list, default 0, use >0 for duplicate characters e.g. time travellers), "
            "and personal_age (age string like '17y', '17y 3m', '5m 12d', '30d'). "
            "Used by the Convergence Map to sort each entry's scenes by their experienced "
            "age. Omit to leave unchanged; pass [] to clear all overrides."
        ),
    )
    chapter_number: int | None = Field(
        None,
        description=(
            "Optional chapter number placement update. "
            "Set null to unlink from any chapter."
        ),
    )
    chapter_position: int | Literal["end"] | None = Field(
        None,
        description=(
            "Optional chapter position update. "
            "Use zero-based position where 0 is first. "
            "Use 'end' or omit to append when chapter_number is set."
        ),
    )
    book_number: int | None = Field(
        None,
        description=(
            "Optional book number for series chapter placement. "
            "Use together with chapter_number in series projects."
        ),
    )


class ManageScenesParams(ToolModel):
    """Action router parameters for manage_scenes."""

    action: Literal["list", "get", "create", "update", "delete"] = Field(
        ...,
        description=(
            "Scene operation to run: "
            "list=return all scenes in narrative order; "
            "get=return one scene by scene_id; "
            "create=create a new scene from create_data; "
            "update=edit scene content from update_data; "
            "delete=remove one scene by scene_id."
        ),
    )
    scene_id: SceneId | None = Field(
        None,
        description="Required for actions 'get', 'update', and 'delete'.",
    )
    create_data: SceneCreateRequest | None = Field(
        None,
        description=(
            "Scene payload for action='create'. Provide scene content fields such as "
            "summary, beats, characters, causes, and metadata as needed. "
            "When creating scenes, include relevant sourcebook_entry_ids and a formal "
            "scene_time whenever chronology can be inferred; otherwise express dependency "
            "with causes. causes uses integer scene IDs."
        ),
    )
    update_data: ManageScenesUpdateData | None = Field(
        None,
        description=(
            "Scene updates for action='update'. Supports content full replacements "
            "and patch operations (summary_patch, active/passive/sourcebook/causes_patch) "
            "while preserving untouched fields, plus placement updates via "
            "chapter_number/chapter_position/book_number. "
            "Use causes/causes_patch to update scene causality links, "
            "time or scene_time to update chronology time fields, "
            "and summary/beats/characters/tags/metadata fields for narrative content updates. "
            "Placement rules: chapter_number=null unlinks scene; chapter_number only appends to target chapter; "
            "chapter_position only reorders within current chapter; chapter_number+chapter_position places scene at explicit position. "
            "chapter_position is zero-based (0 means first). "
            "causes and causes_patch use integer scene IDs. Pass raw integer arrays, "
            "for example {add:[1,2]} or {remove:[3]}. "
            "For update_data.scene_time, pass a Temporal object, {'value': ...}, "
            "or a plain ISO-like string such as '1985-11-05', '1985-11-05T20:00', "
            "or '1985-11-05T20:00:00Z'."
        ),
    )
    scope_type: str | None = Field(
        None,
        description="List filter hint field.",
    )
    scope: str | None = Field(
        None,
        description="List filter alias field.",
    )


@chat_tool(
    description=(
        "Manage scene data and placement. "
        "Use list/get to inspect scene state, create to add scenes, update to edit "
        "scene content (summary, beats, characters, causes, time/scene_time, tags, metadata), "
        "and to update placement via chapter_number/chapter_position/book_number, "
        "use sourcebook_entry_ids plus formal scene_time when chronology is known, "
        "and use causes for inferred dependencies between scenes, "
        "delete to remove scenes. Use chapter_number=null to unlink from chapters."
    ),
    allowed_roles=(CHAT_ROLE, EDITING_ROLE),
    capability="metadata-write",
)
async def manage_scenes(
    params: ManageScenesParams, payload: dict, mutations: dict
) -> Any:
    """Route scene actions to the existing scene service CRUD operations."""
    active = get_active_project_dir()
    if active is None:
        return {"error": "No active project"}
    project_type = _resolve_project_type(active)

    if params.action == "list":
        return _list_scenes_for_llm(active, project_type)

    if params.action == "get":
        if params.scene_id is None:
            return {"error": "scene_id is required when action='get'."}
        scene = get_scene(active, params.scene_id)
        if scene is None:
            return {"error": f"Scene '{params.scene_id}' not found"}
        all_scenes = list_scenes(active)
        chronological_violations = _scene_temporal_order_violations(all_scenes)
        narrative_violations = _scene_narrative_order_violations(
            all_scenes, project_type, active
        )
        return _scene_payload_for_llm(
            scene,
            project_type,
            chronological_violations,
            narrative_violations,
        )

    if params.action == "create":
        if params.create_data is None:
            return {"error": "create_data is required when action='create'."}
        try:
            created = create_scene(active, params.create_data)
        except ValueError as exc:
            message = str(exc)
            if "cannot reference itself in causes" in message:
                return {
                    "error": "Invalid scene ordering",
                    "message": (
                        "A scene cannot reference itself in causes. "
                        "Remove that ID from scene causes and reference only other existing scenes."
                    ),
                    "details": {"reason": message},
                }
            if "zero-width" in message.lower() or "end must be > start" in message:
                return {
                    "error": "Invalid scene data",
                    "message": (
                        "Cannot create a scene with an empty prose range. "
                        "Provide a non-empty prose segment to link the scene to."
                    ),
                    "details": {"reason": message},
                }
            return {
                "error": "Invalid scene data",
                "message": message,
            }
        except OSError as exc:
            return {
                "error": "Scene creation failed",
                "message": (
                    "Could not write scene data to disk. "
                    "Check filesystem permissions and disk space."
                ),
                "details": {"reason": str(exc)},
            }
        except Exception as exc:
            return {
                "error": "Scene creation failed",
                "message": f"An unexpected error occurred: {exc}",
                "details": {"reason": str(exc)},
            }
        mutations["story_changed"] = True
        all_scenes = list_scenes(active)
        chronological_violations = _scene_temporal_order_violations(all_scenes)
        narrative_violations = _scene_narrative_order_violations(
            all_scenes, project_type, active
        )
        return _scene_payload_for_llm(
            created,
            project_type,
            chronological_violations,
            narrative_violations,
        )

    if params.action == "update":
        if params.scene_id is None:
            return {"error": "scene_id is required when action='update'."}
        if params.update_data is None:
            return {"error": "update_data is required when action='update'."}

        current = get_scene(active, params.scene_id)
        if current is None:
            return {"error": f"Scene '{params.scene_id}' not found"}

        fields_set = set(params.update_data.model_fields_set)

        placement_requested = bool(
            {"chapter_number", "chapter_position", "book_number"}.intersection(
                fields_set
            )
        )

        if placement_requested and project_type not in {"novel", "series"}:
            return {
                "error": "Invalid scene update",
                "message": (
                    "chapter_number/chapter_position/book_number placement updates are "
                    "only supported for novel and series projects. "
                    "Short-story projects do not have chapter placement."
                ),
            }

        placement_result: dict[str, Any] | None = None
        source_scope_key = _scene_scope_key(current, project_type)
        target_scope_key = source_scope_key
        if placement_requested:
            if "book_number" in fields_set and "chapter_number" not in fields_set:
                return {
                    "error": "Invalid scene update",
                    "message": "book_number requires chapter_number in update_data.",
                }

            current_link = current.get("prose_link")
            target_chapter_id: str | None
            target_book_id: str | None

            if "chapter_number" in fields_set:
                target_chapter_id, target_book_id, target_error = (
                    _chapter_target_ids_from_numbers(
                        active,
                        project_type,
                        params.update_data.chapter_number,
                        params.update_data.book_number,
                        current,
                    )
                )
                if target_error:
                    return {
                        "error": "Invalid scene update",
                        "message": target_error,
                    }
            else:
                target_chapter_id = None
                target_book_id = None
                if (
                    isinstance(current_link, dict)
                    and str(current_link.get("scope_type") or "") == "chapter"
                ):
                    target_chapter_id = _coerce_optional_id(
                        current_link.get("chapter_id")
                    )
                    if project_type == "series":
                        target_book_id = _coerce_optional_id(
                            current_link.get("book_id")
                        )

            requested_position = (
                params.update_data.chapter_position
                if "chapter_position" in fields_set
                else "end"
            )

            placement_result = _execute_scene_move(
                active=active,
                project_type=project_type,
                scene_id=params.scene_id,
                source_chapter_id=None,
                source_book_id=None,
                target_chapter_id=target_chapter_id,
                target_book_id=target_book_id,
                move_position=requested_position,
            )
            if placement_result.get("error"):
                return placement_result

            current = get_scene(active, params.scene_id) or current
            target_scope_key = _scene_scope_key(current, project_type)

        placement_scope_keys: set[tuple[str | None, str | None]] = {
            source_scope_key,
            target_scope_key,
        }

        update_kwargs: dict[str, Any] = {}

        summary_value = params.update_data.summary
        if params.update_data.summary_patch is not None:
            summary_value = apply_text_patch(
                str(current.get("summary") or ""),
                params.update_data.summary_patch,
            )
        if params.update_data.summary_patch is not None or "summary" in fields_set:
            if summary_value is not None:
                update_kwargs["summary"] = summary_value

        active_characters_value = params.update_data.active_characters
        if params.update_data.active_characters_patch is not None:
            current_active = current.get("active_characters")
            if not isinstance(current_active, list):
                current_active = []
            active_characters_value = apply_string_list_patch(
                current_active,
                params.update_data.active_characters_patch,
            )
        if (
            params.update_data.active_characters_patch is not None
            or "active_characters" in fields_set
        ):
            update_kwargs["active_characters"] = active_characters_value or []

        passive_characters_value = params.update_data.passive_characters
        if params.update_data.passive_characters_patch is not None:
            current_passive = current.get("passive_characters")
            if not isinstance(current_passive, list):
                current_passive = []
            passive_characters_value = apply_string_list_patch(
                current_passive,
                params.update_data.passive_characters_patch,
            )
        if (
            params.update_data.passive_characters_patch is not None
            or "passive_characters" in fields_set
        ):
            update_kwargs["passive_characters"] = passive_characters_value or []

        sourcebook_entry_ids_value = params.update_data.sourcebook_entry_ids
        if params.update_data.sourcebook_entry_ids_patch is not None:
            current_sourcebook_ids = current.get("sourcebook_entry_ids")
            if not isinstance(current_sourcebook_ids, list):
                current_sourcebook_ids = []
            sourcebook_entry_ids_value = apply_string_list_patch(
                current_sourcebook_ids,
                params.update_data.sourcebook_entry_ids_patch,
            )
        if (
            params.update_data.sourcebook_entry_ids_patch is not None
            or "sourcebook_entry_ids" in fields_set
        ):
            update_kwargs["sourcebook_entry_ids"] = sourcebook_entry_ids_value or []

        causes_value = params.update_data.causes
        if params.update_data.causes_patch is not None:
            current_causes = current.get("causes")
            if not isinstance(current_causes, list):
                current_causes = []
            causes_value = apply_int_list_patch(
                [int(scene_id) for scene_id in current_causes],
                params.update_data.causes_patch,
            )
        if params.update_data.causes_patch is not None or "causes" in fields_set:
            update_kwargs["causes"] = causes_value or []

        for field_name in (
            "beats",
            "location",
            "time",
            "scene_time",
            "color_tag",
            "pinboard_x",
            "pinboard_y",
            "status",
            "tag_personal_datetimes",
        ):
            if field_name in fields_set:
                value = getattr(params.update_data, field_name)
                if field_name == "beats":
                    update_kwargs[field_name] = value or []
                elif field_name in ("pinboard_x", "pinboard_y", "status"):
                    if value is not None:
                        update_kwargs[field_name] = value
                else:
                    update_kwargs[field_name] = value

        if not update_kwargs:
            if placement_result is not None:
                updated_after_move = get_scene(active, params.scene_id)
                if updated_after_move is None:
                    return {"error": f"Scene '{params.scene_id}' not found"}
                mutations["story_changed"] = True
                return _scoped_compact_scene_order_for_llm(
                    active,
                    project_type,
                    placement_scope_keys,
                )
            return {
                "error": "No scene fields to update",
                "message": (
                    "No updatable fields were provided. "
                    "Use update_data content fields and/or placement fields "
                    "(chapter_number, chapter_position, book_number)."
                ),
            }

        has_effective_change = any(
            current.get(field_name) != value
            for field_name, value in update_kwargs.items()
        )
        if not has_effective_change:
            if placement_result is not None:
                updated_after_move = get_scene(active, params.scene_id)
                if updated_after_move is None:
                    return {"error": f"Scene '{params.scene_id}' not found"}
                mutations["story_changed"] = True
                return _scoped_compact_scene_order_for_llm(
                    active,
                    project_type,
                    placement_scope_keys,
                )
            return {
                "ok": True,
                "changed": False,
                "message": ("No effective scene content changes were detected."),
            }

        update_payload = SceneUpdateRequest(**update_kwargs)

        try:
            updated = update_scene(active, params.scene_id, update_payload)
        except ValueError as exc:
            message = str(exc)
            if "cannot reference itself in causes" in message:
                return {
                    "error": "Invalid scene ordering",
                    "message": (
                        "A scene cannot reference itself in causes. "
                        "Use IDs of other scenes only."
                    ),
                    "details": {"scene_id": params.scene_id, "reason": message},
                }
            return {
                "error": "Invalid scene update",
                "message": message,
            }
        except OSError as exc:
            return {
                "error": "Scene update failed",
                "message": (
                    "Could not write scene data to disk. "
                    "Check filesystem permissions and disk space."
                ),
                "details": {"reason": str(exc)},
            }
        except Exception as exc:
            return {
                "error": "Scene update failed",
                "message": f"An unexpected error occurred: {exc}",
                "details": {"reason": str(exc)},
            }
        if updated is None:
            return {"error": f"Scene '{params.scene_id}' not found"}
        mutations["story_changed"] = True
        all_scenes = list_scenes(active)
        chronological_violations = _scene_temporal_order_violations(all_scenes)
        narrative_violations = _scene_narrative_order_violations(
            all_scenes, project_type, active
        )
        updated_scene_payload = _scene_payload_for_llm(
            updated,
            project_type,
            chronological_violations,
            narrative_violations,
        )
        if placement_result is None:
            return updated_scene_payload

        return {
            "scene": updated_scene_payload,
            "scene_list": _scoped_compact_scene_order_for_llm(
                active,
                project_type,
                placement_scope_keys,
            ),
        }

    if params.action == "delete":
        if params.scene_id is None:
            return {"error": "scene_id is required when action='delete'."}
        deleted = delete_scene(active, params.scene_id)
        if not deleted:
            return {"error": f"Scene '{params.scene_id}' not found"}
        mutations["story_changed"] = True
        return {"ok": True}

    return {"error": f"Unsupported action: {params.action}"}

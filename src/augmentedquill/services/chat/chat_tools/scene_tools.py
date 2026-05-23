# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the scene tools unit so this responsibility stays isolated, testable, and easy to evolve."""

from typing import Any, Literal
from pathlib import Path

from pydantic import ConfigDict, Field
from augmentedquill.services.chat.chat_tool_decorator import ToolModel
from augmentedquill.core.config import load_story_config

from augmentedquill.models.scene import (
    SceneBeat,
    SceneChronologyTime,
    SceneCreateRequest,
    SceneId,
    SceneProseLink,
    SceneReorderProseRequest,
    SceneTagPersonalDatetime,
    SceneUpdateRequest,
)
from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    EDITING_ROLE,
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


def _chapter_number_maps_for_llm(story: dict[str, Any]) -> tuple[
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


def _coerce_positive_int(value: Any) -> int | None:
    """Best-effort conversion for numeric chapter/book IDs."""
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit():
        parsed = int(value)
        if parsed > 0:
            return parsed
    return None


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
            entry["book_number"] = book_number
            entry["chapter_number"] = chapter_number

        snapshot.append(entry)

    return snapshot


class ManageScenesUpdateData(ToolModel):
    """Payload for scene updates supporting full and partial patch operations."""

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
    prose_link: SceneProseLink | None = Field(
        None,
        description="Optional full replacement scene prose link.",
    )
    causes: list[SceneId] | None = Field(
        None,
        description=(
            "Optional full replacement causes list of integer scene IDs. "
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


class ManageScenesParams(ToolModel):
    """Action router parameters for manage_scenes."""

    action: Literal["list", "get", "create", "update", "delete", "move"] = Field(
        ...,
        description=(
            "Scene action: 'list', 'get', 'create', 'update', 'delete', or " "'move'."
        ),
    )
    scene_id: SceneId | None = Field(
        None,
        description="Required for actions 'get', 'update', and 'delete'.",
    )
    create_data: SceneCreateRequest | None = Field(
        None,
        description="Required when action='create'. Uses the full GUI scene schema.",
    )
    update_data: ManageScenesUpdateData | None = Field(
        None,
        description=(
            "Required when action='update'. Supports partial patches for summary "
            "and list fields while preserving untouched data."
        ),
    )
    target_scene_id: SceneId | None = Field(
        None,
        description="Required when action='move'. Anchor scene used for placement.",
    )
    place_before: bool = Field(
        True,
        description="When action='move': true inserts before target_scene_id, false after.",
    )
    scope_type: str | None = Field(
        None,
        description=(
            "Deprecated list filter hint. Ignored for action='list'. Kept for "
            "backward compatibility with legacy model calls."
        ),
    )
    scope: str | None = Field(
        None,
        description=(
            "Deprecated alias for scope_type. Ignored for action='list'. Kept for "
            "backward compatibility with legacy model calls."
        ),
    )


@chat_tool(
    description=(
        "Unified scenes manager with full GUI schema parity. Scenes do not have "
        "a separate title field; use create_data.summary as the scene label. Use "
        "action='list' to list scenes, action='get' with scene_id to retrieve one "
        "scene, action='create' with create_data to create a scene, action='update' "
        "with scene_id and update_data to modify a scene, action='move' with "
        "scene_id + target_scene_id to place a scene before/after another scene "
        "(works within the same chapter/scope and across scopes), and "
        "action='delete' with scene_id to remove a scene. When creating scenes, include relevant "
        "sourcebook_entry_ids and a formal scene_time whenever the chronology can "
        "be inferred; otherwise express causal dependency with causes. "
        "causes and causes_patch use integer scene IDs. "
        "Pass raw integer arrays, e.g. {add:[1,2]} or {remove:[3]}. "
        "For update_data.scene_time, you can pass a Temporal object, {'value': ...}, "
        "or a plain ISO-like string such as '1985-11-05', '1985-11-05T20:00', or "
        "'1985-11-05T20:00:00Z'."
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
        return [
            _sanitize_scene_for_llm(scene, project_type)
            for scene in list_scenes(active)
        ]

    if params.action == "get":
        if params.scene_id is None:
            return {"error": "scene_id is required when action='get'."}
        scene = get_scene(active, params.scene_id)
        if scene is None:
            return {"error": f"Scene '{params.scene_id}' not found"}
        return _sanitize_scene_for_llm(scene, project_type)

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
            return {
                "error": "Invalid scene data",
                "message": message,
            }
        mutations["story_changed"] = True
        return _sanitize_scene_for_llm(created, project_type)

    if params.action == "update":
        if params.scene_id is None:
            return {"error": "scene_id is required when action='update'."}
        if params.update_data is None:
            return {"error": "update_data is required when action='update'."}

        current = get_scene(active, params.scene_id)
        if current is None:
            return {"error": f"Scene '{params.scene_id}' not found"}

        fields_set = set(params.update_data.model_fields_set)
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
            "prose_link",
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
        if updated is None:
            return {"error": f"Scene '{params.scene_id}' not found"}
        mutations["story_changed"] = True
        return _sanitize_scene_for_llm(updated, project_type)

    if params.action == "delete":
        if params.scene_id is None:
            return {"error": "scene_id is required when action='delete'."}
        deleted = delete_scene(active, params.scene_id)
        if not deleted:
            return {"error": f"Scene '{params.scene_id}' not found"}
        mutations["story_changed"] = True
        return {"ok": True}

    if params.action == "move":
        if params.scene_id is None:
            return {"error": "scene_id is required when action='move'."}
        if params.target_scene_id is None:
            return {"error": "target_scene_id is required when action='move'."}
        if params.scene_id == params.target_scene_id:
            return {
                "error": "Invalid scene move",
                "message": "scene_id and target_scene_id must be different.",
            }

        try:
            response = reorder_scene_prose(
                active,
                SceneReorderProseRequest(
                    source_scene_id=params.scene_id,
                    target_scene_id=params.target_scene_id,
                    place_before=params.place_before,
                ),
            )
        except (ValueError, KeyError) as exc:
            return {
                "error": "Invalid scene move",
                "message": str(exc),
            }

        mutations["story_changed"] = True
        _ = response
        return {
            "ok": True,
            "current_scene_order": _scene_ordering_snapshot_for_llm(
                active, project_type
            ),
        }

    return {"error": f"Unsupported action: {params.action}"}

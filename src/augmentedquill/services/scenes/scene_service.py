# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Scene service – CRUD operations for scenes stored inside story.json.

Scenes are persisted in the project's ``story.json`` under the ``scenes`` key
as a dict keyed by scene ID. Prose boundaries are stored as inline HTML comment
markers inside content files and are computed at read time.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from augmentedquill.core.config import (
    load_story_config,
    save_story_config,
)
from augmentedquill.models.scene import (
    SceneCreateRequest,
    SceneId,
    SceneLinkProseRequest,
    SceneReorderProseRequest,
    SceneReorderProseResponse,
    SceneUpdateProseContentRequest,
    SceneUpdateRequest,
)
from augmentedquill.services.scenes.scene_markers import (
    SceneSpan,
    inject_annotation_markers,
    inject_markers,
    parse_annotation_spans,
    parse_scene_spans,
    remap_offset_after_marker_removal,
    remove_annotation_markers,
    remove_markers,
    scene_block_bounds,
    snap_range_outside_markers,
    snap_offset_outside_markers,
    validate_internal_marker_tokens,
    validate_scene_marker_tokens,
)
from augmentedquill.updates.migrate_story_v3 import migrate_project_v3
from augmentedquill.updates.migrate_story_v4 import migrate_project_v4
from augmentedquill.updates.migrate_story_v5 import migrate_project_v5
from augmentedquill.updates.migrate_story_v6 import migrate_project_v6
from augmentedquill.updates.migrate_story_v7 import migrate_project_v7

UNLINKED_SCOPE_TYPE = "unlinked"
UNLINKED_CONTENT_FILENAME = "unlinked.txt"

_MARKER_LOCATIONS_CACHE: dict[
    Path, tuple[tuple[tuple[str, int, int], ...], dict[SceneId, dict[str, Any]]]
] = {}


def _invalidate_marker_cache(project_dir: Path) -> None:
    """Clear the marker-locations cache so the next read gets fresh data."""
    _MARKER_LOCATIONS_CACHE.pop(project_dir, None)


def _migrate_project_latest(project_dir: Path) -> None:
    """Apply all chainable story migrations required by the scene service."""
    migrate_project_v3(project_dir)
    migrate_project_v4(project_dir)
    migrate_project_v5(project_dir)
    migrate_project_v6(project_dir)
    migrate_project_v7(project_dir)


def _scope_signature(project_dir: Path) -> tuple[tuple[str, int, int], ...]:
    """Build a strict cache key for all marker-relevant files in a project."""
    story_path = project_dir / "story.json"
    signature: list[tuple[str, int, int]] = []

    if story_path.exists():
        stat = story_path.stat()
        signature.append((str(story_path), stat.st_mtime_ns, stat.st_size))

    for _, path in _scope_candidates(project_dir):
        if not path.exists():
            signature.append((str(path), -1, -1))
            continue
        stat = path.stat()
        signature.append((str(path), stat.st_mtime_ns, stat.st_size))

    signature.sort(key=lambda item: item[0])
    return tuple(signature)


def _scope_candidates(project_dir: Path) -> list[tuple[dict[str, Any], Path]]:
    """Return candidate prose scopes and resolved file paths for marker scans."""
    story = load_story_config(project_dir / "story.json") or {}
    candidates: list[tuple[dict[str, Any], Path]] = []
    seen: set[Path] = set()

    def _add(link: dict[str, Any]) -> None:
        path = _scene_content_path(project_dir, link)
        if path is None or path in seen:
            return
        seen.add(path)
        candidates.append((link, path))

    _add({"scope_type": "story", "chapter_id": None, "book_id": None})

    chapters = story.get("chapters")
    if isinstance(chapters, list):
        for index, chapter in enumerate(chapters, start=1):
            chapter_id = str(index)
            if isinstance(chapter, dict) and chapter.get("id"):
                chapter_id = str(chapter.get("id"))
            _add(
                {
                    "scope_type": "chapter",
                    "chapter_id": chapter_id,
                    "book_id": None,
                }
            )

    books = story.get("books")
    if isinstance(books, list):
        for book in books:
            if not isinstance(book, dict):
                continue
            book_id = str(book.get("id") or book.get("folder") or "").strip()
            if not book_id:
                continue
            bchapters = book.get("chapters")
            if not isinstance(bchapters, list):
                continue
            for index, chapter in enumerate(bchapters, start=1):
                chapter_id = str(index)
                if isinstance(chapter, dict) and chapter.get("id"):
                    chapter_id = str(chapter.get("id"))
                _add(
                    {
                        "scope_type": "chapter",
                        "chapter_id": chapter_id,
                        "book_id": book_id,
                    }
                )

    chapters_dir = project_dir / "chapters"
    if chapters_dir.exists():
        for chapter_file in sorted(chapters_dir.iterdir()):
            if not chapter_file.is_file():
                continue
            if chapter_file.suffix != ".txt":
                continue
            if not chapter_file.stem.isdigit():
                continue
            _add(
                {
                    "scope_type": "chapter",
                    "chapter_id": chapter_file.stem,
                    "book_id": None,
                }
            )

    books_dir = project_dir / "books"
    if books_dir.exists():
        for book_dir in sorted(books_dir.iterdir()):
            if not book_dir.is_dir():
                continue
            chapter_dir = book_dir / "chapters"
            if not chapter_dir.exists():
                continue
            for chapter_file in sorted(chapter_dir.iterdir()):
                if not chapter_file.is_file():
                    continue
                if chapter_file.suffix != ".txt":
                    continue
                if not chapter_file.stem.isdigit():
                    continue
                _add(
                    {
                        "scope_type": "chapter",
                        "chapter_id": chapter_file.stem,
                        "book_id": book_dir.name,
                    }
                )

    # Unlinked scope last — its zero-width markers for all scenes
    # must not shadow chapter/story/book markers.
    _add({"scope_type": UNLINKED_SCOPE_TYPE, "chapter_id": None, "book_id": None})

    return candidates


def _marker_locations_by_scene(project_dir: Path) -> dict[SceneId, dict[str, Any]]:
    """Return runtime prose-link payloads computed from file markers."""
    signature = _scope_signature(project_dir)
    cached = _MARKER_LOCATIONS_CACHE.get(project_dir)
    if cached is not None and cached[0] == signature:
        return {scene_id: link.copy() for scene_id, link in cached[1].items()}

    locations: dict[SceneId, dict[str, Any]] = {}
    for link, path in _scope_candidates(project_dir):
        if not path.exists():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for span in parse_scene_spans(content):
            if span.end < span.start:
                continue
            if span.scene_id in locations:
                continue
            locations[span.scene_id] = {
                "scope_type": link.get("scope_type", "story"),
                "chapter_id": link.get("chapter_id"),
                "book_id": link.get("book_id"),
                "start_offset": span.start,
                "end_offset": span.end,
            }

    _MARKER_LOCATIONS_CACHE[project_dir] = (
        signature,
        {scene_id: link.copy() for scene_id, link in locations.items()},
    )
    return locations


def _assert_scope_marker_tokens_valid(project_dir: Path) -> None:
    """Fail fast when any prose scope contains malformed marker tokens."""
    for _, path in _scope_candidates(project_dir):
        if not path.exists():
            continue
        content = path.read_text(encoding="utf-8")
        validate_scene_marker_tokens(content)


def _remove_scene_markers_from_non_target_scopes(
    project_dir: Path,
    scene_id: SceneId,
    target_path: Path,
) -> str:
    """Remove *scene_id* markers from every scope file except *target_path*.

    Returns the first non-empty prose payload previously wrapped by the removed
    scene markers. This allows relinking across scopes without inventing new
    placeholder text when the target scope is empty.
    """
    carried_prose = ""
    for _, path in _scope_candidates(project_dir):
        if not path.exists() or path == target_path:
            continue
        content = _read_validated_marker_content(path)
        spans = {span.scene_id: span for span in parse_scene_spans(content)}
        span = spans.get(scene_id)
        if span is not None and not carried_prose:
            payload = content[span.start : span.end]
            if payload:
                carried_prose = payload
        cleaned = remove_markers(content, {scene_id})
        if cleaned != content:
            _write_text_atomic(path, cleaned)
    return carried_prose


def _inject_runtime_links_into_scenes_dict(
    scenes_dict: dict[SceneId, Any],
    project_dir: Path,
) -> dict[SceneId, Any]:
    """Populate in-memory prose_link values from marker scans (not persisted)."""
    locations = _marker_locations_by_scene(project_dir)
    for scene_id, scene_data in scenes_dict.items():
        location = locations.get(scene_id)
        scenes_dict[scene_id] = {
            **scene_data,
            "prose_link": location.copy() if isinstance(location, dict) else None,
        }
    return scenes_dict


def _drop_prose_links_for_persistence(
    scenes_dict: dict[SceneId, Any],
) -> dict[SceneId, Any]:
    """Return a copy of scenes_dict with scene/beat prose_link removed."""
    cleaned: dict[SceneId, Any] = {}
    for scene_id, scene_data in scenes_dict.items():
        payload = {
            k: v
            for k, v in scene_data.items()
            if k not in ("prose_link", "order_index")
        }
        beats = payload.get("beats")
        if isinstance(beats, list):
            clean_beats: list[Any] = []
            for beat in beats:
                if isinstance(beat, dict):
                    clean_beats.append(
                        {k: v for k, v in beat.items() if k != "prose_link"}
                    )
                else:
                    clean_beats.append(beat)
            payload["beats"] = clean_beats
        cleaned[scene_id] = payload
    return cleaned


def _scene_content_path(project_dir: Path, link: dict[str, Any]) -> Path | None:
    """Resolve the prose file path for a given prose-link dict."""
    scope = link.get("scope_type", "")
    if scope == "story":
        for name in ("content.md", "draft.md"):
            candidate = project_dir / name
            if candidate.exists():
                return candidate
        return project_dir / "content.md"

    if scope == UNLINKED_SCOPE_TYPE:
        return project_dir / UNLINKED_CONTENT_FILENAME

    if scope == "chapter":
        chapter_id = str(link.get("chapter_id") or "").strip()
        book_id = str(link.get("book_id") or "").strip()
        if not chapter_id:
            return None

        story = load_story_config(project_dir / "story.json") or {}

        def _safe_int(text: str) -> int | None:
            try:
                return int(text)
            except ValueError:
                return None

        def _chapter_filename_from_story() -> str | None:
            numeric_id = _safe_int(chapter_id)

            def _filename_or_inferred(chapter: dict[str, Any], local_index: int) -> str:
                filename = chapter.get("filename")
                if isinstance(filename, str) and filename.strip():
                    return filename.strip()
                return f"{local_index + 1:04d}.txt"

            if book_id:
                books = story.get("books")
                if not isinstance(books, list):
                    return None
                matched_book: dict[str, Any] | None = None
                for book in books:
                    if not isinstance(book, dict):
                        continue
                    bid = str(book.get("id") or book.get("folder") or "").strip()
                    if bid == book_id:
                        matched_book = book
                        break
                if matched_book is None:
                    return None
                chapters = matched_book.get("chapters")
                if not isinstance(chapters, list):
                    return None
                for chapter_index, chapter in enumerate(chapters):
                    if not isinstance(chapter, dict):
                        continue
                    cid = str(chapter.get("id") or "").strip()
                    if cid and cid == chapter_id:
                        return _filename_or_inferred(chapter, chapter_index)
                if numeric_id is not None:
                    for chapter_index, chapter in enumerate(chapters):
                        if not isinstance(chapter, dict):
                            continue
                        filename = chapter.get("filename")
                        if not isinstance(filename, str) or not filename.strip():
                            continue
                        stem = Path(filename.strip()).stem
                        if stem.isdigit() and int(stem) == numeric_id:
                            return _filename_or_inferred(chapter, chapter_index)
                if numeric_id is not None:
                    local_index = numeric_id - 1
                    if 0 <= local_index < len(chapters):
                        chapter = chapters[local_index]
                        if isinstance(chapter, dict):
                            return _filename_or_inferred(chapter, local_index)
                return None

            chapters = story.get("chapters")
            if not isinstance(chapters, list):
                return None
            for chapter_index, chapter in enumerate(chapters):
                if not isinstance(chapter, dict):
                    continue
                cid = str(chapter.get("id") or "").strip()
                if cid and cid == chapter_id:
                    return _filename_or_inferred(chapter, chapter_index)
            if numeric_id is not None:
                for chapter_index, chapter in enumerate(chapters):
                    if not isinstance(chapter, dict):
                        continue
                    filename = chapter.get("filename")
                    if not isinstance(filename, str) or not filename.strip():
                        continue
                    stem = Path(filename.strip()).stem
                    if stem.isdigit() and int(stem) == numeric_id:
                        return _filename_or_inferred(chapter, chapter_index)
            numeric_id = _safe_int(chapter_id)
            if numeric_id is not None:
                index = numeric_id - 1
                if 0 <= index < len(chapters):
                    chapter = chapters[index]
                    if isinstance(chapter, dict):
                        return _filename_or_inferred(chapter, index)
            return None

        chapter_filename = _chapter_filename_from_story()
        chapter_numeric = _safe_int(chapter_id)
        inferred_from_id = (
            f"{chapter_numeric:04d}.txt" if chapter_numeric is not None else None
        )

        candidates: list[Path] = []
        if book_id:
            if chapter_filename:
                candidates.append(
                    project_dir / "books" / book_id / "chapters" / chapter_filename
                )
            if inferred_from_id:
                candidates.append(
                    project_dir / "books" / book_id / "chapters" / inferred_from_id
                )
        else:
            if chapter_filename:
                candidates.append(project_dir / "chapters" / chapter_filename)
            if inferred_from_id:
                candidates.append(project_dir / "chapters" / inferred_from_id)

        if not candidates:
            return None

        expanded: list[Path] = []
        for candidate in candidates:
            expanded.append(candidate)
            if not candidate.suffix:
                expanded.append(candidate.with_suffix(".md"))
                expanded.append(candidate.with_suffix(".txt"))

        for candidate in expanded:
            if candidate.exists():
                return candidate

        return expanded[0] if expanded else None

    return None


def _same_prose_scope(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Return True when two prose-link dicts point at the same scope."""
    return (
        a.get("scope_type") == b.get("scope_type")
        and (a.get("chapter_id") or None) == (b.get("chapter_id") or None)
        and (a.get("book_id") or None) == (b.get("book_id") or None)
    )


def _write_text_atomic(path: Path, content: str) -> None:
    """Write text atomically so a failed save never leaves partial content."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    replaced = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False
        ) as tmp_file:
            tmp_file.write(content)
            temp_path = Path(tmp_file.name)
        os.replace(temp_path, path)
        replaced = True
    finally:
        if temp_path is not None and temp_path.exists() and not replaced:
            temp_path.unlink(missing_ok=True)


def _read_validated_marker_content(path: Path) -> str:
    """Read prose content and fail fast when marker syntax is malformed."""
    content = path.read_text(encoding="utf-8")
    validate_scene_marker_tokens(content)
    validate_internal_marker_tokens(content)
    return content


def _coerce_scene_id(raw_id: object) -> SceneId | None:
    if isinstance(raw_id, int) and raw_id > 0:
        return raw_id
    if isinstance(raw_id, str) and raw_id.isdigit():
        parsed = int(raw_id)
        return parsed if parsed > 0 else None
    return None


def _coerce_scene_id_list(raw_ids: object) -> list[SceneId]:
    if not isinstance(raw_ids, list):
        return []
    result: list[SceneId] = []
    for raw_id in raw_ids:
        scene_id = _coerce_scene_id(raw_id)
        if scene_id is not None:
            result.append(scene_id)
    return result


def _next_scene_id(scenes_dict: dict[SceneId, Any]) -> SceneId:
    return max(scenes_dict.keys(), default=0) + 1


def _validate_scene_ordering_constraints(
    scene_id: SceneId,
    causes: object,
) -> None:
    cause_ids = _coerce_scene_id_list(causes)
    if scene_id in cause_ids:
        raise ValueError(f"Scene {scene_id} cannot reference itself in causes")


def _normalise_scene(raw: dict[str, Any]) -> dict[str, Any]:
    scene_id = _coerce_scene_id(raw.get("id"))
    if scene_id is None:
        raise ValueError("Scene IDs must be positive integers")
    raw["id"] = scene_id

    if not isinstance(raw.get("summary"), str):
        raw["summary"] = ""

    for key in (
        "beats",
        "active_characters",
        "passive_characters",
        "sourcebook_entry_ids",
    ):
        if not isinstance(raw.get(key), list):
            raw[key] = []

    raw["causes"] = _coerce_scene_id_list(raw.get("causes"))

    raw.setdefault("scene_time", None)
    timeline_id = raw.get("timeline_id")
    if isinstance(timeline_id, str) and timeline_id.strip():
        raw["timeline_id"] = timeline_id.strip()
    else:
        raw["timeline_id"] = "main"
    raw.setdefault("tag_personal_datetimes", [])

    if not isinstance(raw.get("pinboard_x"), (int, float)):
        raw["pinboard_x"] = 100.0
    if not isinstance(raw.get("pinboard_y"), (int, float)):
        raw["pinboard_y"] = 100.0

    status = raw.get("status")
    if not isinstance(status, str) or not status.strip():
        raw["status"] = "active"

    return raw


def _load_scenes_dict(story: dict[str, Any]) -> dict[SceneId, Any]:
    raw = story.get("scenes", {})
    if isinstance(raw, dict):
        scenes: dict[SceneId, Any] = {}
        for raw_id, scene_data in raw.items():
            scene_id = _coerce_scene_id(raw_id)
            if scene_id is None or not isinstance(scene_data, dict):
                continue
            scenes[scene_id] = {k: v for k, v in scene_data.items() if k != "id"}
        return scenes
    if isinstance(raw, list):
        scenes = {}
        for scene_data in raw:
            if not isinstance(scene_data, dict):
                continue
            scene_id = _coerce_scene_id(scene_data.get("id"))
            if scene_id is None:
                continue
            scenes[scene_id] = {k: v for k, v in scene_data.items() if k != "id"}
        return scenes
    return {}


def _strip_link_computed_fields(link: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v
        for k, v in link.items()
        if k not in ("start_offset", "end_offset", "content_hash", "is_stale")
    }


def _attach_prose_positions(
    scenes: list[dict[str, Any]],
    project_dir: Path,
) -> list[dict[str, Any]]:
    locations = _marker_locations_by_scene(project_dir)
    for scene in scenes:
        link = locations.get(scene["id"])
        scene["prose_link"] = link.copy() if isinstance(link, dict) else None

    return scenes


def _normalize_scope_order_indices(
    scenes_dict: dict[SceneId, Any],
    spans_by_scene: dict[SceneId, SceneSpan],
    links_by_scene: dict[SceneId, dict[str, Any]],
    scope_type: str,
    chapter_id: str | None,
    book_id: str | None,
) -> None:
    # Narrative order is marker-derived from prose file spans.
    # This hook remains for backward-compatible call sites.
    _ = scenes_dict, spans_by_scene, links_by_scene, scope_type, chapter_id, book_id


def _chapter_order_map(story: dict[str, Any]) -> dict[tuple[str | None, str], int]:
    order: dict[tuple[str | None, str], int] = {}
    idx = 0

    chapters = story.get("chapters")
    if isinstance(chapters, list):
        for local_index, chapter in enumerate(chapters, start=1):
            chapter_id = str(local_index)
            if isinstance(chapter, dict) and chapter.get("id"):
                chapter_id = str(chapter.get("id")).strip()
            if chapter_id and (None, chapter_id) not in order:
                order[(None, chapter_id)] = idx
                idx += 1

    books = story.get("books")
    if isinstance(books, list):
        for book in books:
            if not isinstance(book, dict):
                continue
            book_id = str(book.get("id") or book.get("folder") or "").strip() or None
            bchapters = book.get("chapters")
            if not isinstance(bchapters, list):
                continue
            for local_index, chapter in enumerate(bchapters, start=1):
                chapter_id = str(local_index)
                if isinstance(chapter, dict) and chapter.get("id"):
                    chapter_id = str(chapter.get("id")).strip()
                key = (book_id, chapter_id)
                if chapter_id and key not in order:
                    order[key] = idx
                    idx += 1

    return order


def _scene_narrative_sort_key(
    scene: dict[str, Any],
    chapter_order: dict[tuple[str | None, str], int],
) -> tuple[int, int, int, int, int]:
    link = scene.get("prose_link")
    scene_id = int(scene.get("id") or 0)
    if not isinstance(link, dict):
        return (3, 10**9, 10**12, 10**12, scene_id)

    scope_type = str(link.get("scope_type") or "")
    start_offset = link.get("start_offset")
    end_offset = link.get("end_offset")
    start = int(start_offset) if isinstance(start_offset, int) else 10**12
    end = int(end_offset) if isinstance(end_offset, int) else 10**12

    if scope_type == "story":
        return (0, 0, start, end, scene_id)

    if scope_type == "chapter":
        chapter_id = str(link.get("chapter_id") or "").strip()
        book_id_raw = str(link.get("book_id") or "").strip()
        book_id = book_id_raw or None
        chapter_rank = chapter_order.get((book_id, chapter_id), 10**9)
        return (1, chapter_rank, start, end, scene_id)

    if scope_type == UNLINKED_SCOPE_TYPE:
        return (2, 0, start, end, scene_id)

    return (3, 10**9, start, end, scene_id)


def list_scenes(project_dir: Path) -> list[dict[str, Any]]:
    _migrate_project_latest(project_dir)
    story = load_story_config(project_dir / "story.json") or {}
    scenes_dict = _load_scenes_dict(story)
    scenes = [
        _normalise_scene({"id": scene_id, **data})
        for scene_id, data in scenes_dict.items()
    ]
    _attach_prose_positions(scenes, project_dir)
    chapter_order = _chapter_order_map(story)
    return sorted(
        scenes,
        key=lambda s: _scene_narrative_sort_key(s, chapter_order),
    )


def get_scene(project_dir: Path, scene_id: SceneId) -> dict[str, Any] | None:
    _migrate_project_latest(project_dir)
    story = load_story_config(project_dir / "story.json") or {}
    scenes_dict = _load_scenes_dict(story)
    raw = scenes_dict.get(scene_id)
    if raw is None:
        return None
    scene = _normalise_scene({"id": scene_id, **raw})
    _attach_prose_positions([scene], project_dir)
    return scene


def create_scene(project_dir: Path, payload: SceneCreateRequest) -> dict[str, Any]:
    _migrate_project_latest(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    scenes_dict = _load_scenes_dict(story)
    scenes_dict = _inject_runtime_links_into_scenes_dict(scenes_dict, project_dir)
    scene_id = _next_scene_id(scenes_dict)
    data = payload.model_dump(exclude_none=False)
    data.pop("id", None)
    data.pop("order_index", None)
    data["prose_link"] = {
        "scope_type": UNLINKED_SCOPE_TYPE,
        "chapter_id": None,
        "book_id": None,
    }
    _validate_scene_ordering_constraints(scene_id, data.get("causes"))
    scenes_dict[scene_id] = data

    unlinked_path = _scene_content_path(project_dir, data["prose_link"])
    if unlinked_path is None:
        raise ValueError("Cannot resolve internal unlinked prose scope")
    if not unlinked_path.exists():
        unlinked_path.parent.mkdir(parents=True, exist_ok=True)
        _write_text_atomic(unlinked_path, "")

    unlinked_content = _read_validated_marker_content(unlinked_path)
    if unlinked_content and not unlinked_content.endswith("\n"):
        unlinked_content += "\n"
    unlinked_content += f"<!--scene:{scene_id}:start--><!--scene:{scene_id}:end-->\n"
    _write_text_atomic(unlinked_path, unlinked_content)

    story["scenes"] = _drop_prose_links_for_persistence(scenes_dict)
    save_story_config(story_path, story)
    scene = _normalise_scene({"id": scene_id, **data})
    _attach_prose_positions([scene], project_dir)
    return scene


def update_scene(
    project_dir: Path, scene_id: SceneId, payload: SceneUpdateRequest
) -> dict[str, Any] | None:
    _migrate_project_latest(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    scenes_dict = _load_scenes_dict(story)

    if scene_id not in scenes_dict:
        return None

    existing = scenes_dict[scene_id]
    updates = payload.model_dump(exclude_unset=True)
    updates.pop("prose_link", None)
    existing.update(updates)
    _validate_scene_ordering_constraints(scene_id, existing.get("causes"))
    scenes_dict[scene_id] = existing
    story["scenes"] = _drop_prose_links_for_persistence(scenes_dict)
    save_story_config(story_path, story)
    result = _normalise_scene({"id": scene_id, **existing})
    _attach_prose_positions([result], project_dir)
    return result


def delete_scene(project_dir: Path, scene_id: SceneId) -> bool:
    _migrate_project_latest(project_dir)
    _assert_scope_marker_tokens_valid(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    scenes_dict = _load_scenes_dict(story)
    scenes_dict = _inject_runtime_links_into_scenes_dict(scenes_dict, project_dir)

    if scene_id not in scenes_dict:
        return False

    scene_data = scenes_dict[scene_id]
    link = scene_data.get("prose_link")
    if isinstance(link, dict):
        content_path = _scene_content_path(project_dir, link)
        if content_path is not None and content_path.exists():
            try:
                content = _read_validated_marker_content(content_path)
                cleaned = remove_markers(content, {scene_id})
                if cleaned != content:
                    _write_text_atomic(content_path, cleaned)
            except OSError:
                pass

    del scenes_dict[scene_id]
    for data in scenes_dict.values():
        data["causes"] = [
            s for s in _coerce_scene_id_list(data.get("causes")) if s != scene_id
        ]

    story["scenes"] = _drop_prose_links_for_persistence(scenes_dict)
    save_story_config(story_path, story)
    return True


def link_prose(
    project_dir: Path,
    target_scene_id: SceneId,
    request: SceneLinkProseRequest,
) -> list[dict[str, Any]]:
    _migrate_project_latest(project_dir)
    _assert_scope_marker_tokens_valid(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    scenes_dict = _load_scenes_dict(story)
    scenes_dict = _inject_runtime_links_into_scenes_dict(scenes_dict, project_dir)

    if target_scene_id not in scenes_dict:
        raise KeyError(f"Scene {target_scene_id} not found")

    scope_link: dict[str, Any] = {
        "scope_type": request.scope_type,
        "chapter_id": request.chapter_id or None,
        "book_id": request.book_id or None,
    }
    content_path = _scene_content_path(project_dir, scope_link)
    if content_path is None:
        raise ValueError(f"Cannot resolve content path for scope {request.scope_type}")
    if not content_path.exists():
        content_path.parent.mkdir(parents=True, exist_ok=True)
        content_path.write_text("", encoding="utf-8")

    carried_previous_prose = _remove_scene_markers_from_non_target_scopes(
        project_dir,
        target_scene_id,
        content_path,
    )

    content = _read_validated_marker_content(content_path)
    new_start, new_end = snap_range_outside_markers(
        content,
        snap_offset_outside_markers(content, request.start_offset),
        snap_offset_outside_markers(content, request.end_offset),
        {target_scene_id},
    )

    existing_spans = parse_scene_spans(content)
    unlinked_ids: set[SceneId] = set()
    for span in existing_spans:
        if span.scene_id == target_scene_id:
            continue
        if span.start < new_end and span.end > new_start:
            unlinked_ids.add(span.scene_id)

    remove_ids = unlinked_ids | {target_scene_id}
    mapped_start = remap_offset_after_marker_removal(content, new_start, remove_ids)
    mapped_end = remap_offset_after_marker_removal(content, new_end, remove_ids)
    stripped = remove_markers(content, remove_ids)
    if len(stripped) == 0:
        if carried_previous_prose:
            stripped = carried_previous_prose
            mapped_start = 0
            mapped_end = len(stripped)
        else:
            # Preserve truly empty scene prose as a zero-width marker span.
            stripped = ""
            mapped_start = 0
            mapped_end = 0
    linked = inject_markers(stripped, [(target_scene_id, mapped_start, mapped_end)])
    _write_text_atomic(content_path, linked)
    _invalidate_marker_cache(project_dir)

    for sid in unlinked_ids:
        if sid in scenes_dict:
            scenes_dict[sid] = {**scenes_dict[sid], "prose_link": None}

    scenes_dict[target_scene_id] = {
        **scenes_dict[target_scene_id],
        "prose_link": scope_link,
    }

    new_spans = {s.scene_id: s for s in parse_scene_spans(linked)}
    links_by_scene = _marker_locations_by_scene(project_dir)
    target_span = new_spans.get(target_scene_id)
    links_by_scene[target_scene_id] = {
        "scope_type": request.scope_type,
        "chapter_id": request.chapter_id or None,
        "book_id": request.book_id or None,
        "start_offset": target_span.start if target_span else mapped_start,
        "end_offset": target_span.end if target_span else mapped_end,
    }
    _normalize_scope_order_indices(
        scenes_dict,
        new_spans,
        links_by_scene,
        request.scope_type,
        request.chapter_id or None,
        request.book_id or None,
    )

    story["scenes"] = _drop_prose_links_for_persistence(scenes_dict)
    save_story_config(story_path, story)

    affected_ids = unlinked_ids | {target_scene_id}
    result: list[dict[str, Any]] = []
    for sid in affected_ids:
        if sid not in scenes_dict:
            continue
        scene = _normalise_scene({"id": sid, **scenes_dict[sid]})
        _attach_prose_positions([scene], project_dir)
        result.append(scene)
    return result


def relink_scope_prose(
    project_dir: Path,
    scope_type: str,
    chapter_id: str | None,
    book_id: str | None,
    assignments: list[tuple[SceneId, int, int]],
) -> list[dict[str, Any]]:
    """Rewrite all markers for one prose scope in a single pass.

    This is used by scope-wide auto-linking so touching scene boundaries do not
    get replayed through repeated single-scene edits that can split freshly
    inserted markers.

    Scenes in the same scope that are *not* listed in ``assignments`` are
    preserved: their marker positions are remapped from original (marker-
    inclusive) to stripped (marker-free) coordinates and re-injected.
    """
    _migrate_project_latest(project_dir)
    _assert_scope_marker_tokens_valid(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    scenes_dict = _load_scenes_dict(story)
    scenes_dict = _inject_runtime_links_into_scenes_dict(scenes_dict, project_dir)

    scope_link: dict[str, Any] = {
        "scope_type": scope_type,
        "chapter_id": chapter_id or None,
        "book_id": book_id or None,
    }
    content_path = _scene_content_path(project_dir, scope_link)
    if content_path is None:
        raise ValueError(f"Cannot resolve content path for scope {scope_type}")
    if not content_path.exists():
        content_path.parent.mkdir(parents=True, exist_ok=True)
        content_path.write_text("", encoding="utf-8")

    content = _read_validated_marker_content(content_path)

    # Capture original spans for every scene BEFORE stripping markers.
    original_spans: dict[SceneId, SceneSpan] = {}
    for span in parse_scene_spans(content):
        original_spans[span.scene_id] = span

    # Capture annotation spans before stripping so they can be
    # re-injected after scene markers are placed.  The frontend sends
    # offsets in the fully-stripped coordinate space (all internal
    # markers removed), so we must also strip annotation markers
    # before injecting scene markers, then re-inject annotations at
    # positions computed from the fully-stripped space.
    from augmentedquill.services.scenes.scene_markers import (
        _INTERNAL_MARKER_RE as _ALL_MARKERS_RE,
    )

    annotation_spans = list(parse_annotation_spans(content))
    annotation_stripped_positions: list[tuple[str, int, int]] = []

    def _to_fully_stripped(offset: int) -> int:
        """Map a raw-content offset to the fully-stripped coordinate space
        where ALL internal markers (scene + annotation) are removed."""
        clamped = max(0, min(offset, len(content)))
        removed_before = 0
        for m in _ALL_MARKERS_RE.finditer(content):
            if m.end() <= clamped:
                removed_before += m.end() - m.start()
            elif m.start() < clamped:
                removed_before += clamped - m.start()
                break
            else:
                break
        return clamped - removed_before

    for ann_span in annotation_spans:
        ann_start_stripped = _to_fully_stripped(ann_span.start)
        ann_end_stripped = _to_fully_stripped(ann_span.end)
        if ann_start_stripped < ann_end_stripped:
            annotation_stripped_positions.append(
                (ann_span.annotation_id, ann_start_stripped, ann_end_stripped)
            )

    assigned_ids = {scene_id for scene_id, _, _ in assignments}

    # Build the complete injection list: assigned scenes use their
    # provided (already stripped-coordinate) offsets; non-assigned
    # scenes from the same scope have their original offsets remapped
    # to stripped-coordinate space.
    stripped = remove_markers(content)
    # Also strip annotation markers so scene injection positions match
    # the fully-stripped coordinate space.
    stripped = remove_annotation_markers(stripped)
    all_assignments: list[tuple[SceneId, int, int]] = list(assignments)

    for scene_id, scene_data in scenes_dict.items():
        if scene_id in assigned_ids:
            continue
        link = scene_data.get("prose_link")
        if not isinstance(link, dict):
            continue
        if not _same_prose_scope(_strip_link_computed_fields(link), scope_link):
            continue
        span = original_spans.get(scene_id)
        if span is None:
            continue
        remapped_start = _to_fully_stripped(span.start)
        remapped_end = _to_fully_stripped(span.end)
        if remapped_start >= remapped_end:
            continue
        all_assignments.append((scene_id, remapped_start, remapped_end))

    linked = inject_markers(stripped, all_assignments)

    # Re-inject annotation markers.  Positions are computed from the
    # fully-stripped coordinate space and remapped to the linked
    # (scene-injected) space by accounting for the scene marker tokens
    # that were inserted before each annotation position.
    if annotation_stripped_positions:
        # Precompute the total shift at each scene assignment boundary
        # so we can map any stripped position to the linked position.
        # Each scene assignment contributes two marker tokens (start + end).
        marker_lengths: dict[SceneId, tuple[int, int]] = {}
        for sid in {sid for sid, _, _ in all_assignments}:
            from augmentedquill.services.scenes.scene_markers import (
                _marker_token,
                SCENE_LAYER,
            )

            start_tok = _marker_token(SCENE_LAYER, sid, "start")
            end_tok = _marker_token(SCENE_LAYER, sid, "end")
            marker_lengths[sid] = (len(start_tok), len(end_tok))

        # Build a sorted list of injection points: (stripped_pos, delta_len)
        # where delta_len is the number of bytes added at that point.
        injection_points: list[tuple[int, int]] = []
        for sid, start, end in all_assignments:
            slen, elen = marker_lengths.get(sid, (0, 0))
            injection_points.append((start, slen))
            injection_points.append((end, elen))
        injection_points.sort(key=lambda x: x[0])

        def _map_to_linked(stripped_pos: int) -> int:
            """Map a position in the fully-stripped space to the linked
            (scene-injected) content space."""
            result = stripped_pos
            for pt, delta in injection_points:
                if pt <= stripped_pos:
                    result += delta
                else:
                    break
            return result

        snapped_assignments: list[tuple[str, int, int]] = []
        for (
            ann_id,
            ann_start_stripped,
            ann_end_stripped,
        ) in annotation_stripped_positions:
            ann_start = _map_to_linked(ann_start_stripped)
            ann_end = _map_to_linked(ann_end_stripped)

            # Snap outside any internal marker tokens in the linked content
            safe_start = ann_start
            safe_end = ann_end
            for m in _ALL_MARKERS_RE.finditer(linked):
                if m.start() < safe_start < m.end():
                    safe_start = m.end()
                if m.start() < safe_end < m.end():
                    safe_end = m.end()
            if safe_start < safe_end:
                snapped_assignments.append((ann_id, safe_start, safe_end))

        if snapped_assignments:
            linked = inject_annotation_markers(linked, snapped_assignments)

    _write_text_atomic(content_path, linked)
    _invalidate_marker_cache(project_dir)

    # Update story.json: assigned scenes get the scope_link; preserved
    # scenes keep their existing link (unchanged).
    for scene_id in assigned_ids:
        if scene_id in scenes_dict:
            scenes_dict[scene_id] = {
                **scenes_dict[scene_id],
                "prose_link": scope_link,
            }

    new_spans = {span.scene_id: span for span in parse_scene_spans(linked)}
    links_by_scene = _marker_locations_by_scene(project_dir)
    _normalize_scope_order_indices(
        scenes_dict,
        new_spans,
        links_by_scene,
        scope_type,
        chapter_id,
        book_id,
    )

    story["scenes"] = _drop_prose_links_for_persistence(scenes_dict)
    save_story_config(story_path, story)

    # Return all scenes that appear in the new marker set.
    all_ids = {sid for sid, _, _ in all_assignments}
    result: list[dict[str, Any]] = []
    for scene_id in all_ids:
        if scene_id not in scenes_dict:
            continue
        scene = _normalise_scene({"id": scene_id, **scenes_dict[scene_id]})
        _attach_prose_positions([scene], project_dir)
        result.append(scene)
    return result


def unlink_prose(
    project_dir: Path,
    scene_id: SceneId,
) -> list[dict[str, Any]]:
    _migrate_project_latest(project_dir)
    _assert_scope_marker_tokens_valid(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    scenes_dict = _load_scenes_dict(story)
    scenes_dict = _inject_runtime_links_into_scenes_dict(scenes_dict, project_dir)

    if scene_id not in scenes_dict:
        return []

    scene_data = scenes_dict[scene_id]
    existing_link = scene_data.get("prose_link")

    if isinstance(existing_link, dict):
        scope_type = existing_link.get("scope_type", "story")
        chapter_id = existing_link.get("chapter_id") or None
        book_id = existing_link.get("book_id") or None

        content_path = _scene_content_path(project_dir, existing_link)
        if content_path is not None and content_path.exists():
            try:
                content = _read_validated_marker_content(content_path)
                cleaned = remove_markers(content, {scene_id})
                if cleaned != content:
                    _write_text_atomic(content_path, cleaned)
                    content = cleaned
            except OSError:
                content = ""
        else:
            content = ""

        scenes_dict[scene_id] = {**scene_data, "prose_link": None}

        new_spans = {s.scene_id: s for s in parse_scene_spans(content)}
        links_by_scene = _marker_locations_by_scene(project_dir)
        links_by_scene.pop(scene_id, None)
        _normalize_scope_order_indices(
            scenes_dict,
            new_spans,
            links_by_scene,
            scope_type,
            chapter_id,
            book_id,
        )
    else:
        scope_type = "story"
        chapter_id = None
        book_id = None

    story["scenes"] = _drop_prose_links_for_persistence(scenes_dict)
    save_story_config(story_path, story)

    affected_ids: set[SceneId] = {scene_id}
    for sid, sdata in scenes_dict.items():
        link = sdata.get("prose_link")
        if not isinstance(link, dict):
            continue
        if link.get("scope_type") != scope_type:
            continue
        if (link.get("chapter_id") or None) != chapter_id:
            continue
        if (link.get("book_id") or None) != book_id:
            continue
        affected_ids.add(sid)

    result: list[dict[str, Any]] = []
    for sid in affected_ids:
        if sid not in scenes_dict:
            continue
        scene = _normalise_scene({"id": sid, **scenes_dict[sid]})
        _attach_prose_positions([scene], project_dir)
        result.append(scene)
    return result


def update_prose_content(
    project_dir: Path,
    scene_id: SceneId,
    payload: SceneUpdateProseContentRequest,
) -> dict[str, Any] | None:
    _migrate_project_latest(project_dir)
    _assert_scope_marker_tokens_valid(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    scenes_dict = _load_scenes_dict(story)
    scenes_dict = _inject_runtime_links_into_scenes_dict(scenes_dict, project_dir)

    if scene_id not in scenes_dict:
        return None

    scene_data = scenes_dict[scene_id]
    link = scene_data.get("prose_link")
    if not isinstance(link, dict):
        return None

    content_path = _scene_content_path(project_dir, link)
    if content_path is None or not content_path.exists():
        return None

    content = _read_validated_marker_content(content_path)
    spans = {s.scene_id: s for s in parse_scene_spans(content)}
    span = spans.get(scene_id)
    if span is None:
        return None

    new_content = content[: span.start] + payload.text + content[span.end :]
    _write_text_atomic(content_path, new_content)

    scene = _normalise_scene({"id": scene_id, **scene_data})
    _attach_prose_positions([scene], project_dir)
    return scene


def reorder_scene_prose(
    project_dir: Path,
    request: SceneReorderProseRequest,
) -> SceneReorderProseResponse:
    _migrate_project_latest(project_dir)
    _assert_scope_marker_tokens_valid(project_dir)
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    scenes_dict = _load_scenes_dict(story)
    scenes_dict = _inject_runtime_links_into_scenes_dict(scenes_dict, project_dir)

    src_id = request.source_scene_id
    tgt_id = request.target_scene_id

    if src_id == tgt_id:
        raise ValueError("source_scene_id and target_scene_id must be different")

    src_data = scenes_dict.get(src_id)
    tgt_data = scenes_dict.get(tgt_id)
    if src_data is None:
        raise KeyError(f"Source scene {src_id} not found")
    if tgt_data is None:
        raise KeyError(f"Target scene {tgt_id} not found")

    src_link = src_data.get("prose_link")
    tgt_link = tgt_data.get("prose_link")
    if not isinstance(src_link, dict) or not isinstance(tgt_link, dict):
        raise ValueError("Both scenes must have prose links for reordering")

    src_path = _scene_content_path(project_dir, src_link)
    tgt_path = _scene_content_path(project_dir, tgt_link)
    if src_path is None or tgt_path is None:
        raise ValueError("Cannot resolve content file for prose link")

    same_scope = _same_prose_scope(src_link, tgt_link)

    # Load annotation metadata before any reorder so splits can be persisted.
    from augmentedquill.services.annotations.annotation_service import (
        split_straddling_annotations,
    )

    story_ann_meta = (
        story.get("annotations") if isinstance(story.get("annotations"), list) else []
    )

    if same_scope:
        content = _read_validated_marker_content(src_path)
        spans = {s.scene_id: s for s in parse_scene_spans(content)}

        src_span = spans.get(src_id)
        tgt_span = spans.get(tgt_id)
        if src_span is None or tgt_span is None:
            raise ValueError("Markers not found for one or both scenes")

        src_block = scene_block_bounds(content, src_id)
        tgt_block = scene_block_bounds(content, tgt_id)
        if src_block is None or tgt_block is None:
            raise ValueError("Unable to derive scene marker block boundaries")
        src_block_start, src_block_end = src_block
        tgt_block_start, tgt_block_end = tgt_block

        # Save original content properties BEFORE annotation split so that
        # scope_start/scope_end returned to the frontend are valid in the
        # editor's pre-reorder document (the frontend has not yet seen the
        # annotation-split markers).
        old_content_len = len(content)
        orig_scope_start = min(src_block_start, tgt_block_start)
        orig_scope_end = max(src_block_end, tgt_block_end)

        # Split any annotations that straddle the src_block boundary before moving.
        content, story_ann_meta = split_straddling_annotations(
            content, src_block_start, src_block_end, story_ann_meta
        )
        story["annotations"] = story_ann_meta

        # How many bytes were inserted by the annotation split.
        offset_shift = len(content) - old_content_len

        # Re-derive block bounds after any annotation marker insertions.
        src_block_bounds_fresh = scene_block_bounds(content, src_id)
        tgt_block_bounds_fresh = scene_block_bounds(content, tgt_id)
        if src_block_bounds_fresh is None or tgt_block_bounds_fresh is None:
            raise ValueError(
                "Unable to re-derive scene marker block boundaries after annotation split"
            )
        src_block_start, src_block_end = src_block_bounds_fresh
        tgt_block_start, tgt_block_end = tgt_block_bounds_fresh

        src_block = content[src_block_start:src_block_end]

        # Remove source block first, then insert at target boundary in the
        # source-free content. This ensures true placement semantics (adjacent
        # before/after target) even when source and target have blocks between.
        without_src = content[:src_block_start] + content[src_block_end:]

        # Strip any residual source-scene markers from without_src.  Corrupted
        # files from previous failed reorder attempts may contain duplicate
        # start/end markers for the source scene (e.g. an orphaned start that
        # predates the correctly-paired block).  If we don't clean them here
        # the reorder will leave the orphaned fragment in place.
        from augmentedquill.services.scenes.scene_markers import (
            remove_markers as _rm_markers,
        )

        clean_without = _rm_markers(without_src, {src_id})

        spans_without_src = {s.scene_id: s for s in parse_scene_spans(clean_without)}
        tgt_span_after = spans_without_src.get(tgt_id)
        if tgt_span_after is None:
            raise ValueError("Target markers not found after removing source block")

        tgt_block_after = scene_block_bounds(clean_without, tgt_id)
        if tgt_block_after is None:
            raise ValueError("Unable to derive target block boundaries after move")
        tgt_block_start_after, tgt_block_end_after = tgt_block_after
        insert_pos = (
            tgt_block_start_after if request.place_before else tgt_block_end_after
        )

        new_content = (
            clean_without[:insert_pos] + src_block + clean_without[insert_pos:]
        )

        # Use original (pre-split) offsets so the frontend can apply the change
        # to its pre-reorder document.  The rebuilt_text must span the extra
        # annotation-split bytes to produce a correct final document.
        scope_start = orig_scope_start
        scope_end = orig_scope_end
        rebuilt_text = new_content[orig_scope_start : orig_scope_end + offset_shift]
        _write_text_atomic(src_path, new_content)

        new_spans = {s.scene_id: s for s in parse_scene_spans(new_content)}
        _normalize_scope_order_indices(
            scenes_dict,
            new_spans,
            _marker_locations_by_scene(project_dir),
            src_link.get("scope_type", "story"),
            src_link.get("chapter_id") or None,
            src_link.get("book_id") or None,
        )

        story["scenes"] = _drop_prose_links_for_persistence(scenes_dict)
        story["annotations"] = story_ann_meta
        save_story_config(story_path, story)

        affected = []
        for sid in (src_id, tgt_id):
            scene = _normalise_scene({"id": sid, **scenes_dict[sid]})
            _attach_prose_positions([scene], project_dir)
            affected.append(scene)

        return SceneReorderProseResponse(
            scenes=affected,
            scope_type=src_link.get("scope_type", "story"),
            chapter_id=src_link.get("chapter_id") or None,
            book_id=src_link.get("book_id") or None,
            scope_start=scope_start,
            scope_end=scope_end,
            rebuilt_text=rebuilt_text,
        )

    src_content = _read_validated_marker_content(src_path)
    tgt_content = _read_validated_marker_content(tgt_path)

    src_spans = {s.scene_id: s for s in parse_scene_spans(src_content)}
    tgt_spans = {s.scene_id: s for s in parse_scene_spans(tgt_content)}

    src_span = src_spans.get(src_id)
    tgt_span = tgt_spans.get(tgt_id)
    if src_span is None or tgt_span is None:
        raise ValueError("Markers not found for one or both scenes")

    src_prose = src_content[src_span.start : src_span.end]

    src_block = scene_block_bounds(src_content, src_id)
    tgt_block = scene_block_bounds(tgt_content, tgt_id)
    if src_block is None or tgt_block is None:
        raise ValueError("Unable to derive scene marker block boundaries")
    src_block_start, src_block_end = src_block
    tgt_block_start, tgt_block_end = tgt_block
    new_src_content = src_content[:src_block_start] + src_content[src_block_end:]
    _write_text_atomic(src_path, new_src_content)

    insert_pos = tgt_block_start if request.place_before else tgt_block_end
    new_tgt_content = (
        tgt_content[:insert_pos]
        + f"<!--scene:{src_id}:start-->"
        + src_prose
        + f"<!--scene:{src_id}:end-->"
        + tgt_content[insert_pos:]
    )
    _write_text_atomic(tgt_path, new_tgt_content)

    scenes_dict[src_id] = {
        **scenes_dict[src_id],
        "prose_link": _strip_link_computed_fields(tgt_link),
    }

    new_src_spans = {s.scene_id: s for s in parse_scene_spans(new_src_content)}
    new_tgt_spans = {s.scene_id: s for s in parse_scene_spans(new_tgt_content)}
    _normalize_scope_order_indices(
        scenes_dict,
        new_src_spans,
        _marker_locations_by_scene(project_dir),
        src_link.get("scope_type", "story"),
        src_link.get("chapter_id") or None,
        src_link.get("book_id") or None,
    )
    _normalize_scope_order_indices(
        scenes_dict,
        new_tgt_spans,
        _marker_locations_by_scene(project_dir),
        tgt_link.get("scope_type", "story"),
        tgt_link.get("chapter_id") or None,
        tgt_link.get("book_id") or None,
    )

    story["scenes"] = _drop_prose_links_for_persistence(scenes_dict)
    save_story_config(story_path, story)

    affected_scenes = []
    for sid in (src_id, tgt_id):
        scene = _normalise_scene({"id": sid, **scenes_dict[sid]})
        _attach_prose_positions([scene], project_dir)
        affected_scenes.append(scene)

    return SceneReorderProseResponse(
        scenes=affected_scenes,
        scope_type=tgt_link.get("scope_type", "story"),
        chapter_id=tgt_link.get("chapter_id") or None,
        book_id=tgt_link.get("book_id") or None,
        scope_start=0,
        scope_end=len(new_tgt_content),
        rebuilt_text=new_tgt_content,
    )


def reorder_scope_scenes(
    project_dir: Path,
    *,
    scope_type: str,
    chapter_id: str | None,
    book_id: str | None,
    ordered_scene_ids: list[SceneId],
) -> list[dict[str, Any]]:
    """Reorder all scene marker blocks in one prose scope and return positions.

    ``ordered_scene_ids`` must be a complete permutation of the currently linked
    scene IDs in the target scope. This avoids ambiguity when multiple scene
    moves are requested in one operation.
    """
    _migrate_project_latest(project_dir)
    _assert_scope_marker_tokens_valid(project_dir)

    if scope_type not in {"story", "chapter", UNLINKED_SCOPE_TYPE}:
        raise ValueError("scope_type must be one of 'story', 'chapter', or 'unlinked'")
    if scope_type == "chapter" and not (chapter_id or "").strip():
        raise ValueError("chapter_id is required when scope_type='chapter'")
    if scope_type != "chapter" and chapter_id not in (None, ""):
        raise ValueError("chapter_id must be omitted unless scope_type='chapter'")
    if scope_type != "chapter" and book_id not in (None, ""):
        raise ValueError("book_id must be omitted unless scope_type='chapter'")

    scope_link = {
        "scope_type": scope_type,
        "chapter_id": chapter_id or None,
        "book_id": book_id or None,
    }
    content_path = _scene_content_path(project_dir, scope_link)
    if content_path is None:
        raise ValueError(f"Cannot resolve content path for scope {scope_type}")
    if not content_path.exists():
        content_path.parent.mkdir(parents=True, exist_ok=True)
        _write_text_atomic(content_path, "")

    content = _read_validated_marker_content(content_path)
    spans = parse_scene_spans(content)

    linked_in_scope = [span.scene_id for span in spans]
    if not linked_in_scope:
        return []

    current_set = set(linked_in_scope)
    requested_set = set(int(scene_id) for scene_id in ordered_scene_ids)
    if len(ordered_scene_ids) != len(requested_set):
        raise ValueError("ordered_scene_ids must not contain duplicates")
    if current_set != requested_set:
        raise ValueError(
            "ordered_scene_ids must contain exactly the current scope scene IDs"
        )

    block_start_by_id: dict[SceneId, int] = {}
    block_end_by_id: dict[SceneId, int] = {}

    for span in spans:
        start_marker = f"<!--scene:{span.scene_id}:start-->"
        end_marker = f"<!--scene:{span.scene_id}:end-->"
        block_start_by_id[span.scene_id] = span.start - len(start_marker)
        block_end_by_id[span.scene_id] = span.end + len(end_marker)

    first_scene_id = linked_in_scope[0]
    last_scene_id = linked_in_scope[-1]
    region_start = block_start_by_id[first_scene_id]
    region_end = block_end_by_id[last_scene_id]

    # Keep each block together with its following interstitial text, then
    # reorder chunks atomically. This preserves all prose bytes.
    chunk_by_scene_id: dict[SceneId, str] = {}
    for index, scene_id in enumerate(linked_in_scope):
        chunk_start = block_start_by_id[scene_id]
        if index + 1 < len(linked_in_scope):
            next_scene_id = linked_in_scope[index + 1]
            chunk_end = block_start_by_id[next_scene_id]
        else:
            chunk_end = block_end_by_id[scene_id]
        chunk_by_scene_id[scene_id] = content[chunk_start:chunk_end]

    new_region = "".join(
        chunk_by_scene_id[int(scene_id)] for scene_id in ordered_scene_ids
    )
    new_content = content[:region_start] + new_region + content[region_end:]
    if new_content != content:
        _write_text_atomic(content_path, new_content)

    final_spans = parse_scene_spans(new_content)
    positions: list[dict[str, Any]] = []
    for position, span in enumerate(final_spans):
        positions.append(
            {
                "scene_id": span.scene_id,
                "scope_type": scope_type,
                "chapter_id": chapter_id or None,
                "book_id": book_id or None,
                "position": position,
                "start_offset": span.start,
                "end_offset": span.end,
            }
        )

    return positions

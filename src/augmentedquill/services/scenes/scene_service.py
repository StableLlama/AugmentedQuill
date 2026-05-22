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

from augmentedquill.core.config import load_story_config, save_story_config
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
    inject_markers,
    parse_scene_spans,
    remap_offset_after_marker_removal,
    remove_markers,
)
from augmentedquill.updates.migrate_story_v3 import migrate_project_v3
from augmentedquill.updates.migrate_story_v4 import migrate_project_v4


def _migrate_project_latest(project_dir: Path) -> None:
    """Apply all chainable story migrations required by the scene service."""
    migrate_project_v3(project_dir)
    migrate_project_v4(project_dir)


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

    return candidates


def _marker_locations_by_scene(project_dir: Path) -> dict[SceneId, dict[str, Any]]:
    """Return runtime prose-link payloads computed from file markers."""
    locations: dict[SceneId, dict[str, Any]] = {}
    for link, path in _scope_candidates(project_dir):
        if not path.exists():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for span in parse_scene_spans(content):
            if span.end <= span.start:
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
    return locations


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
        payload = {k: v for k, v in scene_data.items() if k != "prose_link"}
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


def _next_scene_order_index(scenes_dict: dict[SceneId, Any]) -> int:
    current = [
        value.get("order_index")
        for value in scenes_dict.values()
        if isinstance(value, dict)
    ]
    numeric = [
        idx for idx in current if isinstance(idx, (int, float)) and idx is not None
    ]
    return int(max(numeric, default=0)) + 1


def _validate_scene_ordering_constraints(
    scene_id: SceneId,
    order_before: object,
    order_after: object,
) -> None:
    before_ids = _coerce_scene_id_list(order_before)
    after_ids = _coerce_scene_id_list(order_after)
    if scene_id in before_ids or scene_id in after_ids:
        raise ValueError(
            f"Scene {scene_id} cannot reference itself in order_before/order_after"
        )


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

    raw["order_before"] = _coerce_scene_id_list(raw.get("order_before"))
    raw["order_after"] = _coerce_scene_id_list(raw.get("order_after"))

    order_index = raw.get("order_index")
    if isinstance(order_index, (int, float)) and order_index is not None:
        raw["order_index"] = float(order_index)
    else:
        raw["order_index"] = None

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
    linked: list[tuple[SceneId, int]] = []
    for scene_id in scenes_dict.keys():
        link = links_by_scene.get(scene_id)
        if not isinstance(link, dict):
            continue
        if link.get("scope_type") != scope_type:
            continue
        if (link.get("chapter_id") or None) != (chapter_id or None):
            continue
        if (link.get("book_id") or None) != (book_id or None):
            continue
        span = spans_by_scene.get(scene_id)
        if span is None:
            continue
        linked.append((scene_id, span.start))

    linked.sort(key=lambda item: item[1])
    for position, (scene_id, _) in enumerate(linked):
        scenes_dict[scene_id]["order_index"] = float(position * 2 + 1)


def list_scenes(project_dir: Path) -> list[dict[str, Any]]:
    _migrate_project_latest(project_dir)
    story = load_story_config(project_dir / "story.json") or {}
    scenes_dict = _load_scenes_dict(story)
    scenes = [
        _normalise_scene({"id": scene_id, **data})
        for scene_id, data in scenes_dict.items()
    ]
    _attach_prose_positions(scenes, project_dir)
    return sorted(
        scenes,
        key=lambda s: (
            s.get("order_index") if s.get("order_index") is not None else float("inf"),
            s.get("pinboard_y", 0),
            s.get("pinboard_x", 0),
        ),
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
    scene_id = _next_scene_id(scenes_dict)
    data = payload.model_dump(exclude_none=False)
    data.pop("id", None)
    if not isinstance(data.get("order_index"), int) or data.get("order_index") == 0:
        data["order_index"] = _next_scene_order_index(scenes_dict)
    _validate_scene_ordering_constraints(
        scene_id,
        data.get("order_before"),
        data.get("order_after"),
    )
    data.pop("prose_link", None)
    scenes_dict[scene_id] = data
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
    _validate_scene_ordering_constraints(
        scene_id,
        existing.get("order_before"),
        existing.get("order_after"),
    )
    scenes_dict[scene_id] = existing
    story["scenes"] = _drop_prose_links_for_persistence(scenes_dict)
    save_story_config(story_path, story)
    result = _normalise_scene({"id": scene_id, **existing})
    _attach_prose_positions([result], project_dir)
    return result


def delete_scene(project_dir: Path, scene_id: SceneId) -> bool:
    _migrate_project_latest(project_dir)
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
                content = content_path.read_text(encoding="utf-8")
                cleaned = remove_markers(content, {scene_id})
                if cleaned != content:
                    _write_text_atomic(content_path, cleaned)
            except OSError:
                pass

    del scenes_dict[scene_id]
    for data in scenes_dict.values():
        data["order_before"] = [
            s for s in _coerce_scene_id_list(data.get("order_before")) if s != scene_id
        ]
        data["order_after"] = [
            s for s in _coerce_scene_id_list(data.get("order_after")) if s != scene_id
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

    content = content_path.read_text(encoding="utf-8")
    new_start = request.start_offset
    new_end = request.end_offset

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
    linked = inject_markers(stripped, [(target_scene_id, mapped_start, mapped_end)])
    _write_text_atomic(content_path, linked)

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
    """
    _migrate_project_latest(project_dir)
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

    content = content_path.read_text(encoding="utf-8")
    stripped = remove_markers(content)
    linked = inject_markers(stripped, assignments)
    _write_text_atomic(content_path, linked)

    assigned_ids = {scene_id for scene_id, _, _ in assignments}
    cleared_ids: set[SceneId] = set()
    for scene_id, scene_data in scenes_dict.items():
        link = scene_data.get("prose_link")
        if not isinstance(link, dict):
            continue
        if not _same_prose_scope(_strip_link_computed_fields(link), scope_link):
            continue
        if scene_id in assigned_ids:
            continue
        scenes_dict[scene_id] = {**scene_data, "prose_link": None}
        cleared_ids.add(scene_id)

    for scene_id in assigned_ids:
        if scene_id not in scenes_dict:
            continue
        scenes_dict[scene_id] = {**scenes_dict[scene_id], "prose_link": scope_link}

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

    affected_ids = cleared_ids | assigned_ids
    result: list[dict[str, Any]] = []
    for scene_id in affected_ids:
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
                content = content_path.read_text(encoding="utf-8")
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

    content = content_path.read_text(encoding="utf-8")
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
    story_path = project_dir / "story.json"
    story = load_story_config(story_path) or {}
    scenes_dict = _load_scenes_dict(story)
    scenes_dict = _inject_runtime_links_into_scenes_dict(scenes_dict, project_dir)

    src_id = request.source_scene_id
    tgt_id = request.target_scene_id

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

    if same_scope:
        content = src_path.read_text(encoding="utf-8")
        spans = {s.scene_id: s for s in parse_scene_spans(content)}

        src_span = spans.get(src_id)
        tgt_span = spans.get(tgt_id)
        if src_span is None or tgt_span is None:
            raise ValueError("Markers not found for one or both scenes")

        src_marker_start = f"<!--scene:{src_id}:start-->"
        src_marker_end = f"<!--scene:{src_id}:end-->"
        tgt_marker_start = f"<!--scene:{tgt_id}:start-->"
        tgt_marker_end = f"<!--scene:{tgt_id}:end-->"

        src_block_start = src_span.start - len(src_marker_start)
        src_block_end = src_span.end + len(src_marker_end)
        tgt_block_start = tgt_span.start - len(tgt_marker_start)
        tgt_block_end = tgt_span.end + len(tgt_marker_end)

        src_block = content[src_block_start:src_block_end]
        tgt_block = content[tgt_block_start:tgt_block_end]

        if src_block_start < tgt_block_start:
            first_start = src_block_start
            first_end = src_block_end
            first_block = src_block
            second_start = tgt_block_start
            second_end = tgt_block_end
            second_block = tgt_block
            source_is_first = True
        else:
            first_start = tgt_block_start
            first_end = tgt_block_end
            first_block = tgt_block
            second_start = src_block_start
            second_end = src_block_end
            second_block = src_block
            source_is_first = False

        middle_text = content[first_end:second_start]
        unchanged_middle = first_block + middle_text + second_block

        if request.place_before:
            if source_is_first:
                rebuilt_text = unchanged_middle
                new_middle = unchanged_middle
            else:
                new_middle = src_block + middle_text + tgt_block
                rebuilt_text = new_middle
        else:
            if not source_is_first:
                rebuilt_text = unchanged_middle
                new_middle = unchanged_middle
            else:
                new_middle = tgt_block + middle_text + src_block
                rebuilt_text = new_middle

        scope_start = first_start
        scope_end = second_end
        new_content = content[:scope_start] + new_middle + content[scope_end:]
        if new_content != content:
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

    src_content = src_path.read_text(encoding="utf-8")
    tgt_content = tgt_path.read_text(encoding="utf-8")

    src_spans = {s.scene_id: s for s in parse_scene_spans(src_content)}
    tgt_spans = {s.scene_id: s for s in parse_scene_spans(tgt_content)}

    src_span = src_spans.get(src_id)
    tgt_span = tgt_spans.get(tgt_id)
    if src_span is None or tgt_span is None:
        raise ValueError("Markers not found for one or both scenes")

    src_prose = src_content[src_span.start : src_span.end]

    src_start_marker = f"<!--scene:{src_id}:start-->"
    src_end_marker = f"<!--scene:{src_id}:end-->"
    src_block_start = src_span.start - len(src_start_marker)
    src_block_end = src_span.end + len(src_end_marker)
    new_src_content = src_content[:src_block_start] + src_content[src_block_end:]
    _write_text_atomic(src_path, new_src_content)

    insert_pos = tgt_span.start if request.place_before else tgt_span.end
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

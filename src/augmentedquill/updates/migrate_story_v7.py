# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Migration: story.json v6 -> v7.

Version 7 removes persisted ``order_index`` from scenes and introduces an
internal unlinked prose scope file (``unlinked.txt``). Scenes without markers
in story/chapter prose files are appended as empty marker spans in
``unlinked.txt`` to keep narrative order marker-derived only.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

_MARKER_RE = re.compile(r"<!--scene:(\d+):(start|end)-->")


def _write_atomic(path: Path, text: str) -> None:
    replaced = False
    temp_path: Path | None = None
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    ) as tmp:
        tmp.write(text)
        temp_path = Path(tmp.name)
    try:
        os.replace(temp_path, path)
        replaced = True
    finally:
        if temp_path is not None and temp_path.exists() and not replaced:
            temp_path.unlink(missing_ok=True)


def _coerce_scene_id(raw_id: object) -> int | None:
    if isinstance(raw_id, int) and raw_id > 0:
        return raw_id
    if isinstance(raw_id, str) and raw_id.isdigit():
        parsed = int(raw_id)
        return parsed if parsed > 0 else None
    return None


def _iter_story_scene_items(story: dict[str, Any]) -> list[tuple[int, dict[str, Any]]]:
    scenes = story.get("scenes")
    items: list[tuple[int, dict[str, Any]]] = []
    if isinstance(scenes, dict):
        for raw_id, scene_data in scenes.items():
            scene_id = _coerce_scene_id(raw_id)
            if scene_id is None or not isinstance(scene_data, dict):
                continue
            items.append((scene_id, scene_data))
    elif isinstance(scenes, list):
        for scene_data in scenes:
            if not isinstance(scene_data, dict):
                continue
            scene_id = _coerce_scene_id(scene_data.get("id"))
            if scene_id is None:
                continue
            items.append((scene_id, scene_data))
    return items


def _candidate_marker_files(project_dir: Path) -> list[Path]:
    files: list[Path] = []

    for filename in ("content.md", "draft.md", "unlinked.txt"):
        files.append(project_dir / filename)

    chapters_dir = project_dir / "chapters"
    if chapters_dir.exists():
        for chapter_file in sorted(chapters_dir.iterdir()):
            if chapter_file.is_file() and chapter_file.suffix in {".txt", ".md"}:
                files.append(chapter_file)

    books_dir = project_dir / "books"
    if books_dir.exists():
        for book_dir in sorted(books_dir.iterdir()):
            if not book_dir.is_dir():
                continue
            chapter_dir = book_dir / "chapters"
            if not chapter_dir.exists():
                continue
            for chapter_file in sorted(chapter_dir.iterdir()):
                if chapter_file.is_file() and chapter_file.suffix in {".txt", ".md"}:
                    files.append(chapter_file)

    seen: set[Path] = set()
    deduped: list[Path] = []
    for path in files:
        if path in seen:
            continue
        seen.add(path)
        deduped.append(path)
    return deduped


def _chapter_marker_files(project_dir: Path) -> list[Path]:
    """Return only chapter-scope marker files (top-level and per-book chapters)."""
    files: list[Path] = []

    chapters_dir = project_dir / "chapters"
    if chapters_dir.exists():
        for chapter_file in sorted(chapters_dir.iterdir()):
            if chapter_file.is_file() and chapter_file.suffix in {".txt", ".md"}:
                files.append(chapter_file)

    books_dir = project_dir / "books"
    if books_dir.exists():
        for book_dir in sorted(books_dir.iterdir()):
            if not book_dir.is_dir():
                continue
            chapter_dir = book_dir / "chapters"
            if not chapter_dir.exists():
                continue
            for chapter_file in sorted(chapter_dir.iterdir()):
                if chapter_file.is_file() and chapter_file.suffix in {".txt", ".md"}:
                    files.append(chapter_file)

    seen: set[Path] = set()
    deduped: list[Path] = []
    for path in files:
        if path in seen:
            continue
        seen.add(path)
        deduped.append(path)
    return deduped


def _scene_ids_from_markers(path: Path) -> set[int]:
    if not path.exists():
        return set()
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return set()
    ids: set[int] = set()
    for match in _MARKER_RE.finditer(content):
        ids.add(int(match.group(1)))
    return ids


def _append_unlinked_markers(project_dir: Path, scene_ids: list[int]) -> bool:
    if not scene_ids:
        return False

    unlinked_path = project_dir / "unlinked.txt"
    content = ""
    if unlinked_path.exists():
        try:
            content = unlinked_path.read_text(encoding="utf-8")
        except OSError:
            content = ""

    existing_ids = _scene_ids_from_markers(unlinked_path)
    to_add = [scene_id for scene_id in scene_ids if scene_id not in existing_ids]
    if not to_add:
        return False

    pieces = [content]
    if content and not content.endswith("\n"):
        pieces.append("\n")

    for scene_id in to_add:
        pieces.append(f"<!--scene:{scene_id}:start--><!--scene:{scene_id}:end-->\n")

    unlinked_path.parent.mkdir(parents=True, exist_ok=True)
    _write_atomic(unlinked_path, "".join(pieces))
    return True


def _append_scenes_missing_from_chapters_to_unlinked(
    project_dir: Path,
    story: dict[str, Any],
    previous_order: dict[int, float],
) -> bool:
    """Append scene markers for scenes absent from all chapter files.

    Robustness rule for chapter-based projects: any scene present in story.json
    but not represented in chapter files is appended to unlinked.txt.
    """
    project_type = str(story.get("project_type") or "").strip().lower()
    if project_type not in {"novel", "series"}:
        return False

    scene_ids = [scene_id for scene_id, _ in _iter_story_scene_items(story)]
    if not scene_ids:
        return False

    chapter_linked_ids: set[int] = set()
    for path in _chapter_marker_files(project_dir):
        chapter_linked_ids.update(_scene_ids_from_markers(path))

    missing_from_chapters = [
        scene_id for scene_id in scene_ids if scene_id not in chapter_linked_ids
    ]
    missing_from_chapters.sort(
        key=lambda scene_id: (previous_order.get(scene_id, float("inf")), scene_id)
    )
    return _append_unlinked_markers(project_dir, missing_from_chapters)


def migrate_project_v7(project_dir: Path) -> None:
    """Migrate story.json from version 6 to 7."""
    story_path = project_dir / "story.json"
    if not story_path.exists():
        return

    try:
        story: dict[str, Any] = json.loads(story_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return

    metadata = story.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        story["metadata"] = metadata

    changed = False

    scene_items = _iter_story_scene_items(story)
    previous_order: dict[int, float] = {}
    for scene_id, scene_data in scene_items:
        order_index = scene_data.get("order_index")
        if isinstance(order_index, (int, float)):
            previous_order[scene_id] = float(order_index)
        if "order_index" in scene_data:
            scene_data.pop("order_index", None)
            changed = True

    linked_scene_ids: set[int] = set()
    for path in _candidate_marker_files(project_dir):
        linked_scene_ids.update(_scene_ids_from_markers(path))

    unlinked_scene_ids = [
        scene_id for scene_id, _ in scene_items if scene_id not in linked_scene_ids
    ]
    unlinked_scene_ids.sort(
        key=lambda scene_id: (previous_order.get(scene_id, float("inf")), scene_id)
    )
    if _append_unlinked_markers(project_dir, unlinked_scene_ids):
        changed = True

    if _append_scenes_missing_from_chapters_to_unlinked(
        project_dir,
        story,
        previous_order,
    ):
        changed = True

    if metadata.get("version") < 7:
        metadata["version"] = 7
        changed = True

    if not changed:
        return

    _write_atomic(story_path, json.dumps(story, indent=2, ensure_ascii=False) + "\n")

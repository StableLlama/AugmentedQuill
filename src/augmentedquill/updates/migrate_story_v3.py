# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Migration: story.json v2 → v3.

Version 3 replaces stored offset-based prose links with inline HTML-comment
markers embedded directly in the prose content files::

    <!--scene:N:start-->prose text<!--scene:N:end-->

The migration:
1. For every scene (and scene beat) in ``story.json`` that carries an old-style
   ``prose_link`` with ``start_offset`` / ``end_offset``, injects the
   corresponding markers into the referenced content file.
2. Strips ``start_offset``, ``end_offset``, ``content_hash``, and ``is_stale``
   from every ``prose_link`` entry.
3. Bumps ``metadata.version`` to 3.
4. Saves the updated ``story.json`` and all modified content files atomically.

The function is a no-op when the project is already at version 3.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def _scene_content_path(
    project_dir: Path,
    link: dict[str, Any],
) -> Path | None:
    """Resolve the content file path for an old-style prose link dict."""
    scope = link.get("scope_type", "story")
    chapter_id = link.get("chapter_id")
    book_id = link.get("book_id")

    if scope == "story":
        return project_dir / "content.md"
    if scope == "chapter":
        if not chapter_id:
            return None
        return project_dir / "chapters" / f"{chapter_id}.md"
    if scope == "book_chapter":
        if not book_id or not chapter_id:
            return None
        return project_dir / "books" / book_id / "chapters" / f"{chapter_id}.md"
    return None


def _write_atomic(path: Path, text: str) -> None:
    """Write *text* to *path* atomically via a temp file."""
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


def migrate_project_v3(project_dir: Path) -> None:
    """Migrate the project at *project_dir* from story.json v2 to v3.

    Safe to call on projects already at version 3 (returns immediately).
    """
    story_path = project_dir / "story.json"
    if not story_path.exists():
        return

    try:
        story: dict[str, Any] = json.loads(story_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return

    version = story.get("metadata", {}).get("version", 0)
    if isinstance(version, int) and version >= 3 and not _contains_prose_link(story):
        return

    # ------------------------------------------------------------------
    # Collect all (scene_id, link) pairs that have old-style offsets.
    # Group injections by target file so we can inject all markers for
    # a single file in one pass (avoiding offset drift).
    # key: absolute Path, value: list of (scene_id, start, end)
    # ------------------------------------------------------------------
    file_injections: dict[Path, list[tuple[int, int, int]]] = {}

    scenes_dict: dict[str, Any] = story.get("scenes") or {}
    for raw_id, scene_data in scenes_dict.items():
        if not isinstance(scene_data, dict):
            continue
        try:
            scene_id = int(raw_id)
        except (ValueError, TypeError):
            continue

        # Scene-level prose_link
        _collect_link_injection(project_dir, scene_data, scene_id, file_injections)

        # Beat-level prose_links (beats are dicts or plain strings)
        beats = scene_data.get("beats") or []
        for beat in beats:
            if isinstance(beat, dict):
                _collect_link_injection(project_dir, beat, scene_id, file_injections)

    # ------------------------------------------------------------------
    # Inject markers into content files (sorted end→start to preserve offsets).
    # ------------------------------------------------------------------
    for file_path, injections in file_injections.items():
        if not file_path.exists():
            continue
        try:
            content = file_path.read_text(encoding="utf-8")
        except OSError:
            continue
        # Sort by start offset descending so earlier offsets stay valid.
        for sid, start, end in sorted(injections, key=lambda t: t[1], reverse=True):
            start = max(0, min(start, len(content)))
            end = max(start, min(end, len(content)))
            start_marker = f"<!--scene:{sid}:start-->"
            end_marker = f"<!--scene:{sid}:end-->"
            content = (
                content[:start]
                + start_marker
                + content[start:end]
                + end_marker
                + content[end:]
            )
        _write_atomic(file_path, content)

    # ------------------------------------------------------------------
    # Strip old offset / hash fields from every prose_link in story.json,
    # then bump the schema version.
    # ------------------------------------------------------------------
    _strip_link_fields(story)
    if not isinstance(story.get("metadata"), dict):
        story["metadata"] = {}
    story["metadata"]["version"] = 3

    _write_atomic(story_path, json.dumps(story, indent=2, ensure_ascii=False) + "\n")


_OBSOLETE_LINK_FIELDS = {"start_offset", "end_offset", "content_hash", "is_stale"}


def _collect_link_injection(
    project_dir: Path,
    container: dict[str, Any],
    scene_id: int,
    file_injections: dict[Path, list[tuple[int, int, int]]],
) -> None:
    """If *container* has an old-style prose_link with offsets, record the injection."""
    link = container.get("prose_link")
    if not isinstance(link, dict):
        return
    start = link.get("start_offset")
    end = link.get("end_offset")
    if not isinstance(start, int):
        return  # no old-style offsets; nothing to inject
    if not isinstance(end, int):
        end = start  # degenerate range; markers will be adjacent
    content_path = _scene_content_path(project_dir, link)
    if content_path is None:
        return
    file_injections.setdefault(content_path, []).append((scene_id, start, end))


def _strip_link_fields(data: Any) -> None:
    """Recursively strip obsolete prose-link fields and remove prose_link keys."""
    if isinstance(data, dict):
        if "prose_link" in data:
            if isinstance(data["prose_link"], dict):
                for field in _OBSOLETE_LINK_FIELDS:
                    data["prose_link"].pop(field, None)
            data.pop("prose_link", None)
        for value in data.values():
            _strip_link_fields(value)
    elif isinstance(data, list):
        for item in data:
            _strip_link_fields(item)


def _contains_prose_link(data: Any) -> bool:
    """Return True when a nested mapping/list still contains a prose_link key."""
    if isinstance(data, dict):
        if "prose_link" in data:
            return True
        return any(_contains_prose_link(value) for value in data.values())
    if isinstance(data, list):
        return any(_contains_prose_link(item) for item in data)
    return False

# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Migration: story.json v7 -> v8.

Version 8 renames sourcebook relation bounds from chapter/book-scoped fields
to scene-scoped bounds while preserving legacy relation data.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


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


def _normalize_relation_bounds(relation: dict[str, Any]) -> bool:
    changed = False

    if "start_scene" not in relation and "start_chapter" in relation:
        start_value = relation.get("start_chapter")
        if isinstance(start_value, int):
            relation["start_scene"] = start_value
            changed = True
        elif isinstance(start_value, str) and start_value.isdigit():
            relation["start_scene"] = int(start_value)
            changed = True

    if "end_scene" not in relation and "end_chapter" in relation:
        end_value = relation.get("end_chapter")
        if isinstance(end_value, int):
            relation["end_scene"] = end_value
            changed = True
        elif isinstance(end_value, str) and end_value.isdigit():
            relation["end_scene"] = int(end_value)
            changed = True

    for legacy_field in (
        "start_chapter",
        "end_chapter",
        "start_book",
        "end_book",
    ):
        if legacy_field in relation:
            relation.pop(legacy_field, None)
            changed = True

    return changed


def migrate_project_v8(project_dir: Path) -> None:
    """Migrate story.json from version 7 to 8."""
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

    relations = story.get("sourcebook_relations")
    if isinstance(relations, list):
        for relation in relations:
            if not isinstance(relation, dict):
                continue
            if _normalize_relation_bounds(relation):
                changed = True

    if metadata.get("version") < 8:
        metadata["version"] = 8
        changed = True

    if not changed:
        return

    _write_atomic(story_path, json.dumps(story, indent=2, ensure_ascii=False) + "\n")

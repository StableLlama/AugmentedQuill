# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Migration: story.json v3 -> v4.

Version 4 introduces explicit timeline identity fields so timeline rendering can
be deterministic:

- Every scene gets ``timeline_id`` (default: ``"main"``).
- Time-travel sourcebook entries that create a new timeline get a stable
  ``timeline_id`` defaulting to ``"branch:<entry_id>"``.
- ``metadata.version`` is bumped to 4.

The migration is idempotent and safe to call repeatedly.
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


def _normalize_timeline_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def _default_branch_timeline_id(entry_id: str) -> str:
    return f"branch:{entry_id}"


def migrate_project_v4(project_dir: Path) -> None:
    """Migrate the project at *project_dir* from story.json v3 to v4."""
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

    version = metadata.get("version", 0)
    if isinstance(version, int) and version >= 4:
        # Ensure deterministic fields still exist even if metadata was bumped.
        pass

    changed = False

    scenes = story.get("scenes")
    if isinstance(scenes, dict):
        for scene_data in scenes.values():
            if not isinstance(scene_data, dict):
                continue
            timeline_id = _normalize_timeline_id(scene_data.get("timeline_id"))
            if timeline_id is None:
                scene_data["timeline_id"] = "main"
                changed = True
            elif scene_data.get("timeline_id") != timeline_id:
                scene_data["timeline_id"] = timeline_id
                changed = True

    sourcebook = story.get("sourcebook")
    if isinstance(sourcebook, dict):
        for entry_id, entry_data in sourcebook.items():
            if not isinstance(entry_data, dict):
                continue

            category = entry_data.get("category")
            creates_new = bool(entry_data.get("creates_new_timeline"))
            if category != "Time Travel" or not creates_new:
                continue

            timeline_id = _normalize_timeline_id(entry_data.get("timeline_id"))
            if timeline_id is None:
                entry_data["timeline_id"] = _default_branch_timeline_id(str(entry_id))
                changed = True
            elif entry_data.get("timeline_id") != timeline_id:
                entry_data["timeline_id"] = timeline_id
                changed = True

    if metadata.get("version") != 4:
        metadata["version"] = 4
        changed = True

    if not changed:
        return

    _write_atomic(story_path, json.dumps(story, indent=2, ensure_ascii=False) + "\n")

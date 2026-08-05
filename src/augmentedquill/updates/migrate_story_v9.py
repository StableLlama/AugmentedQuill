# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Migration: story.json v8 -> v9.

Version 9 introduces a canonical annotations collection in story.json while
keeping inline annotation markers as the source of truth in prose files.
The migration is intentionally minimal: it initializes the structure and
bumps the schema version without rewriting prose content.
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


def migrate_project_v9(project_dir: Path) -> None:
    """Migrate story.json from version 8 to 9."""
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

    if not isinstance(story.get("annotations"), list):
        story["annotations"] = []
        changed = True

    if metadata.get("version") < 9:
        metadata["version"] = 9
        changed = True

    if not changed:
        return

    _write_atomic(story_path, json.dumps(story, indent=2, ensure_ascii=False) + "\n")

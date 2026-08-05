# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Migration: story.json v5 -> v6.

Version 6 normalizes legacy scene ordering fields ``order_before`` and
``order_after`` into the canonical directed ``causes`` relationship.
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


def _coerce_scene_id(raw_id: object) -> int | None:
    if isinstance(raw_id, int) and raw_id > 0:
        return raw_id
    if isinstance(raw_id, str) and raw_id.isdigit():
        parsed = int(raw_id)
        return parsed if parsed > 0 else None
    return None


def _coerce_scene_id_list(raw_ids: object) -> list[int]:
    if not isinstance(raw_ids, list):
        return []
    result: list[int] = []
    for raw_id in raw_ids:
        scene_id = _coerce_scene_id(raw_id)
        if scene_id is not None:
            result.append(scene_id)
    return result


def migrate_project_v6(project_dir: Path) -> None:
    """Migrate story.json from version 5 to 6."""
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

    raw_scenes = story.get("scenes")
    if isinstance(raw_scenes, dict):
        scenes_by_id: dict[int, dict[str, Any]] = {}
        for raw_id, scene_data in raw_scenes.items():
            scene_id = _coerce_scene_id(raw_id)
            if scene_id is None or not isinstance(scene_data, dict):
                continue
            scenes_by_id[scene_id] = scene_data

        causes_by_scene: dict[int, set[int]] = {
            scene_id: set() for scene_id in scenes_by_id
        }
        for scene_id, scene_data in scenes_by_id.items():
            if not isinstance(scene_data, dict):
                continue
            for target_id in _coerce_scene_id_list(scene_data.get("causes")):
                if target_id in causes_by_scene and target_id != scene_id:
                    causes_by_scene[scene_id].add(target_id)
            for target_id in _coerce_scene_id_list(scene_data.get("order_before")):
                if target_id in causes_by_scene and target_id != scene_id:
                    causes_by_scene[scene_id].add(target_id)
            for precursor_id in _coerce_scene_id_list(scene_data.get("order_after")):
                if precursor_id in causes_by_scene and precursor_id != scene_id:
                    causes_by_scene[precursor_id].add(scene_id)

        changed = False
        for scene_id, scene_data in scenes_by_id.items():
            if not isinstance(scene_data, dict):
                continue
            sorted_causes = sorted(causes_by_scene.get(scene_id, []))
            if scene_data.get("causes") != sorted_causes:
                scene_data["causes"] = sorted_causes
                changed = True
            if "order_before" in scene_data:
                scene_data.pop("order_before", None)
                changed = True
            if "order_after" in scene_data:
                scene_data.pop("order_after", None)
                changed = True

        if changed:
            story["scenes"] = raw_scenes
    elif isinstance(raw_scenes, list):
        scenes_by_id: dict[int, dict[str, Any]] = {}
        for scene_data in raw_scenes:
            if not isinstance(scene_data, dict):
                continue
            scene_id = _coerce_scene_id(scene_data.get("id"))
            if scene_id is None:
                continue
            scenes_by_id[scene_id] = scene_data

        causes_by_scene: dict[int, set[int]] = {
            scene_id: set() for scene_id in scenes_by_id
        }
        for scene_id, scene_data in scenes_by_id.items():
            if not isinstance(scene_data, dict):
                continue
            for target_id in _coerce_scene_id_list(scene_data.get("causes")):
                if target_id in causes_by_scene and target_id != scene_id:
                    causes_by_scene[scene_id].add(target_id)
            for target_id in _coerce_scene_id_list(scene_data.get("order_before")):
                if target_id in causes_by_scene and target_id != scene_id:
                    causes_by_scene[scene_id].add(target_id)
            for precursor_id in _coerce_scene_id_list(scene_data.get("order_after")):
                if precursor_id in causes_by_scene and precursor_id != scene_id:
                    causes_by_scene[precursor_id].add(scene_id)

        changed = False
        for scene_id, scene_data in scenes_by_id.items():
            if not isinstance(scene_data, dict):
                continue
            sorted_causes = sorted(causes_by_scene.get(scene_id, []))
            if scene_data.get("causes") != sorted_causes:
                scene_data["causes"] = sorted_causes
                changed = True
            if "order_before" in scene_data:
                scene_data.pop("order_before", None)
                changed = True
            if "order_after" in scene_data:
                scene_data.pop("order_after", None)
                changed = True

        if changed:
            story["scenes"] = raw_scenes
    else:
        changed = False
        if metadata.get("version") < 6:
            metadata["version"] = 6
            changed = True
        if not changed:
            return
        _write_atomic(
            story_path, json.dumps(story, indent=2, ensure_ascii=False) + "\n"
        )
        return

    if metadata.get("version") < 6:
        metadata["version"] = 6
        changed = True

    if not changed:
        return

    _write_atomic(story_path, json.dumps(story, indent=2, ensure_ascii=False) + "\n")

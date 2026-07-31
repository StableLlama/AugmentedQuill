# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Migration: story.json v4 -> v5.

Version 5 normalizes any legacy tuple-style sourcebook relations stored in
``sourcebook_relations`` to the canonical string-based relation format.

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


def _normalize_sourcebook_relation(relation: Any) -> Any:
    if not isinstance(relation, dict):
        return relation

    raw_relation = relation.get("relation")
    if not isinstance(raw_relation, list) or len(raw_relation) != 3:
        return relation

    source, relation_text, target = raw_relation
    if (
        not isinstance(source, str)
        or not isinstance(relation_text, str)
        or not isinstance(target, str)
    ):
        return relation

    normalized = dict(relation)
    normalized["relation"] = relation_text.strip()
    if not normalized.get("source_id"):
        normalized["source_id"] = source.strip()
    if not normalized.get("target_id"):
        normalized["target_id"] = target.strip()
    return normalized


def migrate_project_v5(project_dir: Path) -> None:
    """Migrate the project at *project_dir* from story.json v4 to v5."""
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

    sourcebook_relations = story.get("sourcebook_relations")
    if isinstance(sourcebook_relations, list):
        normalized_relations: list[Any] = []
        for relation in sourcebook_relations:
            normalized = _normalize_sourcebook_relation(relation)
            if normalized is not relation:
                changed = True
            normalized_relations.append(normalized)
        if changed:
            story["sourcebook_relations"] = normalized_relations

    if metadata.get("version") != 5:
        metadata["version"] = 5
        changed = True

    if not changed:
        return

    _write_atomic(story_path, json.dumps(story, indent=2, ensure_ascii=False) + "\n")

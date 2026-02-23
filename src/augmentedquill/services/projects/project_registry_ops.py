# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the project registry ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List


def load_registry_from_path(registry_path: Path) -> Dict:
    """Load Registry From Path."""
    if not registry_path.exists():
        return {"current": "", "recent": []}
    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))
    except Exception:
        return {"current": "", "recent": []}
    cur = data.get("current") or ""
    recent = data.get("recent") or []
    if not isinstance(recent, list):
        recent = []
    recent = [str(item) for item in recent if isinstance(item, (str, Path))]
    return {
        "current": str(cur) if isinstance(cur, (str, Path)) else "",
        "recent": recent,
    }


def save_registry_to_path(registry_path: Path, current: str, recent: List[str]) -> None:
    """Save Registry To Path."""
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    seen = set()
    deduped: List[str] = []
    for path_value in [current] + recent:
        path_str = str(path_value)
        if path_str and path_str not in seen:
            seen.add(path_str)
            deduped.append(path_str)
    final_list = deduped[:5]
    payload = {"current": current, "recent": final_list}
    registry_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def set_active_project_in_registry(
    registry_path: Path,
    project_path: Path,
    current_registry: Dict,
) -> tuple[str, List[str]]:
    """Set Active Project In Registry."""
    current = str(project_path)
    recent: List[str] = []
    for item in current_registry.get("recent", []) or []:
        if not item:
            continue
        try:
            if str(item) == current:
                continue
        except Exception:
            pass
        recent.append(str(item))
    return current, [current] + recent


def get_active_project_dir_from_registry(current_registry: Dict) -> Path | None:
    """Get Active Project Dir From Registry."""
    cur = current_registry.get("current") or ""
    if cur:
        try:
            path = Path(cur)
            if path.is_absolute():
                return path
        except Exception:
            pass
    return None

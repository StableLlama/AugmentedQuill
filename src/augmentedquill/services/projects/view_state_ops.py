# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""View state persistence operations.

Provides load/save helpers for a per-project ``view_state.json`` file that
tracks transient UI state such as the last open chapter, scroll position,
workspace mode (page/scenes/split), and scenes view type (narrative/pinboard/…).

The file is stored alongside ``story.json`` inside each project directory and
is purely optional — missing or corrupt files return safe defaults.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

_DEFAULT_VIEW_STATE: Dict[str, Any] = {
    "current_chapter_id": None,
    "scroll_position": 0,
    "workspace_mode": "page",
    "scenes_view_type": "narrative",
}

_VIEW_STATE_FILENAME = "view_state.json"


def _view_state_path(project_dir: Path) -> Path:
    """Return the path to the view_state.json inside *project_dir*."""
    return project_dir / _VIEW_STATE_FILENAME


def load_view_state(project_dir: Path) -> Dict[str, Any]:
    """Load view state from ``project_dir/view_state.json``.

    Returns a dict with keys from ``_DEFAULT_VIEW_STATE`` — any missing
    keys in the on-disk file are filled from defaults.  Returns a full
    default dict when the file is missing, empty, or contains invalid JSON.
    """
    vs_path = _view_state_path(project_dir)
    if not vs_path.exists():
        return dict(_DEFAULT_VIEW_STATE)

    try:
        raw = vs_path.read_text(encoding="utf-8")
        if not raw.strip():
            return dict(_DEFAULT_VIEW_STATE)
        data: Dict[str, Any] = json.loads(raw)
    except (json.JSONDecodeError, OSError):
        return dict(_DEFAULT_VIEW_STATE)

    # Fill missing keys from defaults while preserving stored values
    result = dict(_DEFAULT_VIEW_STATE)
    result.update(data)
    return result


def save_view_state(project_dir: Path, view_state: Dict[str, Any]) -> None:
    """Persist *view_state* to ``project_dir/view_state.json``.

    Creates the file atomically (write-then-rename) to avoid partial writes.
    """
    vs_path = _view_state_path(project_dir)
    vs_path.parent.mkdir(parents=True, exist_ok=True)

    tmp = vs_path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(view_state, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    tmp.replace(vs_path)

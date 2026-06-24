# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Tests for view state persistence operations.

Verifies that per-project view state (last chapter, scroll position,
workspace mode, scenes view type) can be saved and loaded correctly,
with sensible defaults when the file is missing or corrupt.
"""

import json
import tempfile
from pathlib import Path
from unittest import TestCase

from augmentedquill.services.projects.view_state_ops import (
    load_view_state,
    save_view_state,
)


class ViewStateOpsTest(TestCase):
    """Tests for load/save view state from a project directory."""

    def test_load_view_state_missing_file_returns_defaults(self):
        """A non-existent view_state.json should return sensible defaults."""
        with tempfile.TemporaryDirectory() as td:
            project_dir = Path(td)
            state = load_view_state(project_dir)
            self.assertIsNone(state.get("current_chapter_id"))
            self.assertEqual(state.get("scroll_position"), 0)
            self.assertEqual(state.get("workspace_mode"), "page")
            self.assertEqual(state.get("scenes_view_type"), "narrative")

    def test_load_view_state_invalid_json_returns_defaults(self):
        """Corrupt view_state.json should return sensible defaults."""
        with tempfile.TemporaryDirectory() as td:
            vs_path = Path(td) / "view_state.json"
            vs_path.write_text("{bad json", encoding="utf-8")
            state = load_view_state(project_dir=Path(td))
            self.assertIsNone(state.get("current_chapter_id"))
            self.assertEqual(state.get("workspace_mode"), "page")
            self.assertEqual(state.get("scenes_view_type"), "narrative")

    def test_save_and_load_view_state_roundtrip(self):
        """Saved view state should be read back faithfully."""
        with tempfile.TemporaryDirectory() as td:
            project_dir = Path(td)
            expected = {
                "current_chapter_id": "chapter-42",
                "scroll_position": 1234,
                "workspace_mode": "scenes",
                "scenes_view_type": "convergence-map",
            }
            save_view_state(project_dir, expected)
            loaded = load_view_state(project_dir)
            self.assertEqual(loaded, expected)

    def test_save_and_load_view_state_minimal(self):
        """A minimal view state with only some fields should still roundtrip."""
        with tempfile.TemporaryDirectory() as td:
            project_dir = Path(td)
            expected = {
                "current_chapter_id": None,
                "scroll_position": 0,
                "workspace_mode": "page",
                "scenes_view_type": "narrative",
            }
            save_view_state(project_dir, expected)
            loaded = load_view_state(project_dir)
            self.assertEqual(loaded, expected)

    def test_save_view_state_roundtrip_preserves_extra_keys(self):
        """Unknown extra keys in saved state are preserved on roundtrip."""
        with tempfile.TemporaryDirectory() as td:
            project_dir = Path(td)
            state = {
                "current_chapter_id": "ch-1",
                "scroll_position": 99,
                "workspace_mode": "split",
                "scenes_view_type": "pinboard",
                "future_field": "should survive",
            }
            save_view_state(project_dir, state)
            loaded = load_view_state(project_dir)
            self.assertEqual(loaded["future_field"], "should survive")

    def test_load_view_state_missing_keys_get_defaults(self):
        """A partial view_state.json should fill missing keys with defaults."""
        with tempfile.TemporaryDirectory() as td:
            vs_path = Path(td) / "view_state.json"
            vs_path.write_text(
                json.dumps({"current_chapter_id": "ch-1"}), encoding="utf-8"
            )
            state = load_view_state(project_dir=Path(td))
            self.assertEqual(state["current_chapter_id"], "ch-1")
            self.assertEqual(state["scroll_position"], 0)
            self.assertEqual(state["workspace_mode"], "page")
            self.assertEqual(state["scenes_view_type"], "narrative")

    def test_save_view_state_writes_to_correct_path(self):
        """save_view_state should write to project_dir/view_state.json."""
        with tempfile.TemporaryDirectory() as td:
            project_dir = Path(td)
            state = {
                "current_chapter_id": "ch-abc",
                "scroll_position": 567,
                "workspace_mode": "scenes",
                "scenes_view_type": "narrative",
            }
            save_view_state(project_dir, state)
            vs_path = project_dir / "view_state.json"
            self.assertTrue(vs_path.exists())
            raw = json.loads(vs_path.read_text(encoding="utf-8"))
            self.assertEqual(raw["current_chapter_id"], "ch-abc")
            self.assertEqual(raw["scroll_position"], 567)

    def test_load_view_state_empty_file_returns_defaults(self):
        """An empty view_state.json file should return defaults."""
        with tempfile.TemporaryDirectory() as td:
            vs_path = Path(td) / "view_state.json"
            vs_path.write_text("", encoding="utf-8")
            state = load_view_state(project_dir=Path(td))
            self.assertIsNone(state.get("current_chapter_id"))
            self.assertEqual(state.get("workspace_mode"), "page")

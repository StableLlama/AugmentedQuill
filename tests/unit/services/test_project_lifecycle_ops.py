# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test project lifecycle ops unit so this responsibility stays isolated, testable, and easy to evolve."""

import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

from augmentedquill.services.projects.project_lifecycle_ops import (
    create_project_under_root,
    delete_project_under_root,
    initialize_project_dir_data,
    list_projects_under_root,
    select_project_under_root,
    validate_project_dir_data,
)


class ProjectLifecycleOpsTest(TestCase):
    def test_validate_project_dir_data_states(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self.assertEqual(
                validate_project_dir_data(root / "missing"), (False, "does_not_exist")
            )

            empty = root / "empty"
            empty.mkdir()
            self.assertEqual(validate_project_dir_data(empty), (False, "empty"))

            broken = root / "broken"
            broken.mkdir()
            (broken / "story.json").write_text("{bad", encoding="utf-8")
            self.assertEqual(
                validate_project_dir_data(broken), (False, "invalid_story_json")
            )

    def test_initialize_project_dir_data_creates_expected_layout(self):
        with tempfile.TemporaryDirectory() as td:
            novel = Path(td) / "novel"
            initialize_project_dir_data(
                novel, "N", "novel", "2026-01-01T00:00:00", "es"
            )
            self.assertTrue((novel / "chapters").exists())
            self.assertTrue((novel / "story.json").exists())

            short_story = Path(td) / "short"
            initialize_project_dir_data(
                short_story, "S", "short-story", "2026-01-01T00:00:00", "en"
            )
            self.assertTrue((short_story / "content.md").exists())

            series = Path(td) / "series"
            initialize_project_dir_data(
                series, "R", "series", "2026-01-01T00:00:00", "en"
            )
            self.assertTrue((series / "books").exists())

    def test_create_project_under_root_sanitizes_name_and_handles_conflicts(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)

            def init_project(path, title, ptype, language):
                initialize_project_dir_data(
                    path, title, ptype, "2026-01-01T00:00:00", language
                )

            def validate_project(path):
                ok, reason = validate_project_dir_data(path)
                return SimpleNamespace(is_valid=ok, reason=reason)

            ok, _msg, first = create_project_under_root(
                "Bad/Name", "novel", root, init_project, validate_project, "en"
            )
            self.assertTrue(ok)
            assert first is not None
            self.assertEqual(first.name, "Bad_Name")

            ok2, _msg2, second = create_project_under_root(
                "Bad/Name", "novel", root, init_project, validate_project, "en"
            )
            self.assertTrue(ok2)
            assert second is not None
            self.assertNotEqual(first, second)

    def test_create_project_under_root_trims_whitespace(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)

            def init_project(path, title, ptype, language):
                initialize_project_dir_data(
                    path, title, ptype, "2026-01-01T00:00:00", language
                )

            def validate_project(path):
                ok, reason = validate_project_dir_data(path)
                return SimpleNamespace(is_valid=ok, reason=reason)

            ok, msg, project_path = create_project_under_root(
                "  The Boarding School  ",
                "novel",
                root,
                init_project,
                validate_project,
                "en",
            )
            self.assertTrue(ok, msg)
            assert project_path is not None
            self.assertEqual(project_path.name, "The Boarding School")

    def test_select_project_under_root_paths(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)

            def init_project(path, title, ptype):
                initialize_project_dir_data(
                    path, title, ptype, "2026-01-01T00:00:00", "en"
                )

            def validate_project(path):
                ok, reason = validate_project_dir_data(path)
                return SimpleNamespace(is_valid=ok, reason=reason)

            ok, _msg, path = select_project_under_root(
                "new", root, init_project, validate_project
            )
            self.assertTrue(ok)
            assert path is not None
            self.assertTrue(path.exists())

            bad_file = root / "not-dir"
            bad_file.write_text("x", encoding="utf-8")
            ok2, msg2, _ = select_project_under_root(
                "not-dir", root, init_project, validate_project
            )
            self.assertFalse(ok2)
            self.assertIn("not a directory", msg2)

    def test_list_and_delete_project_under_root(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            initialize_project_dir_data(root / "p1", "One", "novel", "2026", "en")

            items = list_projects_under_root(
                root,
                lambda p: SimpleNamespace(is_valid=validate_project_dir_data(p)[0]),
            )
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["name"], "p1")

            ok, msg, current, recent = delete_project_under_root(
                "p1",
                root,
                {
                    "current": str(root / "p1"),
                    "recent": [str(root / "p1"), str(root / "x")],
                },
            )
            self.assertTrue(ok)
            self.assertEqual(msg, "Project deleted")
            self.assertEqual(current, "")
            self.assertEqual(recent, [str(root / "x")])

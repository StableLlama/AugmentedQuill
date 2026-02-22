# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the test conflicts unit so this responsibility stays isolated, testable, and easy to evolve.

import os
import tempfile
import json
from pathlib import Path
from unittest import TestCase
from augmentedquill.services.projects.projects import (
    select_project,
    add_chapter_conflict,
    update_chapter_conflict,
    remove_chapter_conflict,
    reorder_chapter_conflicts,
)
from augmentedquill.core.config import load_story_config


class ConflictsTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        # Setup a project
        self.project_name = "test_conflicts"
        self.project_dir = self.projects_root / self.project_name
        self.project_dir.mkdir()
        (self.project_dir / "story.json").write_text(
            json.dumps(
                {
                    "metadata": {"version": 2},
                    "project_title": "Conflict Test",
                    "chapters": [{"title": "Chapter 1", "filename": "0001.txt"}],
                }
            ),
            encoding="utf-8",
        )
        (self.project_dir / "chapters").mkdir()
        (self.project_dir / "chapters" / "0001.txt").write_text(
            "Content", encoding="utf-8"
        )
        select_project(self.project_name)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def test_conflict_operations(self):
        chap_id = 1

        # 1. Add conflict
        add_chapter_conflict(chap_id, "Conflict A", "Resolution A")
        story = load_story_config(self.project_dir / "story.json")
        conflicts = story["chapters"][0]["conflicts"]
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["description"], "Conflict A")

        # 2. Add second conflict at index 0 (insert)
        add_chapter_conflict(chap_id, "Conflict B", "Resolution B", index=0)
        story = load_story_config(self.project_dir / "story.json")
        conflicts = story["chapters"][0]["conflicts"]
        self.assertEqual(len(conflicts), 2)
        self.assertEqual(conflicts[0]["description"], "Conflict B")
        self.assertEqual(conflicts[1]["description"], "Conflict A")

        # 3. Update conflict
        update_chapter_conflict(chap_id, 1, description="Conflict A Updated")
        story = load_story_config(self.project_dir / "story.json")
        conflicts = story["chapters"][0]["conflicts"]
        self.assertEqual(conflicts[1]["description"], "Conflict A Updated")

        # 4. Reorder
        reorder_chapter_conflicts(chap_id, [1, 0])
        story = load_story_config(self.project_dir / "story.json")
        conflicts = story["chapters"][0]["conflicts"]
        self.assertEqual(conflicts[0]["description"], "Conflict A Updated")
        self.assertEqual(conflicts[1]["description"], "Conflict B")

        # 5. Remove
        remove_chapter_conflict(chap_id, 0)
        story = load_story_config(self.project_dir / "story.json")
        conflicts = story["chapters"][0]["conflicts"]
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["description"], "Conflict B")

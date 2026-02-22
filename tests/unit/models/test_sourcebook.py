# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the test sourcebook unit so this responsibility stays isolated, testable, and easy to evolve.

import tempfile
import os
from pathlib import Path
from unittest import TestCase
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    sb_create,
    sb_get,
    sb_search,
    sb_delete,
)


class SourcebookTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)

        # Setup mock project environment
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True)

        self.proj_dir = self.projects_root / "test_proj"
        self.proj_dir.mkdir()

        story = {
            "metadata": {"version": 2},
            "project_title": "Test Project",
            "format": "markdown",
            "project_type": "novel",
            "sourcebook": [],
        }
        with open(self.proj_dir / "story.json", "w") as f:
            import json

            json.dump(story, f)

        # Mock environment vars
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)

        # Mock get_active_project_dir via MonkeyPatching not easily done in unittest without mock lib
        # But wait, augmentedquill.services.projects.projects.get_active_project_dir uses AUGQ_PROJECTS_REGISTRY
        # I need to set up the registry to point to our test project.

        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        registry = {"current": str(self.proj_dir.resolve()), "recent": []}
        with open(self.registry_path, "w") as f:
            import json

            json.dump(registry, f)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)

    def test_sourcebook_features(self):
        # 1. Create
        entry = sb_create(
            name="Test Character",
            description="A test character description.",
            category="character",
            synonyms=["Tester", "TC"],
        )

        self.assertEqual(entry["name"], "Test Character")
        self.assertEqual(entry["category"], "character")
        self.assertIn("Tester", entry["synonyms"])

        # 2. Get
        fetched = sb_get(entry["id"])
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["name"], "Test Character")

        fetched_by_name = sb_get("Test Character")
        self.assertEqual(fetched_by_name["id"], entry["id"])

        fetched_by_synonym = sb_get("Tester")
        self.assertEqual(fetched_by_synonym["id"], entry["id"])

        # 3. Search
        results = sb_search("Tester")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], entry["id"])

        results_desc = sb_search("description")
        self.assertEqual(len(results_desc), 1)

        # 4. Delete
        deleted = sb_delete(entry["id"])
        self.assertTrue(deleted)

        self.assertIsNone(sb_get(entry["id"]))

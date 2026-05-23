# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test sourcebook unit so this responsibility stays isolated, testable, and easy to evolve."""

import tempfile
import os
from pathlib import Path
from unittest import TestCase
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    sourcebook_add_relation,
    sourcebook_create_entry,
    sourcebook_get_entry,
    sourcebook_search_entries,
    sourcebook_delete_entry,
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
        entry = sourcebook_create_entry(
            name="Test Character",
            description="A test character description.",
            category="character",
            synonyms=["Tester", "TC"],
        )

        self.assertEqual(entry["name"], "Test Character")
        self.assertEqual(entry["category"], "Character")
        self.assertIn("Tester", entry["synonyms"])

        # 2. Get
        fetched = sourcebook_get_entry(entry["id"])
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["name"], "Test Character")

        fetched_by_name = sourcebook_get_entry("Test Character")
        self.assertEqual(fetched_by_name["id"], entry["id"])

        fetched_by_synonym = sourcebook_get_entry("Tester")
        self.assertEqual(fetched_by_synonym["id"], entry["id"])

        # 3. Search
        results = sourcebook_search_entries("Tester")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], entry["id"])

        # Extensive matching is based on name/synonyms/keywords, not raw description text.
        results_desc = sourcebook_search_entries("description")
        self.assertEqual(len(results_desc), 0)

        # 4. Delete
        deleted = sourcebook_delete_entry(entry["id"])
        self.assertTrue(deleted)

        self.assertIsNone(sourcebook_get_entry(entry["id"]))

    def test_sourcebook_relation_uses_integer_scene_bounds(self):
        first = sourcebook_create_entry(
            name="FirstCharacter",
            description="A test character.",
            category="character",
            synonyms=["First"],
        )
        second = sourcebook_create_entry(
            name="SecondCharacter",
            description="Another test character.",
            category="character",
            synonyms=["Second"],
        )

        result = sourcebook_add_relation(
            source_id=first["id"],
            relation_type="knows",
            target_id=second["id"],
            start_scene=1,
            end_scene=2,
        )

        self.assertTrue(result.get("ok"))
        entry = sourcebook_get_entry(first["id"])
        self.assertIsNotNone(entry)
        relations = entry.get("relations") or []
        self.assertEqual(len(relations), 1)
        self.assertEqual(relations[0].get("start_scene"), 1)
        self.assertEqual(relations[0].get("end_scene"), 2)
        self.assertNotIn("start_chapter", relations[0])
        self.assertNotIn("end_chapter", relations[0])

    def test_sourcebook_relation_rejects_string_scene_ids(self):
        first = sourcebook_create_entry(
            name="FirstCharacter",
            description="A test character.",
            category="character",
            synonyms=["First"],
        )
        second = sourcebook_create_entry(
            name="SecondCharacter",
            description="Another test character.",
            category="character",
            synonyms=["Second"],
        )

        result = sourcebook_add_relation(
            source_id=first["id"],
            relation_type="knows",
            target_id=second["id"],
            start_scene="1",
            end_scene="2",
        )

        self.assertIn("error", result)
        self.assertEqual(
            result["error"], "Invalid start_scene: scene IDs must be integers."
        )

    def test_sourcebook_relation_accepts_integer_scene_ids(self):
        first = sourcebook_create_entry(
            name="FirstCharacter",
            description="A test character.",
            category="character",
            synonyms=["First"],
        )
        second = sourcebook_create_entry(
            name="SecondCharacter",
            description="Another test character.",
            category="character",
            synonyms=["Second"],
        )

        result = sourcebook_add_relation(
            source_id=first["id"],
            relation_type="knows",
            target_id=second["id"],
            start_scene=1,
            end_scene=2,
        )

        self.assertTrue(result.get("ok"))
        entry = sourcebook_get_entry(first["id"])
        self.assertIsNotNone(entry)
        relations = entry.get("relations") or []
        self.assertEqual(len(relations), 1)
        self.assertEqual(relations[0].get("start_scene"), 1)
        self.assertEqual(relations[0].get("end_scene"), 2)
        self.assertNotIn("start_chapter", relations[0])
        self.assertNotIn("end_chapter", relations[0])

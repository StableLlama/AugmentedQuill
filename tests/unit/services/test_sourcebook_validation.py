# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test sourcebook validation unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase

from augmentedquill.core.config import (
    CURRENT_SCHEMA_VERSION,
    _get_story_schema,
    load_story_config,
)
from augmentedquill.services.chat.chat_tool_decorator import (
    ensure_tool_registry_loaded,
    get_tool_function,
)
from augmentedquill.services.projects.projects import select_project
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    sourcebook_create_entry,
    sourcebook_delete_entry,
    sourcebook_get_entry,
    sourcebook_refresh_entry_keywords,
    sourcebook_update_entry,
)
from augmentedquill.services.story.config_story_ops import (
    normalize_validate_story_config,
)


class SourcebookValidationTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"

        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        # Create test project
        self.pdir = self.projects_root / "test_proj"
        self.pdir.mkdir(parents=True, exist_ok=True)
        (self.pdir / "story.json").write_text(
            '{"metadata": {"version": 2}, "project_title": "Test Project", "format": "markdown", "sourcebook": {}}'
        )

        # Select it (creates registry entry)
        select_project("test_proj")

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def test_create_invalid_entry_returns_error(self):
        # Category is now mandatory, so we must provide it to test other fields
        result = sourcebook_create_entry(
            name=None, description="Valid desc", category="Character"
        )
        if "error" in result:
            self.assertIn("error", result)
        else:
            entries = self._get_entries()
            if len(entries) > 0 and entries[0]["name"] is None:
                self.fail(
                    "Bug reproduced: Invalid sourcebook entry created with name=None"
                )

    def test_create_entry_with_null_description_returns_error(self):
        result = sourcebook_create_entry(
            name="Valid Name", description=None, category="Character"
        )
        if "error" in result:
            self.assertIn("error", result)
        else:
            entries = self._get_entries()
            if len(entries) > 0 and entries[0]["description"] is None:
                self.fail(
                    "Bug reproduced: Invalid sourcebook entry created with description=None"
                )

    def test_create_entry_with_invalid_category_returns_error(self):
        result = sourcebook_create_entry(
            name="Valid Name", description="Valid", category=123
        )
        if "error" in result:
            self.assertIn("error", result)
        else:
            self.fail("Should create error for numeric category")

    def test_create_entry_with_unknown_category_returns_error(self):
        result = sourcebook_create_entry(
            name="Valid Name", description="Valid", category="NotARealCategory"
        )
        self.assertIn("error", result)

    def test_create_entry_with_invalid_synonyms_returns_error(self):
        result = sourcebook_create_entry(
            name="Valid Name",
            description="Valid",
            category="Character",
            synonyms="not a list",
        )
        if "error" in result:
            self.assertIn("error", result)
        else:
            self.fail("Should create error for non-list synonyms")

    def test_create_entry_with_invalid_images_returns_error(self):
        result = sourcebook_create_entry(
            name="Valid Name Images",
            description="Valid",
            category="Character",
            images="not a list",
        )
        if "error" in result:
            self.assertIn("error", result)
        else:
            self.fail("Should create error for non-list images")

    def test_create_entry_with_none_images_returns_error(self):
        result = sourcebook_create_entry(
            name="Valid Name Images 2",
            description="Valid",
            category="Character",
            images=None,
        )
        if "error" in result:
            self.assertIn("error", result)
        else:
            entries = self._get_entries()
            val = entries[0]["images"]
            if val is None:
                self.fail("Bug: images is None in database")
            else:
                self.fail(f"Bug: images is {val}")

    def test_create_entry_with_invalid_image_type_inside_list_returns_error(self):
        result = sourcebook_create_entry(
            name="Valid Name Images 3",
            description="Valid",
            category="Character",
            images=[123, "img1"],
        )
        if "error" in result:
            self.assertIn("error", result)
        else:
            self.fail("Should create error for non-string image in list")

    def test_create_entry_with_none_synonyms_returns_error(self):
        result = sourcebook_create_entry(
            name="Valid Name",
            description="Valid",
            category="Character",
            synonyms=None,
        )
        if "error" in result:
            self.assertIn("error", result)
        else:
            entries = self._get_entries()
            val = entries[0]["synonyms"]
            if val is None:
                self.fail("Bug: synonyms is None in database")
            else:
                self.fail(f"Bug: synonyms is {val}")

    def test_delete_entry_with_none_returns_false_safe(self):
        try:
            result = sourcebook_delete_entry(None)
            self.assertFalse(result)
        except AttributeError:
            self.fail("sourcebook_delete_entry crashed on None input")

    def test_get_entry_with_none_returns_none_safe(self):
        try:
            result = sourcebook_get_entry(None)
            self.assertIsNone(result)
        except AttributeError:
            self.fail("sourcebook_get_entry crashed on None input")

    def test_create_requires_category(self):
        result = sourcebook_create_entry(
            name="Valid Name", description="Valid", category=None
        )
        if "error" in result:
            self.assertIn("error", result)
        else:
            self.fail("Bug: Created entry without category")

    def test_update_success(self):
        # Create valid entry
        entry = sourcebook_create_entry("UpdateTarget", "Desc", "Character")
        self.assertNotIn("error", entry)
        eid = entry["id"]

        # Update it
        updated = sourcebook_update_entry(
            eid, name="NewName", description="NewDesc", images=["img1"]
        )
        self.assertNotIn("error", updated)
        self.assertEqual(updated["name"], "NewName")
        self.assertEqual(updated["description"], "NewDesc")
        self.assertEqual(updated["category"], "Character")  # Unchanged
        self.assertEqual(updated["images"], ["img1"])

        # Check persistence
        entries = self._get_entries()
        new_eid = updated["id"]
        saved = next(e for e in entries if e["id"] == new_eid)
        self.assertEqual(saved["name"], "NewName")

    def test_update_with_invalid_id_returns_error(self):
        result = sourcebook_update_entry("nonexistent", name="Foo")
        self.assertIn("error", result)

    def test_normalize_tuple_style_sourcebook_relations_at_load(self):
        merged = {
            "metadata": {"version": CURRENT_SCHEMA_VERSION},
            "project_title": "Test Project",
            "format": "markdown",
            "sourcebook": {},
            "sourcebook_relations": [
                {
                    "relation": [
                        "Dimitri (The Senior)",
                        "is a senior student at",
                        "The Boarding School",
                    ],
                    "source_id": "Dimitri (The Senior)",
                    "target_id": "",
                }
            ],
        }

        normalized = normalize_validate_story_config(
            merged=merged,
            path_label="test",
            current_schema_version=CURRENT_SCHEMA_VERSION,
            schema_loader=_get_story_schema,
        )

        self.assertEqual(
            normalized["sourcebook_relations"][0]["relation"],
            "is a senior student at",
        )
        self.assertEqual(
            normalized["sourcebook_relations"][0]["target_id"],
            "The Boarding School",
        )

    def test_load_story_config_migrates_tuple_style_relations_to_current_version(self):
        story_path = self.pdir / "story.json"
        story_data = {
            "metadata": {"version": 4},
            "project_title": "Test Project",
            "format": "markdown",
            "sourcebook": {},
            "sourcebook_relations": [
                {
                    "relation": [
                        "Dimitri (The Senior)",
                        "is a senior student at",
                        "The Boarding School",
                    ],
                    "source_id": "Dimitri (The Senior)",
                    "target_id": "",
                }
            ],
        }
        story_path.write_text(json.dumps(story_data), encoding="utf-8")

        loaded = load_story_config(story_path)
        self.assertEqual(
            loaded.get("metadata", {}).get("version"), CURRENT_SCHEMA_VERSION
        )
        self.assertEqual(
            loaded["sourcebook_relations"][0]["relation"],
            "is a senior student at",
        )
        self.assertEqual(
            loaded["sourcebook_relations"][0]["target_id"],
            "The Boarding School",
        )

        persisted = json.loads(story_path.read_text(encoding="utf-8"))
        self.assertEqual(
            persisted.get("metadata", {}).get("version"), CURRENT_SCHEMA_VERSION
        )
        self.assertEqual(
            persisted["sourcebook_relations"][0]["relation"],
            "is a senior student at",
        )
        self.assertEqual(
            persisted["sourcebook_relations"][0]["target_id"],
            "The Boarding School",
        )

    def test_load_story_config_migrates_legacy_relation_bounds_to_scene_fields(self):
        story_path = self.pdir / "story.json"
        story_data = {
            "metadata": {"version": 7},
            "project_title": "Test Project",
            "format": "markdown",
            "sourcebook": {},
            "sourcebook_relations": [
                {
                    "source_id": "Dimitri (The Senior)",
                    "target_id": "The Boarding School",
                    "relation": "is a senior student at",
                    "start_chapter": "1",
                    "end_chapter": "2",
                    "start_book": "book-1",
                    "end_book": "book-2",
                }
            ],
        }
        story_path.write_text(json.dumps(story_data), encoding="utf-8")

        loaded = load_story_config(story_path)
        self.assertEqual(
            loaded.get("metadata", {}).get("version"), CURRENT_SCHEMA_VERSION
        )
        self.assertEqual(
            loaded["sourcebook_relations"][0]["start_scene"],
            1,
        )
        self.assertEqual(
            loaded["sourcebook_relations"][0]["end_scene"],
            2,
        )
        self.assertNotIn("start_chapter", loaded["sourcebook_relations"][0])
        self.assertNotIn("end_chapter", loaded["sourcebook_relations"][0])
        self.assertNotIn("start_book", loaded["sourcebook_relations"][0])
        self.assertNotIn("end_book", loaded["sourcebook_relations"][0])

        persisted = json.loads(story_path.read_text(encoding="utf-8"))
        self.assertEqual(
            persisted.get("metadata", {}).get("version"), CURRENT_SCHEMA_VERSION
        )
        self.assertEqual(
            persisted["sourcebook_relations"][0]["start_scene"],
            1,
        )
        self.assertEqual(
            persisted["sourcebook_relations"][0]["end_scene"],
            2,
        )
        self.assertNotIn("start_chapter", persisted["sourcebook_relations"][0])
        self.assertNotIn("end_chapter", persisted["sourcebook_relations"][0])
        self.assertNotIn("start_book", persisted["sourcebook_relations"][0])
        self.assertNotIn("end_book", persisted["sourcebook_relations"][0])

    def test_load_story_config_rejects_string_scene_ids(self):
        story_path = self.pdir / "story.json"
        story_data = {
            "metadata": {"version": 8},
            "project_title": "Test Project",
            "format": "markdown",
            "sourcebook": {},
            "sourcebook_relations": [
                {
                    "source_id": "Dimitri (The Senior)",
                    "target_id": "The Boarding School",
                    "relation": "is a senior student at",
                    "start_scene": "1",
                    "end_scene": "2",
                }
            ],
        }
        story_path.write_text(json.dumps(story_data), encoding="utf-8")

        with self.assertRaises(ValueError):
            load_story_config(story_path)

    def test_manage_sourcebook_relation_data_rejects_string_scene_ids(self):
        from pydantic import ValidationError

        from augmentedquill.services.chat.chat_tools.sourcebook_tools import (
            ManageSourcebookRelationData,
        )

        with self.assertRaises(ValidationError):
            ManageSourcebookRelationData(
                source_id="A",
                relation_type="knows",
                target_id="B",
                start_scene="1",
                end_scene="2",
            )

    def test_update_with_invalid_fields_returns_error(self):
        # Create valid entry
        entry = sourcebook_create_entry("UpdateTarget2", "Desc", "Character")
        eid = entry["id"]

        # Valid update
        updated = sourcebook_update_entry(eid, name="Valid")
        self.assertNotIn("error", updated)
        eid = updated["id"]

        # Invalid name
        self.assertIn("error", sourcebook_update_entry(eid, name=""))

        # Test None explicitly logic
        res = sourcebook_update_entry(eid, name=None)  # Should be fine, just no update
        self.assertNotIn("error", res)

        # Invalid Type
        self.assertIn("error", sourcebook_update_entry(eid, category=123))

        # Invalid Category Value
        self.assertIn(
            "error", sourcebook_update_entry(eid, category="NotARealCategory")
        )

        # Invalid Images
        self.assertIn("error", sourcebook_update_entry(eid, images="Not A List"))
        self.assertIn("error", sourcebook_update_entry(eid, images=[123]))

        # Invalid Identifier (None)
        self.assertIn("error", sourcebook_update_entry(None))

    def test_pydantic_schema_validates_images_on_create_tool(self):
        from pydantic import ValidationError

        from augmentedquill.services.chat.chat_tools.sourcebook_tools import (
            ManageSourcebookEntryData,
        )

        # Valid
        params = ManageSourcebookEntryData(
            name="Valid Model",
            description="Valid",
            category="Character",
            images=["img1", "img2"],
        )
        self.assertEqual(params.images, ["img1", "img2"])

        # Default is empty list
        params2 = ManageSourcebookEntryData(
            name="Valid Model 2", description="Valid", category="Character"
        )
        self.assertEqual(params2.images, [])

        # Invalid
        with self.assertRaises(ValidationError):
            ManageSourcebookEntryData(
                name="Invalid Model",
                description="Valid",
                category="Character",
                images="not a list",
            )

    def test_pydantic_schema_validates_images_on_update_tool(self):
        from pydantic import ValidationError

        from augmentedquill.services.chat.chat_tools.sourcebook_tools import (
            ManageSourcebookUpdateData,
        )

        # Valid
        params = ManageSourcebookUpdateData(images=["img1"])
        self.assertEqual(params.images, ["img1"])

        # Default is None
        params2 = ManageSourcebookUpdateData()
        self.assertIsNone(params2.images)

        # Invalid
        with self.assertRaises(ValidationError):
            ManageSourcebookUpdateData(images="not a list")

    def test_chat_tool_update_without_fields_returns_error(self):
        ensure_tool_registry_loaded()
        tool = get_tool_function("manage_sourcebook")
        self.assertIsNotNone(tool)

        response = self._run_async(
            tool(
                {"action": "update", "name_or_id": "id1", "update_data": {}},
                "call_test",
                payload={},
                mutations={},
            )
        )

        self.assertIsInstance(response, dict)
        self.assertEqual(response.get("name"), "manage_sourcebook")
        self.assertEqual(response.get("tool_call_id"), "call_test")

        content = response.get("content")
        self.assertIsInstance(content, str)
        self.assertIn("error", content)
        self.assertIn("at least one", content.lower())

    def test_keywords_stay_empty_without_editing_model(self):
        description = (
            "Anne is a disciplined caretaker, but she hides fear. "
            "She maintains strict routines and records daily schedules. "
            "She coordinates preparation rituals and tracks selected outfits."
        )
        created = sourcebook_create_entry(
            name="Anne",
            description=description,
            category="Character",
            synonyms=["caretaker"],
        )
        self.assertNotIn("error", created)

        refreshed = self._run_async(
            sourcebook_refresh_entry_keywords("Anne", payload={})
        )
        self.assertIsNotNone(refreshed)

        entry = sourcebook_get_entry("Anne")
        self.assertIsNotNone(entry)
        keywords = entry.get("keywords", [])
        self.assertEqual(keywords, [])

    def test_description_update_clears_keywords(self):
        created = sourcebook_create_entry(
            name="Keyword Reset",
            description="Original facts.",
            category="Character",
            keywords=["original", "facts"],
        )
        self.assertNotIn("error", created)
        self.assertGreater(len(created.get("keywords", [])), 0)

        updated = sourcebook_update_entry(
            name_or_id="Keyword Reset",
            description="Completely different facts now.",
        )
        self.assertNotIn("error", updated)
        self.assertEqual(updated.get("keywords", []), [])

    # -------------------------------------------------------------------------
    # Time Travel category tests
    # -------------------------------------------------------------------------

    def test_create_time_travel_entry_succeeds(self):
        """The 'Time Travel' category must be accepted by the backend."""
        result = sourcebook_create_entry(
            name="Journey to the Past",
            description="A portal that sends the protagonist 30 years back.",
            category="Time Travel",
        )
        self.assertNotIn("error", result)
        self.assertEqual(result["category"], "Time Travel")

    def test_create_time_travel_entry_case_insensitive(self):
        """Category normalisation must accept 'time travel' (lowercase)."""
        result = sourcebook_create_entry(
            name="Future Leap",
            description="Leaps 10 years forward.",
            category="time travel",
        )
        self.assertNotIn("error", result)
        self.assertEqual(result["category"], "Time Travel")

    def test_create_time_travel_entry_with_fields(self):
        """Time Travel specific fields are stored and returned correctly."""
        result = sourcebook_create_entry(
            name="Flux Capacitor",
            description="Makes time travel possible at 88 mph.",
            category="Time Travel",
            destination_datetime="1955-11-05T00:00:00Z",
            destination_relative="30 years earlier",
            creates_new_timeline=True,
        )
        self.assertNotIn("error", result)
        self.assertEqual(result.get("destination_datetime"), "1955-11-05T00:00:00Z")
        self.assertEqual(result.get("destination_relative"), "30 years earlier")
        self.assertTrue(result.get("creates_new_timeline"))

    def test_update_time_travel_entry_fields(self):
        """Time Travel specific fields can be updated."""
        created = sourcebook_create_entry(
            name="Time Vortex",
            description="A swirling vortex.",
            category="Time Travel",
        )
        self.assertNotIn("error", created)
        updated = sourcebook_update_entry(
            name_or_id=created["id"],
            destination_relative="100 years forward",
            creates_new_timeline=False,
        )
        self.assertNotIn("error", updated)
        self.assertEqual(updated.get("destination_relative"), "100 years forward")
        self.assertFalse(updated.get("creates_new_timeline"))

    def _get_entries(self):
        story_path = self.pdir / "story.json"
        story = json.loads(story_path.read_text())
        sb = story.get("sourcebook", {})
        if isinstance(sb, dict):
            # Convert to list for tests that expect it
            return [{"id": name, "name": name, **data} for name, data in sb.items()]
        return sb

    def _run_async(self, coro):
        import asyncio

        return asyncio.run(coro)

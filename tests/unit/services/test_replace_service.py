# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Tests for the replace service: replace-all and replace-single logic."""

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase

from augmentedquill.models.search import (
    ReplaceAllRequest,
    ReplaceSingleRequest,
    SearchScope,
)
from augmentedquill.services.search.replace_service import (
    _apply_replace,
    _apply_replace_nth,
    replace_all,
    replace_single,
)


class TestApplyReplace(TestCase):
    def test_replaces_all_occurrences(self):
        new_text, count = _apply_replace(
            "cat and cat",
            "cat",
            "dog",
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
        )
        self.assertEqual(count, 2)
        self.assertEqual(new_text, "dog and dog")

    def test_case_insensitive_replaces(self):
        _new_text, count = _apply_replace(
            "Cat and CAT",
            "cat",
            "dog",
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
        )
        self.assertEqual(count, 2)

    def test_case_sensitive_replaces_only_exact(self):
        new_text, count = _apply_replace(
            "Cat and cat",
            "cat",
            "dog",
            case_sensitive=True,
            is_regex=False,
            is_phonetic=False,
        )
        self.assertEqual(count, 1)
        self.assertEqual(new_text, "Cat and dog")

    def test_regex_replace(self):
        new_text, count = _apply_replace(
            "Chapter 1 and Chapter 2",
            r"Chapter \d+",
            "Part X",
            case_sensitive=False,
            is_regex=True,
            is_phonetic=False,
        )
        self.assertEqual(count, 2)
        self.assertEqual(new_text, "Part X and Part X")

    def test_invalid_regex_returns_original(self):
        original = "some text"
        new_text, count = _apply_replace(
            original,
            "[invalid",
            "replacement",
            case_sensitive=False,
            is_regex=True,
            is_phonetic=False,
        )
        self.assertEqual(new_text, original)
        self.assertEqual(count, 0)

    def test_empty_text_returns_unchanged(self):
        new_text, count = _apply_replace(
            "", "anything", "replacement", False, False, False
        )
        self.assertEqual(new_text, "")
        self.assertEqual(count, 0)

    def test_phonetic_replace(self):
        new_text, count = _apply_replace(
            "Elana went home",
            "Elena",
            "Elara",
            case_sensitive=False,
            is_regex=False,
            is_phonetic=True,
        )
        self.assertGreater(count, 0)
        self.assertIn("Elara", new_text)


class TestApplyReplaceNth(TestCase):
    def test_replaces_only_specified_index(self):
        text = "cat and cat and cat"
        # Replace the 2nd occurrence (index 1)
        result, changed = _apply_replace_nth(
            text, "cat", "dog", False, False, False, match_index=1
        )
        self.assertTrue(changed)
        self.assertEqual(result, "cat and dog and cat")

    def test_first_occurrence(self):
        text = "cat and cat"
        result, changed = _apply_replace_nth(
            text, "cat", "dog", False, False, False, match_index=0
        )
        self.assertTrue(changed)
        self.assertEqual(result, "dog and cat")

    def test_out_of_range_index_returns_unchanged(self):
        text = "cat"
        result, changed = _apply_replace_nth(
            text, "cat", "dog", False, False, False, match_index=5
        )
        self.assertFalse(changed)
        self.assertEqual(result, text)


class TestReplaceAll(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        tmp = Path(self.td.name)
        self.projects_root = tmp / "projects"
        self.projects_root.mkdir(parents=True)
        self.registry_path = tmp / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _make_and_select_project(self, project_name: str = "replace_test") -> Path:
        from augmentedquill.services.projects.projects import (
            create_project,
            get_active_project_dir,
            select_project,
        )

        create_project(project_name, project_type="novel", language="en")
        select_project(project_name)
        active = get_active_project_dir()
        assert active is not None

        chapters_dir = active / "chapters"
        chapters_dir.mkdir(exist_ok=True)
        (chapters_dir / "0001.txt").write_text(
            "Elena walked in. Elena smiled.", encoding="utf-8"
        )
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["chapters"] = [
            {
                "id": 1,
                "title": "Chapter One",
                "summary": "Elena is introduced.",
                "notes": "",
                "private_notes": "",
                "conflicts": [],
            }
        ]
        story["summary"] = "A story about Elena."
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")
        return active

    def test_replace_all_in_chapter_content(self):
        active = self._make_and_select_project()
        req = ReplaceAllRequest(
            query="Elena",
            scope=SearchScope.all_chapters,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="Elara",
        )
        resp = replace_all(req, active)
        self.assertEqual(resp.replacements_made, 2)
        content = (active / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertIn("Elara", content)
        self.assertNotIn("Elena", content)

    def test_replace_all_zero_matches(self):
        active = self._make_and_select_project("replace_test_zero")
        req = ReplaceAllRequest(
            query="xyzzy_not_found",
            scope=SearchScope.all_chapters,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="something",
        )
        resp = replace_all(req, active)
        self.assertEqual(resp.replacements_made, 0)

    def test_replace_preserves_unaffected_section(self):
        active = self._make_and_select_project("replace_test_preserve")
        req = ReplaceAllRequest(
            query="Elena",
            scope=SearchScope.all_chapters,
            case_sensitive=True,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="Elara",
        )
        replace_all(req, active)
        # story.json summary should be unchanged (scope was all_chapters, not metadata)
        story_data = json.loads((active / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story_data["summary"], "A story about Elena.")

    def test_replace_all_in_chapter_title(self):
        active = self._make_and_select_project("replace_test_title")
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["chapters"] = [
            {
                "id": 1,
                "title": "Chapter One",
                "summary": "Elena is introduced.",
                "notes": "",
                "private_notes": "",
                "conflicts": [],
            }
        ]
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        req = ReplaceAllRequest(
            query="Chapter One",
            scope=SearchScope.all,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="Chapter I",
        )
        resp = replace_all(req, active)
        self.assertEqual(resp.replacements_made, 1)
        story_data = json.loads(story_path.read_text(encoding="utf-8"))
        self.assertEqual(story_data["chapters"][0]["title"], "Chapter I")

    def test_replace_all_in_scene_summary(self):
        active = self._make_and_select_project("replace_test_scene")
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["scenes"] = {
            "1": {
                "id": 1,
                "summary": "Eorla enters the forest.",
                "beats": [],
                "active_characters": [],
                "passive_characters": [],
                "sourcebook_entry_ids": [],
                "causes": [],
                "pinboard_x": 100,
                "pinboard_y": 100,
                "status": "active",
            }
        }
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        req = ReplaceAllRequest(
            query="Eorla",
            scope=SearchScope.metadata,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="Elara",
        )
        resp = replace_all(req, active)
        self.assertEqual(resp.replacements_made, 1)
        story_data = json.loads(story_path.read_text(encoding="utf-8"))
        self.assertEqual(
            story_data["scenes"]["1"]["summary"], "Elara enters the forest."
        )

    def test_replace_all_in_story_title(self):
        active = self._make_and_select_project("replace_test_story_title")
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["project_title"] = "My Story"
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        req = ReplaceAllRequest(
            query="My Story",
            scope=SearchScope.metadata,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="Her Tale",
        )
        resp = replace_all(req, active)
        self.assertEqual(resp.replacements_made, 1)
        story_data = json.loads(story_path.read_text(encoding="utf-8"))
        self.assertEqual(story_data["project_title"], "Her Tale")

    def test_replace_all_in_sourcebook_description(self):
        active = self._make_and_select_project("replace_test_sourcebook")
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["sourcebook"] = {
            "Magic Sword": {
                "description": "A legendary sword of fire.",
                "category": "item",
                "synonyms": ["Blade", "Flame Sword"],
            }
        }
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        req = ReplaceAllRequest(
            query="sword",
            scope=SearchScope.sourcebook,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="blade",
        )
        resp = replace_all(req, active)
        self.assertEqual(resp.replacements_made, 3)
        story_data = json.loads(story_path.read_text(encoding="utf-8"))
        self.assertNotIn("Magic Sword", story_data["sourcebook"])
        self.assertIn("Magic blade", story_data["sourcebook"])
        self.assertEqual(
            story_data["sourcebook"]["Magic blade"]["description"],
            "A legendary blade of fire.",
        )
        self.assertEqual(
            story_data["sourcebook"]["Magic blade"]["synonyms"],
            ["Blade", "Flame blade"],
        )

    def test_replace_all_in_sourcebook_relation(self):
        active = self._make_and_select_project("replace_test_sourcebook_relations")
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["sourcebook"] = {
            "Hero": {
                "description": "A brave character.",
                "category": "character",
                "synonyms": [],
            },
            "Dragon": {
                "description": "A fierce beast.",
                "category": "creature",
                "synonyms": [],
            },
        }
        story["sourcebook_relations"] = [
            {
                "source_id": "Hero",
                "relation": "friend of",
                "target_id": "Dragon",
            }
        ]
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        req = ReplaceAllRequest(
            query="friend",
            scope=SearchScope.sourcebook,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="ally",
        )
        resp = replace_all(req, active)
        self.assertEqual(resp.replacements_made, 1)
        story_data = json.loads(story_path.read_text(encoding="utf-8"))
        self.assertEqual(
            story_data["sourcebook_relations"][0]["relation"],
            "ally of",
        )

    def test_replace_all_in_sourcebook_title_updates_relations(self):
        active = self._make_and_select_project("replace_test_sourcebook_title")
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["sourcebook"] = {
            "Magic Sword": {
                "description": "A legendary blade.",
                "category": "item",
                "synonyms": [],
            },
            "Dragon": {
                "description": "A fierce beast.",
                "category": "creature",
                "synonyms": [],
            },
        }
        story["sourcebook_relations"] = [
            {
                "source_id": "Magic Sword",
                "relation": "owned by",
                "target_id": "Dragon",
            }
        ]
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        req = ReplaceAllRequest(
            query="Sword",
            scope=SearchScope.sourcebook,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="Blade",
        )
        resp = replace_all(req, active)
        self.assertEqual(resp.replacements_made, 2)
        story_data = json.loads(story_path.read_text(encoding="utf-8"))
        self.assertNotIn("Magic Sword", story_data["sourcebook"])
        self.assertIn("Magic Blade", story_data["sourcebook"])
        self.assertEqual(
            story_data["sourcebook_relations"][0]["source_id"],
            "Magic Blade",
        )

    def test_replace_all_in_sourcebook_title_change_location_uses_new_name(self):
        active = self._make_and_select_project("replace_test_sourcebook_title_meta")
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["sourcebook"] = {
            "Magic Sword": {
                "description": "A legendary sword of fire.",
                "category": "item",
                "synonyms": [],
            }
        }
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        req = ReplaceAllRequest(
            query="Sword",
            scope=SearchScope.sourcebook,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="Blade",
        )
        resp = replace_all(req, active)
        self.assertEqual(resp.replacements_made, 2)
        self.assertEqual(len(resp.changed_sections_meta), 2)
        self.assertEqual(
            {loc.target_id for loc in resp.changed_sections_meta}, {"Magic Blade"}
        )
        self.assertEqual(
            {loc.label for loc in resp.changed_sections_meta},
            {"Sourcebook 'Magic Blade' Name", "Sourcebook 'Magic Blade' Description"},
        )

    def test_replace_all_in_chapter_summary_returns_chapter_location(self):
        active = self._make_and_select_project("replace_test_chapter_summary_meta")
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["chapters"][0]["summary"] = "A lonely lighthouse."
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        req = ReplaceAllRequest(
            query="lighthouse",
            scope=SearchScope.all,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="beacon",
        )
        resp = replace_all(req, active)
        self.assertEqual(resp.replacements_made, 1)
        self.assertEqual(len(resp.changed_sections_meta), 1)
        self.assertEqual(resp.changed_sections_meta[0].type, "metadata")
        self.assertEqual(resp.changed_sections_meta[0].target_id, "1")
        self.assertEqual(resp.changed_sections_meta[0].field, "summary")
        self.assertEqual(resp.changed_sections_meta[0].label, "Chapter One summary")

        # Verify the change was actually persisted to disk.
        saved = json.loads(story_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["chapters"][0]["summary"], "A lonely beacon.")


class TestReplaceSingle(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        tmp = Path(self.td.name)
        self.projects_root = tmp / "projects"
        self.projects_root.mkdir(parents=True)
        self.registry_path = tmp / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _make_and_select_project(self, project_name: str = "single_test") -> Path:
        from augmentedquill.services.projects.projects import (
            create_project,
            get_active_project_dir,
            select_project,
        )

        create_project(project_name, project_type="novel", language="en")
        select_project(project_name)
        active = get_active_project_dir()
        assert active is not None

        chapters_dir = active / "chapters"
        chapters_dir.mkdir(exist_ok=True)
        (chapters_dir / "0001.txt").write_text("cat and cat and cat", encoding="utf-8")
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["chapters"] = [
            {
                "id": 1,
                "title": "Ch1",
                "summary": "",
                "notes": "",
                "private_notes": "",
                "conflicts": [],
            }
        ]
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")
        return active

    def test_replace_single_second_occurrence(self):
        active = self._make_and_select_project()
        req = ReplaceSingleRequest(
            query="cat",
            scope=SearchScope.all_chapters,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="dog",
            section_type="chapter_content",
            section_id="1",
            field="content",
            match_index=1,
        )
        resp = replace_single(req, active)
        self.assertEqual(resp.replacements_made, 1)
        content = (active / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertEqual(content, "cat and dog and cat")

    def test_replace_single_in_sourcebook_description(self):
        active = self._make_and_select_project("single_test_sourcebook")
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["sourcebook"] = {
            "Magic Sword": {
                "description": "A legendary sword of fire.",
                "category": "item",
                "synonyms": ["Blade", "Flame Sword"],
            }
        }
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        req = ReplaceSingleRequest(
            query="sword",
            scope=SearchScope.sourcebook,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
            replacement="blade",
            section_type="sourcebook",
            section_id="Magic Sword",
            field="description",
            match_index=0,
        )
        resp = replace_single(req, active)
        self.assertEqual(resp.replacements_made, 1)
        story_data = json.loads(story_path.read_text(encoding="utf-8"))
        self.assertEqual(
            story_data["sourcebook"]["Magic Sword"]["description"],
            "A legendary blade of fire.",
        )

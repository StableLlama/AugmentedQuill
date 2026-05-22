# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Tests for the search service: literal, regex, and phonetic search logic."""

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase

from augmentedquill.models.search import SearchOptions, SearchScope
from augmentedquill.services.search.search_service import (
    _build_pattern,
    _extract_matches,
    _phonetic_matches,
    _search_text,
    run_search,
)


class TestBuildPattern(TestCase):
    def test_literal_case_insensitive(self):
        pattern = _build_pattern("Elena", case_sensitive=False, is_regex=False)
        self.assertIsNotNone(pattern.search("elena"))
        self.assertIsNotNone(pattern.search("ELENA"))

    def test_literal_case_sensitive(self):
        pattern = _build_pattern("Elena", case_sensitive=True, is_regex=False)
        self.assertIsNone(pattern.search("elena"))
        self.assertIsNotNone(pattern.search("Elena"))

    def test_literal_escapes_special_chars(self):
        pattern = _build_pattern("a.b", case_sensitive=False, is_regex=False)
        # "a.b" as literal should NOT match "axb"
        self.assertIsNone(pattern.search("axb"))
        self.assertIsNotNone(pattern.search("a.b"))

    def test_regex_pattern(self):
        pattern = _build_pattern(r"\bKing\b", case_sensitive=True, is_regex=True)
        self.assertIsNotNone(pattern.search("the King sat"))
        self.assertIsNone(pattern.search("Viking"))


class TestExtractMatches(TestCase):
    def test_returns_correct_positions(self):
        text = "The quick brown fox"
        import re

        pattern = re.compile("quick", re.IGNORECASE)
        matches = _extract_matches(text, pattern)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].start, 4)
        self.assertEqual(matches[0].end, 9)
        self.assertEqual(matches[0].match_text, "quick")

    def test_context_extraction(self):
        text = "Hello World here"
        import re

        pattern = re.compile("World", re.IGNORECASE)
        matches = _extract_matches(text, pattern)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].context_before, "Hello ")
        self.assertEqual(matches[0].context_after, " here")

    def test_multiple_matches(self):
        text = "cat and cat"
        import re

        pattern = re.compile("cat", re.IGNORECASE)
        matches = _extract_matches(text, pattern)
        self.assertEqual(len(matches), 2)

    def test_no_match(self):
        import re

        pattern = re.compile("xyz", re.IGNORECASE)
        matches = _extract_matches("hello world", pattern)
        self.assertEqual(matches, [])


class TestPhoneticMatches(TestCase):
    def test_finds_variant_spelling(self):
        # "Elena" and "Elana" should share the same Soundex code E450
        matches = _phonetic_matches("Elana walked in", "Elena")
        self.assertGreater(len(matches), 0)
        self.assertEqual(matches[0].match_text, "Elana")

    def test_exact_word_also_found(self):
        matches = _phonetic_matches("Elena was there", "Elena")
        self.assertGreater(len(matches), 0)

    def test_no_match_for_different_sound(self):
        matches = _phonetic_matches("Bob walked in", "Elena")
        self.assertEqual(matches, [])

    def test_empty_query_returns_empty(self):
        matches = _phonetic_matches("Some text here", "")
        self.assertEqual(matches, [])


class TestSearchText(TestCase):
    def test_literal_search(self):
        matches = _search_text(
            "The quick fox",
            "quick",
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
        )
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].match_text, "quick")

    def test_regex_search(self):
        matches = _search_text(
            "Chapter 1 and Chapter 2",
            r"Chapter \d+",
            case_sensitive=False,
            is_regex=True,
            is_phonetic=False,
        )
        self.assertEqual(len(matches), 2)

    def test_invalid_regex_returns_empty(self):
        matches = _search_text(
            "some text",
            "[invalid",
            case_sensitive=False,
            is_regex=True,
            is_phonetic=False,
        )
        self.assertEqual(matches, [])

    def test_phonetic_search(self):
        matches = _search_text(
            "Elana arrived",
            "Elena",
            case_sensitive=False,
            is_regex=False,
            is_phonetic=True,
        )
        self.assertGreater(len(matches), 0)

    def test_empty_text_returns_empty(self):
        matches = _search_text(
            "", "query", case_sensitive=False, is_regex=False, is_phonetic=False
        )
        self.assertEqual(matches, [])

    def test_empty_query_returns_empty(self):
        matches = _search_text(
            "some text", "", case_sensitive=False, is_regex=False, is_phonetic=False
        )
        self.assertEqual(matches, [])


class TestRunSearch(TestCase):
    """Integration tests using a temporary project directory."""

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

    def _make_and_select_project(self) -> Path:
        """Create a minimal novel project and select it as active."""
        from augmentedquill.services.projects.projects import (
            create_project,
            get_active_project_dir,
            select_project,
        )

        create_project("search_test", project_type="novel", language="en")
        select_project("search_test")
        active = get_active_project_dir()
        assert active is not None

        chapters_dir = active / "chapters"
        chapters_dir.mkdir(exist_ok=True)
        (chapters_dir / "0001.txt").write_text(
            "Elena walked through the forest.\nShe met a stranger.", encoding="utf-8"
        )
        (chapters_dir / "0002.txt").write_text(
            "The stranger's name was Thomas.", encoding="utf-8"
        )
        # Update story.json with chapter metadata
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["chapters"] = [
            {
                "id": 1,
                "title": "The Forest",
                "summary": "Elena discovers the forest.",
                "notes": "",
                "private_notes": "",
                "conflicts": [],
            },
            {
                "id": 2,
                "title": "The Stranger",
                "summary": "Thomas appears.",
                "notes": "",
                "private_notes": "",
                "conflicts": [],
            },
        ]
        story["summary"] = "A story about Elena."
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")
        return active

    def test_literal_search_all_scope(self):
        active = self._make_and_select_project()
        opts = SearchOptions(
            query="Elena",
            scope=SearchScope.all,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
        )
        result = run_search(opts, active)
        self.assertGreater(result.total_matches, 0)
        section_types = {s.section_type for s in result.results}
        self.assertIn("chapter_content", section_types)

    def test_case_sensitive_search_misses_wrong_case(self):
        active = self._make_and_select_project()
        opts = SearchOptions(
            query="elena",  # lowercase
            scope=SearchScope.all_chapters,
            case_sensitive=True,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
        )
        result = run_search(opts, active)
        content_sections = [
            s for s in result.results if s.section_type == "chapter_content"
        ]
        self.assertEqual(len(content_sections), 0)

    def test_metadata_scope_finds_summary(self):
        active = self._make_and_select_project()
        opts = SearchOptions(
            query="Elena",
            scope=SearchScope.metadata,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
        )
        result = run_search(opts, active)
        self.assertGreater(result.total_matches, 0)
        section_types = {s.section_type for s in result.results}
        self.assertTrue(
            "chapter_metadata" in section_types or "story_metadata" in section_types
        )

    def test_metadata_scope_finds_chapter_title(self):
        active = self._make_and_select_project()
        opts = SearchOptions(
            query="Forest",
            scope=SearchScope.metadata,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
        )
        result = run_search(opts, active)
        self.assertTrue(
            any(
                s.section_type == "chapter_metadata" and s.field == "title"
                for s in result.results
            )
        )

    def test_metadata_scope_finds_story_title(self):
        active = self._make_and_select_project()
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["project_title"] = "Grand Adventure"
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        opts = SearchOptions(
            query="Grand Adventure",
            scope=SearchScope.metadata,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
        )
        result = run_search(opts, active)
        self.assertTrue(
            any(
                s.section_type == "story_metadata" and s.field == "project_title"
                for s in result.results
            )
        )

    def test_metadata_scope_finds_scene_summary(self):
        active = self._make_and_select_project()
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["scenes"] = {
            "1": {
                "id": 1,
                "summary": "Elena confronts the stranger.",
                "beats": [],
                "active_characters": ["Elena"],
                "passive_characters": [],
                "sourcebook_entry_ids": [],
                "order_before": [],
                "order_after": [],
                "pinboard_x": 100,
                "pinboard_y": 100,
                "status": "active",
            }
        }
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        opts = SearchOptions(
            query="Elena",
            scope=SearchScope.metadata,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
        )
        result = run_search(opts, active)
        self.assertTrue(
            any(
                s.section_type == "scene_metadata" and s.field == "summary"
                for s in result.results
            )
        )

    def test_metadata_scope_finds_scene_beat_text(self):
        active = self._make_and_select_project()
        story_path = active / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["scenes"] = {
            "1": {
                "id": 1,
                "summary": "A short scene.",
                "beats": [{"id": "beat-1", "text": "Elena speaks with the stranger."}],
                "active_characters": [],
                "passive_characters": [],
                "sourcebook_entry_ids": [],
                "order_before": [],
                "order_after": [],
                "pinboard_x": 100,
                "pinboard_y": 100,
                "status": "active",
            }
        }
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        opts = SearchOptions(
            query="speaks",
            scope=SearchScope.metadata,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
        )
        result = run_search(opts, active)
        self.assertTrue(
            any(
                s.section_type == "scene_metadata" and s.field == "beats[0].text"
                for s in result.results
            )
        )

    def test_sourcebook_relation_search_uses_readable_label(self):
        active = self._make_and_select_project()
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

        opts = SearchOptions(
            query="Dragon",
            scope=SearchScope.sourcebook,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
        )
        result = run_search(opts, active)
        relation_sections = [
            s
            for s in result.results
            if s.section_type == "sourcebook" and s.field_display == "Relation: Dragon"
        ]
        self.assertTrue(relation_sections)
        self.assertTrue(
            any(
                "Hero friend of Dragon"
                in (m.context_before + m.match_text + m.context_after)
                for s in relation_sections
                for m in s.matches
            )
        )

    def test_sourcebook_reverse_relation_search_uses_readable_label(self):
        active = self._make_and_select_project()
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

        opts = SearchOptions(
            query="Hero",
            scope=SearchScope.sourcebook,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
        )
        result = run_search(opts, active)
        relation_sections = [
            s
            for s in result.results
            if s.section_type == "sourcebook" and s.field_display == "Relation: Hero"
        ]
        self.assertTrue(relation_sections)
        self.assertTrue(
            any(
                "Hero friend of Dragon"
                in (m.context_before + m.match_text + m.context_after)
                for s in relation_sections
                for m in s.matches
            )
        )

    def test_no_results_for_absent_query(self):
        active = self._make_and_select_project()
        opts = SearchOptions(
            query="xyzzy_not_in_text",
            scope=SearchScope.all,
            case_sensitive=False,
            is_regex=False,
            is_phonetic=False,
            active_chapter_id=None,
        )
        result = run_search(opts, active)
        self.assertEqual(result.total_matches, 0)
        self.assertEqual(result.results, [])

# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test projects unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
from pathlib import Path
import tempfile

from augmentedquill.services.projects.projects import (
    validate_project_dir,
    initialize_project_dir,
    select_project,
    load_registry,
    write_chapter_content,
    write_chapter_summary,
)
from tests.unit.api.v1.api_test_case import ApiTestCase


class ProjectsTest(ApiTestCase):
    def setUp(self):
        super().setUp()
        # Ensure clean
        if self.registry_path.exists():
            self.registry_path.unlink()

    def test_validate_empty_then_initialize(self):
        with tempfile.TemporaryDirectory() as pd:
            p = Path(pd)
            info = validate_project_dir(p)
            self.assertFalse(info.is_valid)
            self.assertEqual(info.reason, "empty")
            initialize_project_dir(p, project_title="Test")
            info2 = validate_project_dir(p)
            self.assertTrue(info2.is_valid)

    def test_validate_existing_valid_project(self):
        with tempfile.TemporaryDirectory() as pd:
            p = Path(pd)
            initialize_project_dir(p, project_title="X")
            # Create a dummy chapter
            ch = p / "chapters" / "000-intro.md"
            ch.parent.mkdir(parents=True, exist_ok=True)
            ch.write_text("Hello", encoding="utf-8")
            info = validate_project_dir(p)
            self.assertTrue(info.is_valid)

    def test_select_creates_when_missing_or_empty(self):
        # missing by name
        missing_name = "newproj"
        ok, msg = select_project(missing_name)
        self.assertTrue(ok)
        self.assertIn("Project", msg)
        self.assertTrue(self.registry_path.exists())
        reg = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(reg.get("current"), str(self.projects_root / missing_name))

        # empty dir under projects root by name
        empty_name = "empty"
        (self.projects_root / empty_name).mkdir(parents=True, exist_ok=True)
        ok2, msg2 = select_project(empty_name)
        self.assertTrue(ok2)
        reg2 = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(reg2.get("current"), str(self.projects_root / empty_name))

    def test_select_rejects_non_project(self):
        # Create a directory under projects root that is not a valid project
        bad_name = "badproj"
        bad_dir = self.projects_root / bad_name
        bad_dir.mkdir(parents=True, exist_ok=True)
        (bad_dir / "random.txt").write_text("not a project", encoding="utf-8")
        ok, msg = select_project(bad_name)
        self.assertFalse(ok)
        self.assertIn("not a valid", msg)

    def test_mru_capped_at_5(self):
        # Create 6 projects by name
        created_names = []
        for i in range(6):
            name = f"p{i}"
            ok, _ = select_project(name)
            self.assertTrue(ok)
            created_names.append(name)
        reg = load_registry()
        expected_current = str(self.projects_root / created_names[-1])
        self.assertEqual(reg["current"], expected_current)
        self.assertLessEqual(len(reg["recent"]), 5)
        # Ensure latest is first
        self.assertEqual(reg["recent"][0], expected_current)

    def test_write_chapter_content(self):
        # Create a test project with a chapter
        project_name = "test_write_content"
        ok, _ = select_project(project_name)
        self.assertTrue(ok)
        project_dir = self.projects_root / project_name
        chapters_dir = project_dir / "chapters"
        chapters_dir.mkdir(parents=True, exist_ok=True)
        chapter_file = chapters_dir / "0001.txt"
        chapter_file.write_text("Original content", encoding="utf-8")

        # Write new content
        new_content = "New chapter content"
        write_chapter_content(1, new_content)

        # Check the file was updated
        self.assertEqual(chapter_file.read_text(encoding="utf-8"), new_content)

    def test_write_chapter_summary(self):
        # Create a test project with story.json
        project_name = "test_write_summary"
        ok, _ = select_project(project_name)
        self.assertTrue(ok)
        project_dir = self.projects_root / project_name
        story_file = project_dir / "story.json"
        initial_story = {
            "metadata": {"version": 2},
            "project_title": "Test Write Summary",
            "format": "markdown",
            "chapters": [{"title": "Chapter 1", "summary": "Old summary"}],
        }
        story_file.write_text(json.dumps(initial_story, indent=2), encoding="utf-8")
        chapters_dir = project_dir / "chapters"
        chapters_dir.mkdir(parents=True, exist_ok=True)
        chapter_file = chapters_dir / "0001.txt"
        chapter_file.write_text("Content", encoding="utf-8")

        # Write new summary
        new_summary = "New chapter summary"
        write_chapter_summary(1, new_summary)

        # Check the story.json was updated
        updated_story = json.loads(story_file.read_text(encoding="utf-8"))
        self.assertEqual(updated_story["chapters"][0]["summary"], new_summary)

    def test_delete_and_restore_book(self):
        # Create series project with a book and file content
        name = "series_restore_book"
        ok, msg = select_project(name)
        self.assertTrue(ok, msg)
        project_dir = self.projects_root / name

        story_file = project_dir / "story.json"
        story = json.loads(story_file.read_text(encoding="utf-8"))
        story["project_type"] = "series"
        story["books"] = [
            {
                "id": "book-1",
                "folder": "book-1",
                "title": "Book One",
                "chapters": [{"filename": "0001.txt", "title": "C1", "summary": ""}],
            }
        ]
        story.pop("chapters", None)
        story_file.write_text(json.dumps(story, indent=2), encoding="utf-8")

        book_dir = project_dir / "books" / "book-1"
        (book_dir / "chapters").mkdir(parents=True, exist_ok=True)
        (book_dir / "chapters" / "0001.txt").write_text(
            "Book chapter", encoding="utf-8"
        )
        (book_dir / "book_content.md").write_text("Book intro", encoding="utf-8")

        from fastapi.testclient import TestClient
        import augmentedquill.main as main

        client = TestClient(main.app)

        delete_resp = client.post("/api/v1/books/delete", json={"name": "book-1"})
        self.assertEqual(delete_resp.status_code, 200, delete_resp.text)
        restore_id = delete_resp.json().get("restore_id")
        self.assertTrue(restore_id)
        self.assertFalse((project_dir / "books" / "book-1").exists())

        restore_resp = client.post(
            "/api/v1/books/restore", json={"restore_id": restore_id}
        )
        self.assertEqual(restore_resp.status_code, 200, restore_resp.text)
        self.assertTrue((project_dir / "books" / "book-1").exists())
        self.assertEqual(
            (project_dir / "books" / "book-1" / "book_content.md").read_text(
                encoding="utf-8"
            ),
            "Book intro",
        )

    def test_select_invalid_scene_schema_returns_invalid_config(self):
        project_name = "invalid_scene_schema_proj"
        ok, msg = select_project(project_name)
        self.assertTrue(ok, msg)

        story_path = self.projects_root / project_name / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["scenes"] = {
            "bad-scene-id": {
                "summary": "Invalid id shape",
                "beats": [],
                "active_characters": [],
                "passive_characters": [],
                "sourcebook_entry_ids": [],
                "location": None,
                "time": None,
                "scene_time": None,
                "color_tag": None,
                "prose_link": None,
                "causes": [],
                "pinboard_x": 10,
                "pinboard_y": 10,
                "status": "active",
            }
        }
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")

        response = self.client.post(
            "/api/v1/projects/select", json={"name": project_name}
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload.get("error"), "invalid_config")
        self.assertIn("schema requirements", payload.get("error_message", ""))
        self.assertIsNone(payload.get("story"))

    def test_select_legacy_scene_prose_link_fields_are_sanitized_for_payload(self):
        project_name = "legacy_scene_prose_link_project"
        ok, msg = select_project(project_name)
        self.assertTrue(ok, msg)

        project_dir = self.projects_root / project_name
        story_path = project_dir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["metadata"] = {"version": 4}
        story["scenes"] = {
            "1": {
                "summary": "Legacy scene",
                "beats": [],
                "active_characters": [],
                "passive_characters": [],
                "sourcebook_entry_ids": [],
                "location": None,
                "time": None,
                "scene_time": None,
                "color_tag": None,
                "causes": [],
                "pinboard_x": 5,
                "pinboard_y": 7,
                "status": "active",
                "prose_link": {
                    "scope_type": "story",
                    "start_offset": 0,
                    "end_offset": 6,
                    "content_hash": "2095b47960c1dc52",
                    "is_stale": False,
                },
            }
        }
        story_path.write_text(json.dumps(story, indent=2), encoding="utf-8")
        (project_dir / "content.md").write_text("Legacy prose text", encoding="utf-8")

        response = self.client.post(
            "/api/v1/projects/select", json={"name": project_name}
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertIsNone(payload.get("error"))
        self.assertIsNotNone(payload.get("story"))
        scenes = payload.get("story", {}).get("scenes") or []
        self.assertEqual(len(scenes), 1)
        prose_link = scenes[0].get("prose_link") or {}
        self.assertEqual(prose_link.get("scope_type"), "story")
        self.assertEqual(prose_link.get("start_offset"), 0)
        self.assertEqual(prose_link.get("end_offset"), 6)
        self.assertNotIn("content_hash", prose_link)
        self.assertNotIn("is_stale", prose_link)

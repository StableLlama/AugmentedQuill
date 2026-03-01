# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test metadata endpoints unit so this responsibility stays isolated, testable, and easy to evolve."""

import os
import tempfile
import json
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from augmentedquill.main import app
from augmentedquill.services.projects.projects import (
    select_project,
    create_new_book,
    create_project,
    create_new_chapter,
)


class MetadataEndpointsTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"

        # Mock config paths
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        self.client = TestClient(app)

        # Create a default project
        create_project("test_proj")
        select_project("test_proj")
        self.proj_dir = self.projects_root / "test_proj"

    def test_update_chapter_metadata(self):
        # Create a chapter
        chap_id = create_new_chapter("My Chapter")

        # Update metadata
        payload = {
            "summary": "Updated summary",
            "notes": "Updated notes",
            "private_notes": "Secret notes",
            "conflicts": [
                {"id": "1", "description": "Conflict A", "resolution": "Plan A"}
            ],
        }
        resp = self.client.put(f"/api/v1/chapters/{chap_id}/metadata", json=payload)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["ok"])

        # Create another chapter to verify we can update partial fields
        chap_id_2 = create_new_chapter("Another Chapter")
        resp_partial = self.client.put(
            f"/api/v1/chapters/{chap_id_2}/metadata", json={"notes": "Just notes"}
        )
        self.assertEqual(resp_partial.status_code, 200)

        # Verify persistence
        story_json = json.loads((self.proj_dir / "story.json").read_text())
        # Chapters are identified by filename in Novel projects. chap_id matches filename index.
        chap_filename = f"{chap_id:04d}.txt"
        chap_entry = next(
            c for c in story_json["chapters"] if c.get("filename") == chap_filename
        )

        self.assertEqual(chap_entry["summary"], "Updated summary")
        self.assertEqual(chap_entry["notes"], "Updated notes")
        self.assertEqual(chap_entry["private_notes"], "Secret notes")
        self.assertEqual(len(chap_entry["conflicts"]), 1)
        self.assertEqual(chap_entry["conflicts"][0]["description"], "Conflict A")

        chap_filename_2 = f"{chap_id_2:04d}.txt"
        chap_entry_2 = next(
            c for c in story_json["chapters"] if c.get("filename") == chap_filename_2
        )
        self.assertEqual(chap_entry_2.get("notes"), "Just notes")
        self.assertEqual(chap_entry_2.get("summary"), "")  # Initialized to empty string

    def test_update_chapter_metadata_invalid(self):
        # Invalid conflict format
        chap_id = create_new_chapter("My Chapter")
        payload = {"conflicts": "not a list"}
        resp = self.client.put(f"/api/v1/chapters/{chap_id}/metadata", json=payload)
        # 422 is returned by FastAPI/Pydantic when validation fails
        self.assertEqual(resp.status_code, 422)

    def test_update_chapter_metadata_missing_entry(self):
        """Test that update works even if the metadata entry is missing from story.json."""
        # 1. Create a chapter normally
        chap_id = create_new_chapter("Initial Title")
        story_path = self.proj_dir / "story.json"
        story = json.loads(story_path.read_text())

        # 2. Corrupt/Wipe the metadata for this chapter in story.json
        story["chapters"] = []
        story_path.write_text(json.dumps(story))

        # 3. Try to update it via API - it should now auto-create the entry
        payload = {
            "title": "Recovered Title",
            "summary": "Recovered summary",
            "conflicts": [{"description": "New Conflict"}],
        }
        resp = self.client.put(f"/api/v1/chapters/{chap_id}/metadata", json=payload)
        self.assertEqual(resp.status_code, 200)

        # 4. Verify it was recreated in story.json
        story_after = json.loads(story_path.read_text())
        self.assertEqual(len(story_after["chapters"]), 1)
        entry = story_after["chapters"][0]
        self.assertEqual(entry["title"], "Recovered Title")
        self.assertEqual(entry["summary"], "Recovered summary")
        self.assertEqual(entry["conflicts"][0]["description"], "New Conflict")

    def test_update_story_metadata(self):

        payload = {
            "title": "New Title",
            "summary": "Main story summary",
            "tags": ["Sci-Fi", "Noir"],
            "notes": "Story notes",
            "private_notes": "Story private notes",
        }
        resp = self.client.post("/api/v1/story/metadata", json=payload)
        self.assertEqual(resp.status_code, 200)

        # Verify
        story_json = json.loads((self.proj_dir / "story.json").read_text())
        self.assertEqual(story_json["project_title"], "New Title")
        self.assertEqual(story_json["story_summary"], "Main story summary")
        self.assertEqual(story_json["tags"], ["Sci-Fi", "Noir"])
        self.assertEqual(story_json["notes"], "Story notes")
        self.assertEqual(story_json["private_notes"], "Story private notes")

    def test_update_story_metadata_ignores_conflicts(self):
        # Sending conflicts to story metadata should be ignored now
        payload = {
            "title": "Title with Conflicts",
            "conflicts": [
                {"description": "Should not be here", "resolution": "Discarded"}
            ],
        }
        resp = self.client.post("/api/v1/story/metadata", json=payload)
        self.assertEqual(resp.status_code, 200)

        # Verify story.json
        story_json = json.loads((self.proj_dir / "story.json").read_text())
        self.assertNotIn("conflicts", story_json)

    def test_update_book_metadata(self):
        # Create a series project
        create_project("test_series", project_type="series")
        select_project("test_series")
        self.proj_dir = self.projects_root / "test_series"

        # Create a book
        book_id = create_new_book("Book One")

        payload = {
            "title": "Book One Renamed",
            "summary": "Book summary",
            "notes": "Book notes",
            "private_notes": "Book private notes",
        }
        resp = self.client.post(f"/api/v1/books/{book_id}/metadata", json=payload)
        self.assertEqual(resp.status_code, 200)

        # Verify
        story_json = json.loads((self.proj_dir / "story.json").read_text())
        book_entry = next(
            b
            for b in story_json["books"]
            if (b.get("id") == book_id or b.get("folder") == book_id)
        )

        self.assertEqual(book_entry["title"], "Book One Renamed")
        self.assertEqual(book_entry["summary"], "Book summary")
        self.assertEqual(book_entry["notes"], "Book notes")

    def test_update_book_metadata_not_found(self):
        resp = self.client.post(
            "/api/v1/books/nonexistent-id/metadata", json={"title": "T"}
        )
        self.assertEqual(resp.status_code, 404)

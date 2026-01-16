# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import os
import tempfile
import json
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from app.main import app
from app.projects import (
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
        resp = self.client.put(f"/api/chapters/{chap_id}/metadata", json=payload)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["ok"])

        # Create another chapter to verify we can update partial fields
        chap_id_2 = create_new_chapter("Another Chapter")
        resp_partial = self.client.put(
            f"/api/chapters/{chap_id_2}/metadata", json={"notes": "Just notes"}
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
        resp = self.client.put(f"/api/chapters/{chap_id}/metadata", json=payload)
        self.assertEqual(resp.status_code, 400)

    def test_update_story_metadata(self):
        payload = {
            "title": "New Title",
            "summary": "Main story summary",
            "tags": ["Sci-Fi", "Noir"],
            "notes": "Story notes",
            "private_notes": "Story private notes",
        }
        resp = self.client.post("/api/story/metadata", json=payload)
        self.assertEqual(resp.status_code, 200)

        # Verify
        story_json = json.loads((self.proj_dir / "story.json").read_text())
        self.assertEqual(story_json["project_title"], "New Title")
        self.assertEqual(story_json["story_summary"], "Main story summary")
        self.assertEqual(story_json["tags"], ["Sci-Fi", "Noir"])
        self.assertEqual(story_json["notes"], "Story notes")
        self.assertEqual(story_json["private_notes"], "Story private notes")

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
        resp = self.client.post(f"/api/books/{book_id}/metadata", json=payload)
        self.assertEqual(resp.status_code, 200)

        # Verify
        story_json = json.loads((self.proj_dir / "story.json").read_text())
        book_entry = next(b for b in story_json["books"] if b["id"] == book_id)

        self.assertEqual(book_entry["title"], "Book One Renamed")
        self.assertEqual(book_entry["summary"], "Book summary")
        self.assertEqual(book_entry["notes"], "Book notes")

    def test_update_book_metadata_not_found(self):
        resp = self.client.post(
            "/api/books/nonexistent-id/metadata", json={"title": "T"}
        )
        self.assertEqual(resp.status_code, 404)

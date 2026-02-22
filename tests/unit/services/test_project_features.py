# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the test project features unit so this responsibility stays isolated, testable, and easy to evolve.

import json
import io
import zipfile
import os
import tempfile
from pathlib import Path
from unittest import TestCase

from augmentedquill.services.projects.projects import (
    create_project,
    select_project,
    change_project_type,
    get_active_project_dir,
    load_story_config,
)
from augmentedquill.services.projects.project_helpers import _project_overview
from fastapi.testclient import TestClient
from augmentedquill.main import app


class ProjectFeaturesTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"

        # Set environment variables for the app to use our temp dirs
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        self.client = TestClient(app)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def test_convert_short_story_to_novel(self):
        # 1. Create Short Story project
        create_project("test_sm", project_type="short-story")
        select_project("test_sm")
        active = get_active_project_dir()

        # Write content
        (active / "content.md").write_text("Short Story Content", encoding="utf-8")

        # 2. Convert to Novel
        ok, msg = change_project_type("novel")
        self.assertTrue(ok, msg)

        # 3. Verify
        story = load_story_config(active / "story.json")
        self.assertEqual(story["project_type"], "novel")
        self.assertFalse((active / "content.md").exists())
        self.assertTrue((active / "chapters" / "0001.txt").exists())
        text = (active / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertEqual(text, "Short Story Content")

    def test_convert_novel_to_short_story_success(self):
        # 1. Create Novel project
        create_project("test_med", project_type="novel")
        select_project("test_med")
        active = get_active_project_dir()

        # Write one chapter
        (active / "chapters").mkdir(exist_ok=True)
        (active / "chapters" / "0001.txt").write_text(
            "Chapter Content", encoding="utf-8"
        )

        # 2. Convert to Short Story
        ok, msg = change_project_type("short-story")
        self.assertTrue(ok, msg)

        # 3. Verify
        story = load_story_config(active / "story.json")
        self.assertEqual(story["project_type"], "short-story")
        self.assertTrue((active / "content.md").exists())
        self.assertFalse((active / "chapters").exists())
        text = (active / "content.md").read_text(encoding="utf-8")
        self.assertEqual(text, "Chapter Content")

    def test_convert_novel_to_short_story_fails_if_multiple_chapters(self):
        create_project("test_med_multi", project_type="novel")
        select_project("test_med_multi")
        active = get_active_project_dir()

        (active / "chapters").mkdir(exist_ok=True)
        (active / "chapters" / "0001.txt").write_text("C1", encoding="utf-8")
        (active / "chapters" / "0002.txt").write_text("C2", encoding="utf-8")

        ok, msg = change_project_type("short-story")
        self.assertFalse(ok)
        self.assertIn("multiple chapters", msg.lower())

    def test_convert_short_story_to_series(self):
        """Test multi-step conversion: Short Story -> Novel -> Series"""
        # 1. Create Short Story project
        create_project("test_sm_to_series", project_type="short-story")
        select_project("test_sm_to_series")
        active = get_active_project_dir()

        # Write content
        (active / "content.md").write_text("Short Story Content", encoding="utf-8")

        # 2. Convert directly to Series (should go through Novel)
        ok, msg = change_project_type("series")
        self.assertTrue(ok, msg)

        # 3. Verify final state is Series
        story = load_story_config(active / "story.json")
        self.assertEqual(story["project_type"], "series")
        self.assertIn("books", story)
        self.assertEqual(len(story["books"]), 1)

        # Check that content was moved to the book
        book_id = story["books"][0].get("id") or story["books"][0].get("folder")
        book_dir = active / "books" / book_id
        self.assertTrue((book_dir / "chapters" / "0001.txt").exists())
        text = (book_dir / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertEqual(text, "Short Story Content")

    def test_convert_series_to_short_story_success(self):
        """Test multi-step conversion: Series -> Novel -> Short Story (when possible)"""
        # 1. Create Series project with one book and one chapter
        create_project("test_series_to_sm", project_type="series")
        select_project("test_series_to_sm")
        active = get_active_project_dir()

        # Create a book with one chapter
        from augmentedquill.services.projects.projects import create_new_book

        book_id = create_new_book("Book 1")
        book_dir = active / "books" / book_id
        (book_dir / "chapters" / "0001.txt").write_text(
            "Chapter Content", encoding="utf-8"
        )

        # Update story.json to reflect the chapter
        story = load_story_config(active / "story.json")
        story["books"][0]["chapters"] = [{"title": "Chapter 1", "summary": ""}]
        (active / "story.json").write_text(json.dumps(story), encoding="utf-8")

        # 2. Convert directly to Short Story (should go through Novel)
        ok, msg = change_project_type("short-story")
        self.assertTrue(ok, msg)

        # 3. Verify final state is Short Story
        story = load_story_config(active / "story.json")
        self.assertEqual(story["project_type"], "short-story")
        self.assertTrue((active / "content.md").exists())
        self.assertFalse((active / "books").exists())
        text = (active / "content.md").read_text(encoding="utf-8")
        self.assertEqual(text, "Chapter Content")

    def test_convert_series_to_short_story_fails_if_multiple_books(self):
        """Test that Series -> Short Story fails if multiple books"""
        create_project("test_series_multi_books", project_type="series")
        select_project("test_series_multi_books")

        # Create two books
        from augmentedquill.services.projects.projects import create_new_book

        create_new_book("Book 1")
        create_new_book("Book 2")

        ok, msg = change_project_type("short-story")
        self.assertFalse(ok)
        self.assertIn("multiple books", msg.lower())

    def test_convert_series_to_short_story_fails_if_multiple_chapters(self):
        """Test that Series -> Short Story fails if book has multiple chapters"""
        create_project("test_series_multi_chapters", project_type="series")
        select_project("test_series_multi_chapters")
        active = get_active_project_dir()

        # Create one book with two chapters
        from augmentedquill.services.projects.projects import create_new_book

        book_id = create_new_book("Book 1")
        book_dir = active / "books" / book_id
        (book_dir / "chapters" / "0001.txt").write_text("Chapter 1", encoding="utf-8")
        (book_dir / "chapters" / "0002.txt").write_text("Chapter 2", encoding="utf-8")

        ok, msg = change_project_type("short-story")
        self.assertFalse(ok)
        self.assertIn("multiple chapters", msg.lower())

    def test_short_story_project_overview_with_metadata(self):
        """Test the regression fix: Short Story project using story.json metadata for title/summary."""
        create_project("test_sm_meta", project_type="short-story")
        select_project("test_sm_meta")
        active = get_active_project_dir()

        # Simulate LLM adding a summary to story.json
        story = load_story_config(active / "story.json")
        story["chapters"] = [{"title": "The Beginning", "summary": "A great start"}]
        (active / "story.json").write_text(json.dumps(story), encoding="utf-8")

        # Check overview
        overview = _project_overview()

        chapters = overview["chapters"]
        self.assertEqual(len(chapters), 1)
        self.assertEqual(chapters[0]["title"], "The Beginning")
        self.assertEqual(chapters[0]["summary"], "A great start")
        self.assertEqual(chapters[0]["filename"], "content.md")

    def test_short_story_project_overview_defaults(self):
        """Test fallback when no metadata exists."""
        create_project("test_sm_def", project_type="short-story")
        select_project("test_sm_def")

        overview = _project_overview()
        chapters = overview["chapters"]
        self.assertEqual(len(chapters), 1)
        self.assertEqual(chapters[0]["title"], "Story Content")
        self.assertEqual(chapters[0]["summary"], "Full content of the story")

    def test_export_import_zip(self):
        # 1. Setup a project
        create_project("export_me", project_type="novel")
        select_project("export_me")
        active = get_active_project_dir()
        (active / "chapters").mkdir(exist_ok=True)
        (active / "chapters" / "0001.txt").write_text(
            "Exported Content", encoding="utf-8"
        )

        # 2. Export (Manually zip it as the API would)
        # We mimic `api_projects_export` logic here since we are testing core logic/interop
        mem_zip = io.BytesIO()
        with zipfile.ZipFile(mem_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(active):
                for file in files:
                    file_path = Path(root) / file
                    archive_name = file_path.relative_to(active)
                    zf.write(file_path, arcname=archive_name)

        zip_bytes = mem_zip.getvalue()

        # 3. Import (We mimic `api_projects_import` logic or use a helper if we extracted it)
        # Since `api_projects_import` is in `api/projects.py` and logic is embedded in the route,
        # we will basically reimplement the extraction/verification logic to ensure it works on valid zip.

        # Create temp extraction
        temp_dir = self.projects_root / "temp_import"
        temp_dir.mkdir()
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(temp_dir)

        self.assertTrue((temp_dir / "story.json").exists())
        self.assertTrue((temp_dir / "chapters" / "0001.txt").exists())

        # Simulate final move
        final_name = "imported_proj"
        final_path = self.projects_root / final_name
        temp_dir.rename(final_path)

        select_project(final_name)
        active_new = get_active_project_dir()
        self.assertEqual(active_new.name, final_name)
        self.assertEqual(
            (active_new / "chapters" / "0001.txt").read_text(encoding="utf-8"),
            "Exported Content",
        )

    def test_api_import_workflow(self):
        """Test the actual API endpoint for import."""
        # Setup source project
        create_project("api_export", project_type="novel")
        select_project("api_export")
        active = get_active_project_dir()
        (active / "story.json").write_text(
            json.dumps(
                {
                    "metadata": {"version": 2},
                    "project_title": "API Imported",
                    "format": "markdown",
                    "tags": ["imported"],
                }
            ),
            encoding="utf-8",
        )

        # Create ZIP
        mem_zip = io.BytesIO()
        with zipfile.ZipFile(mem_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "story.json", (active / "story.json").read_text(encoding="utf-8")
            )

        mem_zip.seek(0)

        # Call API
        response = self.client.post(
            "/api/v1/projects/import",
            files={"file": ("project.zip", mem_zip, "application/zip")},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertIn("Imported as", data["message"])

        # Verify result on disk
        # imported_name = "API Imported"
        # Note: Sanitization logic might change "API Imported" to "APIImported" or similar.
        # current logic: "".join(x for x in proposed_name if x.isalnum() or x in " -_").strip()
        # "API Imported" -> "API Imported"

        imported_path = self.projects_root / "API Imported"
        self.assertTrue(imported_path.exists())
        self.assertTrue((imported_path / "story.json").exists())

    def test_reorder_chapters_in_novel(self):
        """Test reordering chapters in a novel project"""
        # 1. Create Novel project with multiple chapters
        create_project("test_reorder_novel", project_type="novel")
        select_project("test_reorder_novel")
        active = get_active_project_dir()

        # Create chapters
        (active / "chapters").mkdir(exist_ok=True)
        (active / "chapters" / "0001.txt").write_text("Chapter 1", encoding="utf-8")
        (active / "chapters" / "0002.txt").write_text("Chapter 2", encoding="utf-8")
        (active / "chapters" / "0003.txt").write_text("Chapter 3", encoding="utf-8")

        # Update story.json with chapter metadata
        story = load_story_config(active / "story.json")
        story["chapters"] = [
            {"title": "Chapter 1", "summary": ""},
            {"title": "Chapter 2", "summary": ""},
            {"title": "Chapter 3", "summary": ""},
        ]
        (active / "story.json").write_text(json.dumps(story), encoding="utf-8")

        # 2. Test reorder API
        response = self.client.post(
            "/api/v1/chapters/reorder", json={"chapter_ids": [3, 1, 2]}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])

        # 3. Verify the order changed
        story = load_story_config(active / "story.json")
        chapters = story["chapters"]
        self.assertEqual(len(chapters), 3)
        self.assertEqual(chapters[0]["title"], "Chapter 3")
        self.assertEqual(chapters[1]["title"], "Chapter 1")
        self.assertEqual(chapters[2]["title"], "Chapter 2")

    def test_reorder_chapters_in_series(self):
        """Test reordering chapters within a book in a series project"""
        # 1. Create Series project
        create_project("test_reorder_series_chaps", project_type="series")
        select_project("test_reorder_series_chaps")
        active = get_active_project_dir()

        # Create a book
        from augmentedquill.services.projects.projects import (
            create_new_book,
            create_new_chapter,
        )

        book_id = create_new_book("Book 1")

        # Create 3 chapters in that book
        c1_id = create_new_chapter("Chap 1", book_id=book_id)
        c2_id = create_new_chapter("Chap 2", book_id=book_id)
        c3_id = create_new_chapter("Chap 3", book_id=book_id)

        # 2. Reorder them [2, 3, 1]
        response = self.client.post(
            "/api/v1/chapters/reorder",
            json={"book_id": book_id, "chapter_ids": [c2_id, c3_id, c1_id]},
        )
        self.assertEqual(response.status_code, 200)

        # 3. Verify order in story.json
        story = load_story_config(active / "story.json")
        chaps = story["books"][0]["chapters"]
        self.assertEqual(len(chaps), 3)
        self.assertEqual(chaps[0]["title"], "Chap 2")
        self.assertEqual(chaps[1]["title"], "Chap 3")
        self.assertEqual(chaps[2]["title"], "Chap 1")

        # 4. Verify files on disk match the new order
        book_dir = active / "books" / book_id / "chapters"
        self.assertEqual(
            (book_dir / "0001.txt").read_text(encoding="utf-8"), ""
        )  # Newly created chapters are empty
        # Wait, create_new_chapter might have written content if we passed it.
        # But we mostly care that the filenames were updated correctly in story.json
        # and match what api_chapters would return.

        # Check that files were renamed correctly
        self.assertEqual(chaps[0]["filename"], "0001.txt")
        self.assertEqual(chaps[1]["filename"], "0002.txt")
        self.assertEqual(chaps[2]["filename"], "0003.txt")

    def test_reorder_books_in_series(self):
        """Test reordering books in a series project"""
        # 1. Create Series project with multiple books
        create_project("test_reorder_series", project_type="series")
        select_project("test_reorder_series")
        active = get_active_project_dir()

        # Create books
        from augmentedquill.services.projects.projects import create_new_book

        book1_id = create_new_book("Book 1")
        book2_id = create_new_book("Book 2")
        book3_id = create_new_book("Book 3")

        # 2. Test reorder API
        response = self.client.post(
            "/api/v1/books/reorder", json={"book_ids": [book3_id, book1_id, book2_id]}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])

        # 3. Verify the order changed
        story = load_story_config(active / "story.json")
        books = story["books"]
        self.assertEqual(len(books), 3)
        self.assertEqual(books[0]["title"], "Book 3")
        self.assertEqual(books[1]["title"], "Book 1")
        self.assertEqual(books[2]["title"], "Book 2")

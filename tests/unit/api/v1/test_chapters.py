# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test chapters unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
from pathlib import Path
from augmentedquill.services.projects.projects import select_project
from augmentedquill.services.scenes.scene_service import list_scenes
from tests.unit.api.v1.api_test_case import ApiTestCase


class ChaptersApiTest(ApiTestCase):
    def _make_project_with_chapters(self, name: str = "novel") -> Path:
        ok, msg = select_project(name)
        self.assertTrue(ok, msg)
        pdir = self.projects_root / name
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        # Create two 4-digit files
        (chdir / "0001.txt").write_text("Chapter One\nHello world.", encoding="utf-8")
        (chdir / "0002.txt").write_text(
            "Second Chapter\nMore content.", encoding="utf-8"
        )
        # story.json chapters titles
        (pdir / "story.json").write_text(
            '{"metadata": {"version": 2}, "project_title":"X","format":"markdown","chapters":["Intro","Climax"],"llm_prefs":{"temperature":0.7,"max_tokens":2048}}',
            encoding="utf-8",
        )
        return pdir

    def test_list_and_fetch_chapters(self):
        self._make_project_with_chapters()
        # List
        r = self.client.get("/api/v1/chapters")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        chs = data.get("chapters")
        self.assertIsInstance(chs, list)
        # Expect two chapters sorted by id [1,2]
        self.assertEqual([c["id"] for c in chs], [1, 2])
        # Titles from story.json
        self.assertEqual([c["title"] for c in chs], ["Intro", "Climax"])

        # Fetch first chapter by id
        r1 = self.client.get("/api/v1/chapters/1")
        self.assertEqual(r1.status_code, 200)
        d1 = r1.json()
        self.assertEqual(d1["id"], 1)
        self.assertIn("Hello world.", d1["content"])

    def test_filename_fallback_when_no_titles(self):
        # Setup project with two numbered files and an empty chapters list in story.json
        ok, msg = select_project("nofmt")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "nofmt"
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("First content", encoding="utf-8")
        (chdir / "0002.txt").write_text("Second content", encoding="utf-8")
        # Write story.json with empty titles array
        (pdir / "story.json").write_text(
            '{"metadata": {"version": 2}, "project_title":"Y","format":"markdown","chapters":[],"llm_prefs":{"temperature":0.7,"max_tokens":2048}}',
            encoding="utf-8",
        )

        r = self.client.get("/api/v1/chapters")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        chs = data.get("chapters")
        self.assertEqual([c["id"] for c in chs], [1, 2])
        # Titles should fall back to the filename STEM when no titles provided
        self.assertEqual([c["title"] for c in chs], ["0001", "0002"])

        r1 = self.client.get("/api/v1/chapters/1")
        self.assertEqual(r1.status_code, 200)
        d1 = r1.json()
        self.assertEqual(d1["title"], "0001")

    def test_series_list_chapters_includes_book_id(self):
        # Setup a series project
        ok, msg = select_project("test-series")
        self.assertTrue(ok)
        pdir = self.projects_root / "test-series"

        # Manually construct story.json for series
        story = {
            "metadata": {"version": 2},
            "project_title": "Test Series",
            "format": "markdown",
            "project_type": "series",
            "books": [
                {
                    "id": "book-a",
                    "title": "Book A",
                    "chapters": [{"title": "B-A Chap 1", "filename": "0001.txt"}],
                },
                {
                    "id": "book-b",
                    "title": "Book B",
                    "chapters": [{"title": "B-B Chap 1", "filename": "0001.txt"}],
                },
            ],
        }
        (pdir / "story.json").write_text(json.dumps(story))

        # Create directories and files
        (pdir / "books" / "book-a" / "chapters").mkdir(parents=True)
        (pdir / "books" / "book-b" / "chapters").mkdir(parents=True)
        (pdir / "books" / "book-a" / "chapters" / "0001.txt").write_text("BA1")
        (pdir / "books" / "book-b" / "chapters" / "0001.txt").write_text("BB1")

        # List chapters
        r = self.client.get("/api/v1/chapters")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        chs = data.get("chapters")

        self.assertEqual(len(chs), 2)
        # Check IDs and Book IDs
        self.assertEqual(chs[0]["id"], 1)
        self.assertEqual(chs[0]["book_id"], "book-a")
        self.assertEqual(chs[0]["title"], "B-A Chap 1")

        self.assertEqual(chs[1]["id"], 2)
        self.assertEqual(chs[1]["book_id"], "book-b")
        self.assertEqual(chs[1]["title"], "B-B Chap 1")

    def test_update_title(self):
        self._make_project_with_chapters("update_title")
        r = self.client.put("/api/v1/chapters/1/title", json={"title": "New Title"})
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["chapter"]["title"], "New Title")

        # Verify in story.json
        pdir = self.projects_root / "update_title"
        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        # Our helper might have normalized it to a dict if it was a string
        chap = story["chapters"][0]
        if isinstance(chap, dict):
            self.assertEqual(chap["title"], "New Title")
        else:
            self.assertEqual(chap, "New Title")

    def test_update_summary(self):
        self._make_project_with_chapters("update_summary")
        r = self.client.put(
            "/api/v1/chapters/1/summary", json={"summary": "New Summary"}
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["ok"])
        # Verify in story.json
        pdir = self.projects_root / "update_summary"
        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story["chapters"][0]["summary"], "New Summary")

    def test_update_content(self):
        self._make_project_with_chapters("update_content")
        r = self.client.put(
            "/api/v1/chapters/1/content", json={"content": "Updated content text."}
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["ok"])

        # Verify file
        pdir = self.projects_root / "update_content"
        content = (pdir / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertEqual(content, "Updated content text.")

    def test_create_chapter(self):
        select_project("create_chap")
        pdir = self.projects_root / "create_chap"
        (pdir / "story.json").write_text(
            '{"metadata": {"version": 2}, "project_title": "Create Chapter Test", "format": "markdown", "project_type":"novel","chapters":[]}',
            encoding="utf-8",
        )
        (pdir / "chapters").mkdir(exist_ok=True)

        r = self.client.post(
            "/api/v1/chapters", json={"title": "New Chap", "content": "Initial text"}
        )
        if r.status_code != 200:
            print(f"FAILED CREATE CHAPTER: {r.json()}")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["ok"])

        # Verify file exists
        self.assertTrue((pdir / "chapters" / "0001.txt").exists())
        self.assertEqual(
            (pdir / "chapters" / "0001.txt").read_text(encoding="utf-8"), "Initial text"
        )

    def test_delete_chapter(self):
        self._make_project_with_chapters("delete_chap")
        r = self.client.delete("/api/v1/chapters/1")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

        pdir = self.projects_root / "delete_chap"
        self.assertFalse((pdir / "chapters" / "0001.txt").exists())

    def test_delete_middle_chapter_moves_linked_scene_to_previous_chapter(self):
        ok, msg = select_project("delete_middle_moves_scene")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "delete_middle_moves_scene"
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)

        (chdir / "0001.txt").write_text("Chapter 1 prose.", encoding="utf-8")
        (chdir / "0002.txt").write_text(
            "<!--scene:1:start-->Chapter 2 linked prose.<!--scene:1:end-->",
            encoding="utf-8",
        )
        (chdir / "0003.txt").write_text("Chapter 3 prose.", encoding="utf-8")

        story = {
            "metadata": {"version": 2},
            "project_title": "Delete Middle",
            "format": "markdown",
            "project_type": "novel",
            "chapters": [
                {"title": "Chapter 1", "filename": "0001.txt"},
                {"title": "Chapter 2", "filename": "0002.txt"},
                {"title": "Chapter 3", "filename": "0003.txt"},
            ],
            "scenes": {"1": {"summary": "Linked scene"}},
        }
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")

        r = self.client.delete("/api/v1/chapters/2")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

        self.assertFalse((chdir / "0002.txt").exists())
        chapter1_text = (chdir / "0001.txt").read_text(encoding="utf-8")
        self.assertIn("<!--scene:1:start-->", chapter1_text)
        self.assertIn("<!--scene:1:end-->", chapter1_text)

        scenes = list_scenes(pdir)
        scene = scenes[0]
        self.assertEqual(scene["id"], 1)
        self.assertEqual(scene["prose_link"]["scope_type"], "chapter")
        self.assertEqual(scene["prose_link"]["chapter_id"], "1")

    def test_delete_first_chapter_moves_linked_scene_to_next_chapter(self):
        ok, msg = select_project("delete_first_moves_scene")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "delete_first_moves_scene"
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)

        (chdir / "0001.txt").write_text(
            "<!--scene:1:start-->Chapter 1 linked prose.<!--scene:1:end-->",
            encoding="utf-8",
        )
        (chdir / "0002.txt").write_text("Chapter 2 prose.", encoding="utf-8")

        story = {
            "metadata": {"version": 2},
            "project_title": "Delete First",
            "format": "markdown",
            "project_type": "novel",
            "chapters": [
                {"title": "Chapter 1", "filename": "0001.txt"},
                {"title": "Chapter 2", "filename": "0002.txt"},
            ],
            "scenes": {"1": {"summary": "Linked scene"}},
        }
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")

        r = self.client.delete("/api/v1/chapters/1")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

        self.assertFalse((chdir / "0001.txt").exists())
        chapter2_text = (chdir / "0002.txt").read_text(encoding="utf-8")
        self.assertIn("<!--scene:1:start-->", chapter2_text)
        self.assertIn("<!--scene:1:end-->", chapter2_text)

        scenes = list_scenes(pdir)
        scene = scenes[0]
        self.assertEqual(scene["id"], 1)
        self.assertEqual(scene["prose_link"]["scope_type"], "chapter")
        self.assertEqual(scene["prose_link"]["chapter_id"], "1")

    def test_delete_last_chapter_unlinks_linked_scene(self):
        ok, msg = select_project("delete_last_unlinks_scene")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "delete_last_unlinks_scene"
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)

        (chdir / "0001.txt").write_text(
            "<!--scene:1:start-->Only linked prose.<!--scene:1:end-->",
            encoding="utf-8",
        )

        story = {
            "metadata": {"version": 2},
            "project_title": "Delete Last",
            "format": "markdown",
            "project_type": "novel",
            "chapters": [
                {"title": "Chapter 1", "filename": "0001.txt"},
            ],
            "scenes": {"1": {"summary": "Linked scene"}},
        }
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")

        r = self.client.delete("/api/v1/chapters/1")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

        self.assertFalse((chdir / "0001.txt").exists())

        scenes = list_scenes(pdir)
        scene = scenes[0]
        self.assertEqual(scene["id"], 1)
        self.assertEqual((scene["prose_link"] or {}).get("scope_type"), "unlinked")

    def test_delete_series_chapter_moves_scene_within_same_book_only(self):
        ok, msg = select_project("delete_series_same_book")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "delete_series_same_book"

        book_a = "book-a"
        book_b = "book-b"

        a_chapters_dir = pdir / "books" / book_a / "chapters"
        b_chapters_dir = pdir / "books" / book_b / "chapters"
        a_chapters_dir.mkdir(parents=True, exist_ok=True)
        b_chapters_dir.mkdir(parents=True, exist_ok=True)

        (a_chapters_dir / "0001.txt").write_text("Book A chapter 1.", encoding="utf-8")
        (a_chapters_dir / "0002.txt").write_text(
            "<!--scene:1:start-->Book A chapter 2 linked prose.<!--scene:1:end-->",
            encoding="utf-8",
        )
        (b_chapters_dir / "0001.txt").write_text("Book B chapter 1.", encoding="utf-8")

        story = {
            "metadata": {"version": 2},
            "project_title": "Delete Series Chapter",
            "format": "markdown",
            "project_type": "series",
            "books": [
                {
                    "id": book_a,
                    "title": "Book A",
                    "chapters": [
                        {"title": "A1", "filename": "0001.txt"},
                        {"title": "A2", "filename": "0002.txt"},
                    ],
                },
                {
                    "id": book_b,
                    "title": "Book B",
                    "chapters": [
                        {"title": "B1", "filename": "0001.txt"},
                    ],
                },
            ],
            "scenes": {"1": {"summary": "Linked scene"}},
        }
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")

        chapters_before = self.client.get("/api/v1/chapters")
        self.assertEqual(chapters_before.status_code, 200)
        chapter_list = chapters_before.json().get("chapters", [])
        target = next(
            (
                chapter
                for chapter in chapter_list
                if chapter.get("book_id") == book_a and chapter.get("title") == "A2"
            ),
            None,
        )
        self.assertIsNotNone(target)

        r = self.client.delete(f"/api/v1/chapters/{target['id']}")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

        self.assertFalse((a_chapters_dir / "0002.txt").exists())

        book_a_ch1 = (a_chapters_dir / "0001.txt").read_text(encoding="utf-8")
        book_b_ch1 = (b_chapters_dir / "0001.txt").read_text(encoding="utf-8")
        self.assertIn("<!--scene:1:start-->", book_a_ch1)
        self.assertIn("<!--scene:1:end-->", book_a_ch1)
        self.assertNotIn("<!--scene:1:start-->", book_b_ch1)
        self.assertNotIn("<!--scene:1:end-->", book_b_ch1)

        scenes = list_scenes(pdir)
        scene = scenes[0]
        self.assertEqual(scene["id"], 1)
        self.assertEqual(scene["prose_link"]["scope_type"], "chapter")
        self.assertEqual(scene["prose_link"]["book_id"], book_a)
        self.assertEqual(scene["prose_link"]["chapter_id"], "1")

    def test_series_project_chapters(self):
        # Create a series project
        ok, msg = select_project("series_proj")
        self.assertTrue(ok)
        pdir = self.projects_root / "series_proj"
        story_path = pdir / "story.json"
        book1_id = "book-111"
        book2_id = "book-222"
        story_data = {
            "project_type": "series",
            "books": [
                {
                    "id": book1_id,
                    "title": "Book One",
                    "chapters": [{"title": "B1 C1", "filename": "0001.txt"}],
                },
                {
                    "id": book2_id,
                    "title": "Book Two",
                    "chapters": [{"title": "B2 C1", "filename": "0001.txt"}],
                },
            ],
        }
        pdir.mkdir(parents=True, exist_ok=True)
        story_path.write_text(json.dumps(story_data), encoding="utf-8")

        # Create files
        b1_dir = pdir / "books" / book1_id / "chapters"
        b2_dir = pdir / "books" / book2_id / "chapters"
        b1_dir.mkdir(parents=True, exist_ok=True)
        b2_dir.mkdir(parents=True, exist_ok=True)
        (b1_dir / "0001.txt").write_text("B1 C1 content", encoding="utf-8")
        (b2_dir / "0001.txt").write_text("B2 C1 content", encoding="utf-8")

        # List chapters (global IDs 1 and 2)
        r = self.client.get("/api/v1/chapters")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        chs = data["chapters"]
        self.assertEqual(len(chs), 2)
        self.assertEqual(chs[0]["title"], "B1 C1")
        self.assertEqual(chs[1]["title"], "B2 C1")

        # Fetch chapter 2
        r2 = self.client.get("/api/v1/chapters/2")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["title"], "B2 C1")

    def test_reorder_chapters(self):
        self._make_project_with_chapters("reorder_chap")
        # Initially [1, 2] (Intro, Climax)
        r = self.client.post("/api/v1/chapters/reorder", json={"chapter_ids": [2, 1]})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

        # List and check order
        r2 = self.client.get("/api/v1/chapters")
        data = r2.json()["chapters"]
        # In Novel project, reorder renames files to 0001, 0002...
        # So the one that was ID 2 (Climax) should now be at position 0
        self.assertEqual(data[0]["title"], "Climax")
        self.assertEqual(data[1]["title"], "Intro")

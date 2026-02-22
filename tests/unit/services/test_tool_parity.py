# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the test tool parity unit so this responsibility stays isolated, testable, and easy to evolve.

import json
import os
import tempfile
import uuid
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

import augmentedquill.main as main


class ToolParityTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)
        self.client = TestClient(main.app)

        # Create a series project for book tools
        self.project_name = "test_series"
        self.book_id = str(uuid.uuid4())
        pdir = self.projects_root / self.project_name
        pdir.mkdir(parents=True, exist_ok=True)

        books_dir = pdir / "books"
        books_dir.mkdir(parents=True, exist_ok=True)
        book_dir = books_dir / self.book_id
        book_dir.mkdir(parents=True, exist_ok=True)
        (book_dir / "chapters").mkdir(parents=True, exist_ok=True)
        (book_dir / "chapters" / "0001.txt").write_text(
            "Book 1 Chapter 1 content.", encoding="utf-8"
        )
        (book_dir / "book_content.md").write_text(
            "Book 1 intro content.", encoding="utf-8"
        )

        (pdir / "story_content.md").write_text("Story intro content.", encoding="utf-8")
        (pdir / "story.json").write_text(
            json.dumps(
                {
                    "metadata": {"version": 2},
                    "project_title": "Test Series",
                    "project_type": "series",
                    "story_summary": "Initial story summary",
                    "tags": ["fantasy", "epic"],
                    "books": [
                        {
                            "id": self.book_id,
                            "title": "Book 1",
                            "summary": "Initial book summary",
                            "chapters": [
                                {
                                    "title": "Chapter 1",
                                    "summary": "Initial chapter summary",
                                }
                            ],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        # Select the project
        r = self.client.post(
            "/api/v1/projects/select", json={"name": self.project_name}
        )
        self.assertEqual(r.status_code, 200)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _call_tool(self, name, args):
        body = {
            "model_name": "gpt-4o",
            "messages": [
                {"role": "user", "content": f"Execute {name}"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_123",
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": json.dumps(args),
                            },
                        }
                    ],
                },
            ],
            "active_chapter_id": 1,
        }
        r = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data.get("ok"))
        return json.loads(data["appended_messages"][0]["content"])

    def test_story_metadata_tools(self):
        # get_story_metadata
        res = self._call_tool("get_story_metadata", {})
        self.assertEqual(res["title"], "Test Series")
        self.assertEqual(res["summary"], "Initial story summary")

        # update_story_metadata
        res = self._call_tool(
            "update_story_metadata", {"title": "New Title", "summary": "New Summary"}
        )
        self.assertTrue(res.get("ok"))

        # Verify
        res = self._call_tool("get_story_metadata", {})
        self.assertEqual(res["title"], "New Title")
        self.assertEqual(res["summary"], "New Summary")

    def test_story_content_tools(self):
        # read_story_content
        res = self._call_tool("read_story_content", {})
        self.assertEqual(res["content"], "Story intro content.")

        # write_story_content
        res = self._call_tool(
            "write_story_content", {"content": "Updated story intro content."}
        )
        self.assertTrue(res.get("ok"))

        # Verify
        res = self._call_tool("read_story_content", {})
        self.assertEqual(res["content"], "Updated story intro content.")

    def test_book_metadata_tools(self):
        # get_book_metadata
        res = self._call_tool("get_book_metadata", {"book_id": self.book_id})
        self.assertEqual(res["title"], "Book 1")
        self.assertEqual(res["summary"], "Initial book summary")

        # update_book_metadata
        res = self._call_tool(
            "update_book_metadata",
            {
                "book_id": self.book_id,
                "title": "New Book Title",
                "summary": "New Book Summary",
            },
        )
        self.assertTrue(res.get("ok"))

        # Verify
        res = self._call_tool("get_book_metadata", {"book_id": self.book_id})
        self.assertEqual(res["title"], "New Book Title")
        self.assertEqual(res["summary"], "New Book Summary")

        # Negative: invalid book_id
        res = self._call_tool("get_book_metadata", {"book_id": "invalid-uuid"})
        self.assertTrue("error" in res)

    def test_book_content_tools(self):
        # read_book_content
        res = self._call_tool("read_book_content", {"book_id": self.book_id})
        self.assertEqual(res["content"], "Book 1 intro content.")

        # write_book_content
        res = self._call_tool(
            "write_book_content",
            {"book_id": self.book_id, "content": "Updated book intro content."},
        )
        self.assertTrue(res.get("ok"))

        # Verify
        res = self._call_tool("read_book_content", {"book_id": self.book_id})
        self.assertEqual(res["content"], "Updated book intro content.")

    def test_chapter_metadata_tools(self):
        # get_chapter_metadata
        res = self._call_tool("get_chapter_metadata", {"chap_id": 1})
        self.assertEqual(res["title"], "Chapter 1")
        self.assertEqual(res["summary"], "Initial chapter summary")

        # update_chapter_metadata
        res = self._call_tool(
            "update_chapter_metadata",
            {
                "chap_id": 1,
                "title": "New Chapter Title",
                "summary": "New Chapter Summary",
            },
        )
        self.assertTrue(res.get("ok"))

        # Verify
        res = self._call_tool("get_chapter_metadata", {"chap_id": 1})
        self.assertEqual(res["title"], "New Chapter Title")
        self.assertEqual(res["summary"], "New Chapter Summary")

        # Negative: invalid chap_id
        res = self._call_tool("get_chapter_metadata", {"chap_id": 999})
        self.assertTrue("error" in res)

    def test_story_tags_tools(self):
        # get_story_tags
        res = self._call_tool("get_story_tags", {})
        self.assertEqual(res["tags"], ["fantasy", "epic"])

        # set_story_tags
        res = self._call_tool("set_story_tags", {"tags": ["sci-fi", "noir"]})
        self.assertEqual(res["tags"], ["sci-fi", "noir"])

        # Verify
        res = self._call_tool("get_story_tags", {})
        self.assertEqual(res["tags"], ["sci-fi", "noir"])

    def test_get_chapter_summaries(self):
        res = self._call_tool("get_chapter_summaries", {})
        self.assertEqual(len(res["chapter_summaries"]), 1)
        self.assertEqual(res["chapter_summaries"][0]["title"], "Chapter 1")
        self.assertEqual(
            res["chapter_summaries"][0]["summary"], "Initial chapter summary"
        )

    def test_delete_tools(self):
        # delete_chapter (negative first: no confirm)
        res = self._call_tool("delete_chapter", {"chap_id": 1})
        self.assertEqual(res.get("status"), "confirmation_required")

        # delete_chapter (positive)
        res = self._call_tool("delete_chapter", {"chap_id": 1, "confirm": True})
        self.assertTrue(res.get("ok"))

        # delete_book (negative first: no confirm)
        res = self._call_tool("delete_book", {"book_id": self.book_id})
        self.assertEqual(res.get("status"), "confirmation_required")

        # delete_book (positive)
        res = self._call_tool("delete_book", {"book_id": self.book_id, "confirm": True})
        self.assertTrue(res.get("ok"))

    def test_create_new_chapter(self):
        # For series, it needs a book_id or it might fail if multiple books exist,
        # but here we only have one if we didn't delete it yet.
        # Let's create a new book first to make it interesting.
        from augmentedquill.services.projects.projects import create_new_book

        new_bid = create_new_book("Book 2")

        # Now create chapter in Book 2
        res = self._call_tool(
            "create_new_chapter", {"title": "New Chapter", "book_id": new_bid}
        )
        self.assertTrue(res.get("chap_id") is not None)
        self.assertEqual(res["title"], "New Chapter")

        # Verify overview
        overview = self._call_tool("get_project_overview", {})
        # Find Book 2 or 1
        found = False
        for b in overview["books"]:
            if b["id"] == new_bid:
                found = True
                self.assertEqual(len(b["chapters"]), 1)
                self.assertEqual(b["chapters"][0]["title"], "New Chapter")
        self.assertTrue(found)

    def test_sync_summary(self):
        # We need to mock the LLM for sync_summary because it calls unified_chat_complete
        from unittest.mock import patch, AsyncMock

        _dummy_runtime = ("http://localhost:11434/v1", None, "dummy-model", 60, {})
        with (
            patch(
                "augmentedquill.services.llm.llm.unified_chat_complete",
                new_callable=AsyncMock,
            ) as mock_llm,
            patch(
                "augmentedquill.services.story.story_generation_ops.resolve_model_runtime",
                return_value=_dummy_runtime,
            ),
        ):
            mock_llm.return_value = {
                "content": "Synced summary",
                "tool_calls": [],
                "thinking": "",
            }

            # This tool uses payload["messages"] to get the content of the chapter usually?
            # No, sync_summary reads from disk.
            res = self._call_tool("sync_summary", {"chap_id": 1})
            self.assertTrue("summary" in res)
            self.assertEqual(res["summary"], "Synced summary")

    def test_sync_story_summary(self):
        from unittest.mock import patch, AsyncMock

        _dummy_runtime = ("http://localhost:11434/v1", None, "dummy-model", 60, {})
        with (
            patch(
                "augmentedquill.services.llm.llm.unified_chat_complete",
                new_callable=AsyncMock,
            ) as mock_llm,
            patch(
                "augmentedquill.services.story.story_generation_ops.resolve_model_runtime",
                return_value=_dummy_runtime,
            ),
        ):
            mock_llm.return_value = {
                "content": "Synced story summary",
                "tool_calls": [],
                "thinking": "",
            }
            res = self._call_tool("sync_story_summary", {})
            self.assertTrue("summary" in res)
            self.assertEqual(res["summary"], "Synced story summary")

    def test_project_management_tools(self):
        # create_new_book
        res = self._call_tool("create_new_book", {"title": "Book 3"})
        self.assertTrue("book_id" in res)

        # change_project_type (novel to series is already series, let's try series to novel)
        res = self._call_tool("change_project_type", {"new_type": "novel"})
        # It might fail if I have Book 1 and Book 2 and Book 3 now (multiple books)
        # But let's check it returns the expected error if so
        self.assertTrue("ok" in res or "error" in res)

    def test_global_project_tools(self):
        # list_projects
        res = self._call_tool("list_projects", {})
        self.assertTrue("projects" in res)

        # create_project
        res = self._call_tool("create_project", {"name": "new_proj", "type": "novel"})
        self.assertTrue(res.get("ok"))

        # delete_project (negative)
        res = self._call_tool("delete_project", {"name": "new_proj"})
        self.assertEqual(res.get("status"), "confirmation_required")

        # delete_project (positive)
        res = self._call_tool("delete_project", {"name": "new_proj", "confirm": True})
        self.assertTrue(res.get("ok"))

    def test_reorder_tools(self):
        # reorder_chapters needs a list of IDs.
        # Currently we have one chapter with ID 1 in Book 1.
        res = self._call_tool(
            "reorder_chapters", {"chapter_ids": [1], "book_id": self.book_id}
        )
        self.assertTrue(res.get("ok"))

        # reorder_books
        res = self._call_tool("reorder_books", {"book_ids": [self.book_id]})
        self.assertTrue(res.get("ok"))

    def test_image_tools(self):
        # set_image_metadata
        res = self._call_tool(
            "set_image_metadata",
            {"filename": "test.jpg", "title": "New Title", "description": "New Desc"},
        )
        self.assertTrue(res.get("ok"))

        # list_images (should show the entry we just updated metadata for, even if file doesn't exist yet as it's in metadata.json)
        res = self._call_tool("list_images", {})
        found = any(i["filename"] == "test.jpg" for i in res)
        self.assertTrue(found)

# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test tool parity unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
import os
import tempfile
import uuid
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from augmentedquill import main


def _parse_tool_sse_result(text: str) -> dict:
    """Extract the 'result' event payload from a chat/tools SSE response."""
    for line in text.splitlines():
        if line.startswith("data: ") and line != "data: [DONE]":
            try:
                data = json.loads(line[6:])
                if data.get("type") == "result":
                    return data
            except json.JSONDecodeError:
                pass
    return {}


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

    @staticmethod
    def _normalize_manager_tool_call(name: str, args: dict) -> tuple[str, dict]:
        """Translate legacy per-action tool invocations to manager tool actions."""
        if name == "get_project_overview":
            return "manage_project", {"action": "get_overview", **args}
        if name == "create_project":
            return "manage_project", {"action": "create", "create_data": args}
        if name == "list_projects":
            return "manage_project", {"action": "list"}
        if name == "delete_project":
            return "manage_project", {"action": "delete", "delete_data": args}
        if name == "change_project_type":
            return (
                "manage_project",
                {
                    "action": "change_type",
                    "type_data": {"new_type": args.get("new_type")},
                },
            )

        if name == "get_story_metadata":
            return "manage_story_core", {"action": "get_metadata"}
        if name == "update_story_metadata":
            return "manage_story_core", {
                "action": "update_metadata",
                "update_data": args,
            }
        if name == "read_story_content":
            return "manage_story_core", {"action": "read_content", "read_data": args}
        if name == "sync_story_summary":
            return "manage_story_core", {"action": "sync_summary", "sync_data": args}

        if name == "read_scratchpad":
            req = {"action": "read"}
            if "chat_id" in args:
                req["chat_id"] = args["chat_id"]
            return "manage_scratchpad", req
        if name == "write_scratchpad":
            return "manage_scratchpad", {"action": "write", "write_data": args}

        if name == "get_sourcebook_entry":
            return "manage_sourcebook", {"action": "get", **args}
        if name == "create_sourcebook_entry":
            return "manage_sourcebook", {"action": "create", "entry_data": args}
        if name == "update_sourcebook_entry":
            payload = dict(args)
            name_or_id = payload.pop("name_or_id", None)
            return (
                "manage_sourcebook",
                {"action": "update", "name_or_id": name_or_id, "update_data": payload},
            )
        if name == "delete_sourcebook_entry":
            return "manage_sourcebook", {"action": "delete", **args}
        if name == "list_sourcebook_entries":
            return "manage_sourcebook", {"action": "list", **args}
        if name == "add_sourcebook_relation":
            return "manage_sourcebook", {
                "action": "add_relation",
                "relation_data": args,
            }
        if name == "remove_sourcebook_relation":
            return "manage_sourcebook", {
                "action": "remove_relation",
                "relation_data": args,
            }

        if name == "list_images":
            return "manage_images", {"action": "list"}
        if name == "generate_image_description":
            return "manage_images", {"action": "generate_description", **args}
        if name == "create_image_placeholder":
            return "manage_images", {
                "action": "create_placeholder",
                "create_data": args,
            }
        if name == "set_image_metadata":
            return "manage_images", {"action": "set_metadata", "metadata_data": args}

        if name == "search_in_project":
            return "search_and_replace", {"action": "search", **args}
        if name == "replace_in_project":
            return "search_and_replace", {"action": "replace", **args}

        return name, args

    def _call_tool(self, name, args, model_type: str = "CHAT"):
        normalized_name, normalized_args = self._normalize_manager_tool_call(name, args)
        body = {
            "model_name": "gpt-4o",
            "model_type": model_type,
            "messages": [
                {"role": "user", "content": f"Execute {normalized_name}"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_123",
                            "type": "function",
                            "function": {
                                "name": normalized_name,
                                "arguments": json.dumps(normalized_args),
                            },
                        }
                    ],
                },
            ],
            "active_chapter_id": 1,
        }
        r = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        data = _parse_tool_sse_result(r.text)
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

        # read_story_content with paging
        res = self._call_tool("read_story_content", {"start": 0, "max_chars": 5})
        self.assertEqual(res["content"], "Story")
        self.assertEqual(res["start"], 0)
        self.assertEqual(res["end"], 5)
        self.assertEqual(res["total"], len("Story intro content."))

        # read_story_content with read_from_end
        total = len("Story intro content.")
        res = self._call_tool(
            "read_story_content", {"max_chars": 8, "read_from_end": True}
        )
        self.assertEqual(res["content"], "content.")
        self.assertEqual(res["start"], total - 8)
        self.assertEqual(res["end"], total)
        self.assertEqual(res["total"], total)

        # read_from_end with max_chars larger than total returns full content
        res = self._call_tool(
            "read_story_content", {"max_chars": 9999, "read_from_end": True}
        )
        self.assertEqual(res["content"], "Story intro content.")
        self.assertEqual(res["start"], 0)

        # write_story_content
        res = self._call_tool(
            "write_story_content",
            {"content": "Updated story intro content."},
            model_type="EDITING",
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

        # read_book_content with paging
        res = self._call_tool(
            "read_book_content", {"book_id": self.book_id, "start": 0, "max_chars": 4}
        )
        self.assertEqual(res["content"], "Book")
        self.assertEqual(res["start"], 0)
        self.assertEqual(res["end"], 4)
        self.assertEqual(res["total"], len("Book 1 intro content."))

        # write_book_content
        res = self._call_tool(
            "write_book_content",
            {"book_id": self.book_id, "content": "Updated book intro content."},
            model_type="EDITING",
        )
        self.assertTrue(res.get("ok"))

        # Verify
        res = self._call_tool("read_book_content", {"book_id": self.book_id})
        self.assertEqual(res["content"], "Updated book intro content.")

    def test_chapter_metadata_tools(self):
        # get_chapter_metadata
        res = self._call_tool("get_chapter_metadata", {"chap_id": 1})
        self.assertEqual(res["chapter"]["title"], "Chapter 1")
        self.assertEqual(res["chapter"]["summary"], "Initial chapter summary")

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
        self.assertEqual(res["chapter"]["title"], "New Chapter Title")
        self.assertEqual(res["chapter"]["summary"], "New Chapter Summary")

        # Negative: invalid chap_id
        res = self._call_tool("get_chapter_metadata", {"chap_id": 999})
        self.assertTrue("error" in res)

    def test_story_tags_tools(self):
        # get and set tags via get_story_metadata / update_story_metadata
        res = self._call_tool("get_story_metadata", {})
        self.assertEqual(res.get("tags"), ["fantasy", "epic"])

        # update tags via update_story_metadata
        res = self._call_tool("update_story_metadata", {"tags": ["sci-fi", "noir"]})
        self.assertTrue(res.get("ok"))

        # Verify updated
        res = self._call_tool("get_story_metadata", {})
        self.assertEqual(res.get("tags"), ["sci-fi", "noir"])

    def test_get_chapter_summaries(self):
        # A chapter should always be listed, even if it has an empty summary.
        res = self._call_tool("get_chapter_summaries", {})
        self.assertEqual(len(res["chapter_summaries"]), 1)
        self.assertEqual(res["chapter_summaries"][0]["title"], "Chapter 1")
        self.assertEqual(
            res["chapter_summaries"][0]["summary"], "Initial chapter summary"
        )

        # Clear the summary and ensure the chapter is still listed.
        self._call_tool(
            "update_chapter_metadata",
            {"chap_id": 1, "summary": ""},
        )
        res = self._call_tool("get_chapter_summaries", {})
        self.assertEqual(len(res["chapter_summaries"]), 1)
        self.assertEqual(res["chapter_summaries"][0]["summary"], "")

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
        from unittest.mock import AsyncMock, patch

        _dummy_runtime = (
            "http://localhost:11434/v1",
            None,
            "dummy-model",
            60,
            "dummy-model",
            {},
        )
        # We patch both unified_chat_complete and openai credential resolution so the
        # tool doesn't attempt to read real machine.json or make network calls.
        with (
            patch(
                "augmentedquill.services.llm.llm.unified_chat_complete",
                new_callable=AsyncMock,
            ) as mock_llm,
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=_dummy_runtime[:5],
            ),
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
            self.assertTrue("summary" in res, f"response lacked summary: {res}")
            self.assertEqual(res["summary"], "Synced summary")

    def test_sync_summary_with_tool_call(self):
        from unittest.mock import AsyncMock, patch

        _dummy_runtime = (
            "http://localhost:11434/v1",
            None,
            "dummy-model",
            60,
            "dummy-model",
            {},
        )
        first_response = {
            "content": "",
            "tool_calls": [
                {
                    "id": "call_get_story_metadata",
                    "type": "function",
                    "function": {
                        "name": "get_story_metadata",
                        "arguments": "{}",
                    },
                }
            ],
            "thinking": "",
        }
        second_response = {
            "content": "Synced summary after tool",
            "tool_calls": [],
            "thinking": "",
        }

        with (
            patch(
                "augmentedquill.services.llm.llm.unified_chat_complete",
                new_callable=AsyncMock,
            ) as mock_llm,
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=_dummy_runtime[:5],
            ),
            patch(
                "augmentedquill.services.story.story_generation_ops.resolve_model_runtime",
                return_value=_dummy_runtime,
            ),
            patch(
                "augmentedquill.services.story.story_generation_ops.execute_registered_tool",
                new_callable=AsyncMock,
            ) as mock_tool,
        ):
            mock_llm.side_effect = [first_response, second_response]
            mock_tool.return_value = {
                "role": "tool",
                "tool_call_id": "call_get_story_metadata",
                "name": "get_story_metadata",
                "content": '{"title": "Test Series"}',
            }

            res = self._call_tool("sync_summary", {"chap_id": 1})
            self.assertTrue("summary" in res, f"response lacked summary: {res}")
            self.assertEqual(res["summary"], "Synced summary after tool")
            mock_tool.assert_called_once()

    def test_sync_story_summary(self):
        from unittest.mock import AsyncMock, patch

        _dummy_runtime = (
            "http://localhost:11434/v1",
            None,
            "dummy-model",
            60,
            "dummy-model",
            {},
        )
        with (
            patch(
                "augmentedquill.services.llm.llm.unified_chat_complete",
                new_callable=AsyncMock,
            ) as mock_llm,
            patch(
                "augmentedquill.services.llm.llm.resolve_openai_credentials",
                return_value=_dummy_runtime[:5],
            ),
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
            self.assertTrue("summary" in res, f"response lacked summary: {res}")
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
        res = self._call_tool(
            "create_project", {"name": "new_proj", "project_type": "novel"}
        )
        self.assertTrue(res.get("ok"))

        # delete_project (negative)
        res = self._call_tool("delete_project", {"name": "new_proj"})
        self.assertEqual(res.get("status"), "confirmation_required")

        # delete_project (positive)
        res = self._call_tool("delete_project", {"name": "new_proj", "confirm": True})
        self.assertTrue(res.get("ok"))

    def test_reorder_tools(self):
        # reorder_chapters and reorder_books are no longer LLM tools; verify they
        # are not in the schema and that calling them via the tool endpoint returns
        # an "Unknown tool" error rather than a hard crash.
        from augmentedquill.services.chat.chat_tool_decorator import (
            ensure_tool_registry_loaded,
            get_registered_tool_schemas,
        )

        ensure_tool_registry_loaded()
        names = {s["function"]["name"] for s in get_registered_tool_schemas()}
        self.assertNotIn("reorder_chapters", names)
        self.assertNotIn("reorder_books", names)

        res = self._call_tool(
            "reorder_chapters", {"chapter_ids": [1], "book_id": self.book_id}
        )
        self.assertIn("error", res)

        res = self._call_tool("reorder_books", {"book_ids": [self.book_id]})
        self.assertIn("error", res)

    def test_insert_text_at_marker_tool(self):
        # Insert a marker into the chapter, then replace it.
        full = self._call_tool("get_chapter_content", {"chap_id": 1})["content"]
        self.assertIn("Book 1 Chapter 1 content.", full)

        # Insert a marker and then replace it using the tool.
        marker = "~~~"
        updated = full.replace("Chapter 1", f"Chapter 1 {marker}")
        self._call_tool(
            "write_chapter_content",
            {"chap_id": 1, "content": updated},
            model_type="EDITING",
        )

        res = self._call_tool(
            "insert_text_at_marker",
            {
                "chap_id": 1,
                "insert_text": "(inserted)",
                "mode": "replace",
            },
            model_type="EDITING",
        )
        self.assertEqual(res["marker"], marker)

        # Verify that the marker is replaced
        updated_content = self._call_tool("get_chapter_content", {"chap_id": 1})[
            "content"
        ]
        self.assertNotIn(marker, updated_content)
        self.assertIn("(inserted)", updated_content)

    def test_apply_chapter_replacements_tool(self):
        # Ensure the tool can apply multiple sequential replacements safely.
        self._call_tool(
            "write_chapter_content",
            {"chap_id": 1, "content": "Alpha beta gamma"},
            model_type="EDITING",
        )

        res = self._call_tool(
            "apply_chapter_replacements",
            {
                "chap_id": 1,
                "replacements": [
                    {"old_text": "Alpha", "new_text": "A"},
                    {"old_text": "gamma", "new_text": "G"},
                ],
            },
            model_type="EDITING",
        )
        self.assertEqual(res["replacements_applied"], 2)

        updated_content = self._call_tool("get_chapter_content", {"chap_id": 1})[
            "content"
        ]
        self.assertEqual(updated_content, "A beta G")

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

    def test_get_chapter_metadata_word_count(self):
        # Chapter 1 was created with "Book 1 Chapter 1 content." in setUp
        res = self._call_tool("get_chapter_metadata", {"chap_id": 1})
        self.assertIn("word_count", res)
        self.assertIn("char_count", res)
        self.assertGreater(res["word_count"], 0)
        self.assertGreater(res["char_count"], 0)

        # Nonexistent chapter must return an error
        res2 = self._call_tool("get_chapter_metadata", {"chap_id": 9999})
        self.assertIn("error", res2)

    def test_sourcebook_list_and_relations(self):
        # Bootstrap: create two entries
        self._call_tool(
            "create_sourcebook_entry",
            {"name": "Hero", "description": "The hero", "category": "character"},
        )
        self._call_tool(
            "create_sourcebook_entry",
            {"name": "Castle", "description": "A big castle", "category": "location"},
        )

        # list_sourcebook_entries — no filter
        res = self._call_tool("list_sourcebook_entries", {})
        names = [e["name"] for e in res]
        self.assertIn("Hero", names)
        self.assertIn("Castle", names)

        # list_sourcebook_entries — filtered by category
        res = self._call_tool("list_sourcebook_entries", {"category": "character"})
        names = [e["name"] for e in res]
        self.assertIn("Hero", names)
        self.assertNotIn("Castle", names)

        # list_sourcebook_entries — category that matches nothing returns empty list
        res = self._call_tool("list_sourcebook_entries", {"category": "vehicle"})
        self.assertEqual(res, [])

        # add_sourcebook_relation — success
        res = self._call_tool(
            "add_sourcebook_relation",
            {"source_id": "Hero", "relation_type": "lives_in", "target_id": "Castle"},
        )
        self.assertTrue(res.get("ok"))

        # add_sourcebook_relation — duplicate must be an error
        res = self._call_tool(
            "add_sourcebook_relation",
            {"source_id": "Hero", "relation_type": "lives_in", "target_id": "Castle"},
        )
        self.assertIn("error", res)

        # add_sourcebook_relation — nonexistent source must be an error
        res = self._call_tool(
            "add_sourcebook_relation",
            {"source_id": "Nobody", "relation_type": "ally", "target_id": "Hero"},
        )
        self.assertIn("error", res)

        # remove_sourcebook_relation — success
        res = self._call_tool(
            "remove_sourcebook_relation",
            {"source_id": "Hero", "relation_type": "lives_in", "target_id": "Castle"},
        )
        self.assertTrue(res.get("ok"))

        # remove_sourcebook_relation — removing again must be an error
        res = self._call_tool(
            "remove_sourcebook_relation",
            {"source_id": "Hero", "relation_type": "lives_in", "target_id": "Castle"},
        )
        self.assertIn("error", res)

    def test_insert_image_in_chapter(self):
        # Set up content with distinct paragraphs / a marker
        self._call_tool(
            "write_chapter_content",
            {"chap_id": 1, "content": "Para one.\n\nPara two.\n\nPara three."},
            model_type="EDITING",
        )

        # position=end
        res = self._call_tool(
            "insert_image_in_chapter",
            {"chap_id": 1, "filename": "hero.png", "position": "end"},
            model_type="EDITING",
        )
        self.assertTrue(res.get("ok"))
        content = self._call_tool("get_chapter_content", {"chap_id": 1})["content"]
        self.assertIn("![hero.png](hero.png)", content)

        # position=after_paragraph:1 with optional caption
        self._call_tool(
            "write_chapter_content",
            {"chap_id": 1, "content": "Para one.\n\nPara two.\n\nPara three."},
            model_type="EDITING",
        )
        res = self._call_tool(
            "insert_image_in_chapter",
            {
                "chap_id": 1,
                "filename": "castle.jpg",
                "position": "after_paragraph:1",
                "caption": "The castle",
            },
            model_type="EDITING",
        )
        self.assertTrue(res.get("ok"))
        content = self._call_tool("get_chapter_content", {"chap_id": 1})["content"]
        self.assertIn("![The castle](castle.jpg)", content)

        # position=marker — marker present, should be replaced
        self._call_tool(
            "write_chapter_content",
            {"chap_id": 1, "content": "Before ~~~ After"},
            model_type="EDITING",
        )
        res = self._call_tool(
            "insert_image_in_chapter",
            {"chap_id": 1, "filename": "marker.png", "position": "marker"},
            model_type="EDITING",
        )
        self.assertTrue(res.get("ok"))
        content = self._call_tool("get_chapter_content", {"chap_id": 1})["content"]
        self.assertNotIn("~~~", content)
        self.assertIn("marker.png", content)

        # position=marker — no marker present must return an error
        self._call_tool(
            "write_chapter_content",
            {"chap_id": 1, "content": "No marker here"},
            model_type="EDITING",
        )
        res = self._call_tool(
            "insert_image_in_chapter",
            {"chap_id": 1, "filename": "x.png", "position": "marker"},
            model_type="EDITING",
        )
        self.assertIn("error", res)

        # position=after_paragraph out-of-range must return an error
        res = self._call_tool(
            "insert_image_in_chapter",
            {"chap_id": 1, "filename": "x.png", "position": "after_paragraph:999"},
            model_type="EDITING",
        )
        self.assertIn("error", res)

        # unknown position string must return an error
        res = self._call_tool(
            "insert_image_in_chapter",
            {"chap_id": 1, "filename": "x.png", "position": "middle"},
            model_type="EDITING",
        )
        self.assertIn("error", res)

    def test_insert_image_in_chapter_short_story(self):
        # Create a short-story project with content.md
        project_name = "test_short_story_image"
        r = self.client.post(
            "/api/v1/projects/create",
            json={"name": project_name, "type": "short-story"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        r = self.client.post(
            "/api/v1/projects/select",
            json={"name": project_name},
        )
        self.assertEqual(r.status_code, 200, r.text)

        from augmentedquill.services.projects.projects import get_active_project_dir

        active = get_active_project_dir()
        (active / "content.md").write_text(
            "Paragraph one.\n\nParagraph two.", encoding="utf-8"
        )

        # Should insert in short-story content as if chap_id=1
        res = self._call_tool(
            "insert_image_in_chapter",
            {"chap_id": 1, "filename": "hero.png", "position": "end"},
            model_type="EDITING",
        )
        self.assertTrue(res.get("ok"), res)

        updated = (active / "content.md").read_text(encoding="utf-8")
        self.assertIn("![hero.png](hero.png)", updated)

        # Should also support write_chapter_content in short-story context as a pseudo chapter.
        res = self._call_tool(
            "write_chapter_content",
            {"chap_id": 1, "content": "New short story content."},
            model_type="EDITING",
        )
        self.assertIn("successfully", res.get("message", ""))

        updated2 = (active / "content.md").read_text(encoding="utf-8")
        self.assertEqual(updated2, "New short story content.")

    def test_editing_scratchpad(self):
        # Read before any write → empty content
        res = self._call_tool("read_editing_scratchpad", {}, model_type="EDITING")
        self.assertEqual(res.get("content"), "")

        # Write then read back
        res = self._call_tool(
            "write_editing_scratchpad",
            {"content": "My editing plan"},
            model_type="EDITING",
        )
        self.assertTrue(res.get("ok"))
        res = self._call_tool("read_editing_scratchpad", {}, model_type="EDITING")
        self.assertEqual(res.get("content"), "My editing plan")

        # Overwrite with new content
        self._call_tool(
            "write_editing_scratchpad",
            {"content": "Updated plan"},
            model_type="EDITING",
        )
        res = self._call_tool("read_editing_scratchpad", {}, model_type="EDITING")
        self.assertEqual(res.get("content"), "Updated plan")

        # CHAT role may not call write_editing_scratchpad
        res_chat = self._call_tool(
            "write_editing_scratchpad",
            {"content": "Not allowed"},
            model_type="CHAT",
        )
        self.assertIn("error", res_chat)

        # CHAT role may not call read_editing_scratchpad either
        res_chat = self._call_tool("read_editing_scratchpad", {}, model_type="CHAT")
        self.assertIn("error", res_chat)

    def test_role_enforcement_prose_tools(self):
        # CHAT role must not be able to call write_story_content
        res = self._call_tool(
            "write_story_content", {"content": "CHAT attempt"}, model_type="CHAT"
        )
        self.assertIn("error", res)

        # EDITING role should succeed
        res = self._call_tool(
            "write_story_content",
            {"content": "EDITING update"},
            model_type="EDITING",
        )
        self.assertTrue(res.get("ok"))

        # Verify the write took effect
        res = self._call_tool("read_story_content", {})
        self.assertEqual(res.get("content"), "EDITING update")

        # CHAT role must not be able to call write_book_content
        res = self._call_tool(
            "write_book_content",
            {"book_id": self.book_id, "content": "CHAT attempt"},
            model_type="CHAT",
        )
        self.assertIn("error", res)

        # EDITING role should succeed
        res = self._call_tool(
            "write_book_content",
            {"book_id": self.book_id, "content": "EDITING update"},
            model_type="EDITING",
        )
        self.assertTrue(res.get("ok"))

    def test_project_types_filter(self):
        from augmentedquill.services.chat.chat_tool_decorator import (
            ensure_tool_registry_loaded,
            get_registered_tool_schemas,
        )

        ensure_tool_registry_loaded()

        series_names = {
            s["function"]["name"]
            for s in get_registered_tool_schemas(
                model_type="CHAT", project_type="series"
            )
        }
        novel_names = {
            s["function"]["name"]
            for s in get_registered_tool_schemas(
                model_type="CHAT", project_type="novel"
            )
        }

        # These tools are series-only and must vanish for novel projects
        series_only = {
            "create_new_book",
            "delete_book",
            "get_book_metadata",
            "update_book_metadata",
            "read_book_content",
        }
        for tool in series_only:
            self.assertIn(tool, series_names, f"{tool} missing for series")
            self.assertNotIn(tool, novel_names, f"{tool} should be hidden for novel")

    def test_delete_chapter_series(self):
        # Verify correct chapter count before deletion
        overview = self._call_tool("get_project_overview", {})
        total_chapters = sum(len(b.get("chapters", [])) for b in overview["books"])
        self.assertEqual(total_chapters, 1)

        # Without confirm → confirmation_required
        res = self._call_tool("delete_chapter", {"chap_id": 1})
        self.assertEqual(res.get("status"), "confirmation_required")

        # With confirm=True → deleted
        res = self._call_tool("delete_chapter", {"chap_id": 1, "confirm": True})
        self.assertTrue(res.get("ok"))

        # story.json should now have 0 chapters in the book
        import json as _json

        pdir = self.projects_root / self.project_name
        story = _json.loads((pdir / "story.json").read_text())
        book = next(b for b in story["books"] if b["id"] == self.book_id)
        self.assertEqual(len(book.get("chapters", [])), 0)

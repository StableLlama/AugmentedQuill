# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Validates all LLM-callable chat tools for successful execution and graceful handling of malformed and invalid tool-call inputs."""

import json
import os
import tempfile
import uuid
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

import augmentedquill.main as main
from augmentedquill.services.chat.chat_tools_schema import get_story_tools
from augmentedquill.services.projects.projects import select_project
from augmentedquill.services.sourcebook.sourcebook_helpers import sb_create


class ChatToolContractsTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)

        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"

        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        self.client = TestClient(main.app)
        self._bootstrap_project()

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _bootstrap_project(self):
        ok, msg = select_project("tool_contracts")
        self.assertTrue(ok, msg)

        pdir = self.projects_root / "tool_contracts"
        self.book_id = str(uuid.uuid4())
        series_chapters_dir = pdir / "books" / self.book_id / "chapters"
        series_chapters_dir.mkdir(parents=True, exist_ok=True)
        (series_chapters_dir / "0001.txt").write_text(
            "Initial chapter one text.", encoding="utf-8"
        )
        (series_chapters_dir / "0002.txt").write_text(
            "Initial chapter two text.", encoding="utf-8"
        )

        (pdir / "books" / self.book_id / "content.md").write_text(
            "Initial book content.", encoding="utf-8"
        )

        (pdir / "images").mkdir(parents=True, exist_ok=True)
        (pdir / "images" / "sample.png").write_bytes(b"\x89PNG\r\n\x1a\n")

        story = {
            "metadata": {"version": 2},
            "project_title": "Tool Contracts",
            "format": "markdown",
            "project_type": "series",
            "chapters": [
                {"title": "Chapter One", "summary": "Summary 1"},
                {"title": "Chapter Two", "summary": "Summary 2"},
            ],
            "books": [
                {
                    "id": self.book_id,
                    "title": "Book One",
                    "summary": "Book summary",
                    "notes": "Book notes",
                    "chapters": [
                        {"id": 1, "title": "Chapter One", "summary": "Summary 1"}
                    ],
                }
            ],
            "llm_prefs": {"temperature": 0.7, "max_tokens": 256},
            "story_summary": "Initial story summary",
            "tags": ["seed"],
        }
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")
        (pdir / "story_content.md").write_text(
            "Initial story content.", encoding="utf-8"
        )

        sb_create(name="Hero Entry", description="A known sourcebook character")

    def _tool_names(self):
        return [t["function"]["name"] for t in get_story_tools()]

    def _call_tool(self, name: str, args):
        if isinstance(args, str):
            arguments = args
        else:
            arguments = json.dumps(args)

        body = {
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": f"call_{name}",
                            "type": "function",
                            "function": {"name": name, "arguments": arguments},
                        }
                    ],
                }
            ],
            "active_chapter_id": 1,
        }
        response = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        appended = payload.get("appended_messages") or []
        self.assertEqual(len(appended), 1, payload)
        msg = appended[0]
        self.assertEqual(msg.get("name"), name)
        self.assertEqual(msg.get("role"), "tool")
        content = json.loads(msg.get("content") or "{}")
        self.assertIsInstance(content, (dict, list, str, int, float, bool, type(None)))
        return content

    def _base_valid_args(self, tool_name: str):
        args = {
            "chap_id": 1,
            "book_id": self.book_id,
            "chapter_ids": [1],
            "book_ids": [self.book_id],
            "filename": "sample.png",
            "name_or_id": "Hero Entry",
            "name": "tmp_project_for_delete",
            "description": "Tool test description",
            "content": "Tool test content",
            "summary": "Tool test summary",
            "heading": "Tool test heading",
            "title": "Tool test title",
            "query": "Hero",
            "tags": ["tool", "test"],
            "project_type": "novel",
            "new_type": "series",
            "confirm": False,
            "mode": "update",
        }

        if tool_name == "create_project":
            args["name"] = "tmp_project_for_delete"
            args["project_type"] = "series"
        if tool_name == "delete_project":
            args["name"] = "tmp_project_for_delete"
            args["confirm"] = False
        if tool_name == "delete_book":
            args["book_id"] = self.book_id
            args["confirm"] = False
        if tool_name == "create_sourcebook_entry":
            args["name"] = "Hero Entry 2"
            args["description"] = "Secondary sourcebook entry"
        if tool_name == "update_sourcebook_entry":
            args["name_or_id"] = "Hero Entry"
            args["description"] = "Updated sourcebook entry"
        if tool_name == "delete_sourcebook_entry":
            args["name_or_id"] = "Hero Entry"
        if tool_name == "delete_chapter":
            args["chap_id"] = 1
            args["confirm"] = False

        return args

    def _build_args_for_schema(self, tool_schema: dict, invalid: bool):
        fn = tool_schema["function"]
        tool_name = fn["name"]
        params = (fn.get("parameters") or {}).get("properties") or {}
        required = set((fn.get("parameters") or {}).get("required") or [])

        base = self._base_valid_args(tool_name)
        built = {}

        for key, prop in params.items():
            if key not in required:
                continue

            if key in base:
                built[key] = base[key]
                continue

            typ = prop.get("type")
            if typ == "integer":
                built[key] = 1
            elif typ == "number":
                built[key] = 1.0
            elif typ == "boolean":
                built[key] = True
            elif typ == "array":
                built[key] = []
            else:
                built[key] = "value"

        # Include select optional arguments that influence semantic behavior.
        if tool_name == "create_project":
            built["project_type"] = base["project_type"]
        if tool_name in {"delete_project", "delete_book", "delete_chapter"}:
            built["confirm"] = base["confirm"]

        if invalid:
            invalid_overrides = {
                "chap_id": 999999,
                "book_id": "missing-book-id",
                "chapter_ids": [999999],
                "book_ids": ["missing-book-id"],
                "filename": "does-not-exist.png",
                "name_or_id": "does-not-exist",
                "project_type": "invalid-project-type",
                "new_type": "invalid-project-type",
                "confirm": True,
            }
            for key, value in invalid_overrides.items():
                if key in built:
                    built[key] = value

        return built

    def test_all_tools_handle_malformed_arguments_gracefully(self):
        for name in self._tool_names():
            content = self._call_tool(name, "{this is not valid json")
            self.assertIsInstance(
                content, (dict, list, str, int, float, bool, type(None))
            )

    def test_all_tools_handle_invalid_content_gracefully(self):
        for tool_schema in get_story_tools():
            args = self._build_args_for_schema(tool_schema, invalid=True)
            content = self._call_tool(tool_schema["function"]["name"], args)
            # Contract: invalid semantic input must never crash tool execution.
            self.assertIsInstance(
                content, (dict, list, str, int, float, bool, type(None))
            )

    def test_all_tools_have_successful_execution_path(self):
        async def fake_generate_summary(**kwargs):
            return {"summary": "AI generated chapter summary", "ok": True}

        async def fake_write_chapter(**kwargs):
            return {"content": "AI generated chapter", "ok": True}

        async def fake_continue_chapter(**kwargs):
            return {"content": "AI chapter continuation", "ok": True}

        async def fake_story_summary(**kwargs):
            return {"story_summary": "AI story summary", "ok": True}

        async def fake_image_description(filename: str, payload: dict):
            return "Generated image description"

        with (
            patch(
                "augmentedquill.services.chat.chat_tools.chapter_tools.generate_chapter_summary",
                side_effect=fake_generate_summary,
            ),
            patch(
                "augmentedquill.services.chat.chat_tools.chapter_tools.write_chapter_from_summary",
                side_effect=fake_write_chapter,
            ),
            patch(
                "augmentedquill.services.chat.chat_tools.chapter_tools.continue_chapter_from_summary",
                side_effect=fake_continue_chapter,
            ),
            patch(
                "augmentedquill.services.story.story_generation_ops.generate_story_summary",
                side_effect=fake_story_summary,
            ),
            patch(
                "augmentedquill.services.chat.chat_tools.image_tools._tool_generate_image_description",
                side_effect=fake_image_description,
            ),
        ):
            for tool_schema in get_story_tools():
                ok, msg = select_project("tool_contracts")
                self.assertTrue(ok, msg)

                name = tool_schema["function"]["name"]
                args = self._build_args_for_schema(tool_schema, invalid=False)
                content = self._call_tool(name, args)

                self.assertNotIn("Execution error", json.dumps(content))
                self.assertNotIn("Invalid parameters", json.dumps(content))

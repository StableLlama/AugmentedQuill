# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the test chat tools unit so this responsibility stays isolated, testable, and easy to evolve.

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

import augmentedquill.main as main
from augmentedquill.services.projects.projects import select_project


class ChatToolsTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)
        self.client = TestClient(main.app)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _bootstrap_project(self):
        ok, msg = select_project("demo")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "demo"
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("Alpha chapter content.", encoding="utf-8")
        (chdir / "0002.txt").write_text("Beta chapter content.", encoding="utf-8")
        (pdir / "story.json").write_text(
            '{"metadata": {"version": 2}, "project_title":"Demo","format":"markdown","chapters":[{"title":"Intro","summary":""},{"title":"Next","summary":""}],"llm_prefs":{"temperature":0.7,"max_tokens":256}}',
            encoding="utf-8",
        )

    def test_update_metadata_and_aliases(self):
        self._bootstrap_project()

        # 1. Test update_chapter_metadata with new fields
        body = {
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "u1",
                            "type": "function",
                            "function": {
                                "name": "update_chapter_metadata",
                                "arguments": json.dumps(
                                    {
                                        "chap_id": 1,
                                        "notes": "New note",
                                        "private_notes": "Secret info",
                                        "conflicts": json.dumps(
                                            [{"id": "c1", "description": "Fight!"}]
                                        ),
                                    }
                                ),
                            },
                        }
                    ],
                }
            ]
        }
        r = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(r.status_code, 200)

        # Verify persistence
        pdir = self.projects_root / "demo"
        with open(pdir / "story.json", "r") as f:
            story = json.load(f)
        chap1 = story["chapters"][0]
        self.assertEqual(chap1.get("notes"), "New note")
        self.assertEqual(chap1.get("private_notes"), "Secret info")
        self.assertEqual(len(chap1.get("conflicts", [])), 1)

        # 2. Test aliases for story summary
        body_alias = {
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "a1",
                            "type": "function",
                            "function": {
                                "name": "get_story_metadata",
                                "arguments": "{}",
                            },
                        }
                    ],
                }
            ]
        }
        r = self.client.post("/api/v1/chat/tools", json=body_alias)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("Demo", data["appended_messages"][0]["content"])

    def test_tools_execute_write_functions(self):
        self._bootstrap_project()

        # Test write_chapter_content
        body_content = {
            "model_name": None,
            "messages": [
                {"role": "user", "content": "Write new content to chapter 1"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_write_content",
                            "type": "function",
                            "function": {
                                "name": "write_chapter_content",
                                "arguments": '{"chap_id":1,"content":"Updated content"}',
                            },
                        },
                    ],
                },
            ],
            "active_chapter_id": 1,
        }

        r = self.client.post("/api/v1/chat/tools", json=body_content)
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data.get("ok"))
        app = data.get("appended_messages") or []
        self.assertEqual(len(app), 1)
        t = app[0]
        self.assertEqual(t.get("role"), "tool")
        self.assertEqual(t.get("name"), "write_chapter_content")
        self.assertIn("successfully", t.get("content", ""))

        # Verify content was written
        chapter_file = self.projects_root / "demo" / "chapters" / "0001.txt"
        self.assertEqual(chapter_file.read_text(encoding="utf-8"), "Updated content")

        # Test write_chapter_summary
        body_summary = {
            "model_name": None,
            "messages": [
                {"role": "user", "content": "Write new summary to chapter 1"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_write_summary",
                            "type": "function",
                            "function": {
                                "name": "write_chapter_summary",
                                "arguments": '{"chap_id":1,"summary":"Updated summary"}',
                            },
                        },
                    ],
                },
            ],
            "active_chapter_id": 1,
        }

        r2 = self.client.post("/api/v1/chat/tools", json=body_summary)
        self.assertEqual(r2.status_code, 200, r2.text)
        data2 = r2.json()
        self.assertTrue(data2.get("ok"))
        app2 = data2.get("appended_messages") or []
        self.assertEqual(len(app2), 1)
        t2 = app2[0]
        self.assertEqual(t2.get("role"), "tool")
        self.assertEqual(t2.get("name"), "write_chapter_summary")
        self.assertIn("successfully", t2.get("content", ""))

        # Verify summary was written
        story_file = self.projects_root / "demo" / "story.json"
        story = json.loads(story_file.read_text(encoding="utf-8"))
        self.assertEqual(story["chapters"][0]["summary"], "Updated summary")

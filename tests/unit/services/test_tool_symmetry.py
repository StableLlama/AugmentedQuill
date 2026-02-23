# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test tool symmetry unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from fastapi.testclient import TestClient

import augmentedquill.main as main
from augmentedquill.services.projects.projects import select_project


class TestChatToolsSymmetry(TestCase):
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
        ok, msg = select_project("test_symmetry")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "test_symmetry"
        (pdir / "chapters").mkdir(parents=True, exist_ok=True)
        (pdir / "chapters" / "0001.txt").write_text(
            "Chapter 1 content", encoding="utf-8"
        )

        story_data = {
            "metadata": {"version": 2},
            "project_title": "Original Title",
            "story_summary": "Original Summary",
            "notes": "Original Notes",
            "tags": ["tag1"],
            "project_type": "novel",
            "chapters": [
                {
                    "title": "Chapter 1",
                    "summary": "Chap Summary",
                    "notes": "Chap Notes",
                    "conflicts": [],
                    "filename": "0001.txt",
                }
            ],
        }
        (pdir / "story.json").write_text(json.dumps(story_data), encoding="utf-8")

    def test_story_metadata_symmetry(self):
        self._bootstrap_project()

        # 1. Test update_story_metadata
        update_body = {
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_update",
                            "type": "function",
                            "function": {
                                "name": "update_story_metadata",
                                "arguments": json.dumps(
                                    {
                                        "title": "New Title",
                                        "summary": "New Summary",
                                        "notes": "New Notes",
                                        "tags": ["tag1", "tag2"],
                                    }
                                ),
                            },
                        }
                    ],
                }
            ]
        }
        r = self.client.post("/api/v1/chat/tools", json=update_body)
        self.assertEqual(r.status_code, 200)

        # 2. Test get_story_metadata symmetry
        get_body = {
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_get",
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
        r = self.client.post("/api/v1/chat/tools", json=get_body)
        data = r.json()
        content = json.loads(data["appended_messages"][0]["content"])

        self.assertEqual(content["title"], "New Title")
        self.assertEqual(content["summary"], "New Summary")
        self.assertEqual(content["notes"], "New Notes")
        self.assertEqual(content["tags"], ["tag1", "tag2"])
        self.assertEqual(content["project_type"], "novel")

    def test_chapter_metadata_symmetry(self):
        self._bootstrap_project()

        # 1. Update chapter metadata
        update_body = {
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_update_chap",
                            "type": "function",
                            "function": {
                                "name": "update_chapter_metadata",
                                "arguments": json.dumps(
                                    {
                                        "chap_id": 1,
                                        "title": "New Chapter Title",
                                        "summary": "New Chapter Summary",
                                        "notes": "New Chapter Notes",
                                        "conflicts": [{"description": "Conflict 1"}],
                                    }
                                ),
                            },
                        }
                    ],
                }
            ]
        }
        r = self.client.post("/api/v1/chat/tools", json=update_body)
        self.assertEqual(r.status_code, 200)

        # 2. Get chapter metadata
        get_body = {
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_get_chap",
                            "type": "function",
                            "function": {
                                "name": "get_chapter_metadata",
                                "arguments": json.dumps({"chap_id": 1}),
                            },
                        }
                    ],
                }
            ]
        }
        r = self.client.post("/api/v1/chat/tools", json=get_body)
        data = r.json()
        content = json.loads(data["appended_messages"][0]["content"])

        self.assertEqual(content["title"], "New Chapter Title")
        self.assertEqual(content["summary"], "New Chapter Summary")
        self.assertEqual(content["notes"], "New Chapter Notes")
        self.assertEqual(content["conflicts"][0]["description"], "Conflict 1")

    def test_chapter_metadata_persistence(self):
        self._bootstrap_project()

        # 1. Update chapter via tool
        update_body = {
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_update_persist",
                            "type": "function",
                            "function": {
                                "name": "update_chapter_metadata",
                                "arguments": json.dumps(
                                    {
                                        "chap_id": 1,
                                        "conflicts": [
                                            {"description": "Persistent Conflict"}
                                        ],
                                    }
                                ),
                            },
                        }
                    ],
                }
            ]
        }
        self.client.post("/api/v1/chat/tools", json=update_body)

        # 2. Check the raw story.json file on disk
        pdir = self.projects_root / "test_symmetry"
        story_json = json.loads((pdir / "story.json").read_text(encoding="utf-8"))

        # Find chapter 1 in the novel-type storage
        chap = next(
            c for c in story_json["chapters"] if c.get("filename") == "0001.txt"
        )
        self.assertEqual(chap["conflicts"][0]["description"], "Persistent Conflict")

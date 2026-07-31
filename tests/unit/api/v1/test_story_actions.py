# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines tests for the unified story action streaming endpoint."""

import json
from unittest import mock

from augmentedquill.services.projects.projects import select_project
from tests.unit.api.v1.api_test_case import ApiTestCase


class StoryActionsTest(ApiTestCase):
    captured_messages = None
    captured_extra_body = None

    def setUp(self):
        super().setUp()

        # Minimal mock of user settings
        self.config_dir = self.user_data_root / "config"
        self.config_dir.mkdir(parents=True, exist_ok=True)
        (self.config_dir / "machine.json").write_text(
            json.dumps(
                {
                    "llm": {
                        "active_presets": {
                            "CHAT": "default",
                            "WRITING": "default",
                            "EDITING": "default",
                        },
                        "providers": {
                            "openai": {
                                "base_url": "http://fake",
                                "api_key": "fake-key",
                                "default_model": "gpt-4",
                                "timeout": 30,
                            }
                        },
                    }
                }
            )
        )

        self._patch_llm()

    def tearDown(self):
        super().tearDown()
        mock.patch.stopall()

    def _patch_llm(self):
        StoryActionsTest.captured_messages = None
        StoryActionsTest.captured_extra_body = None

        async def fake_chat_stream(**kwargs):
            StoryActionsTest.captured_messages = kwargs.get("messages")
            StoryActionsTest.captured_extra_body = kwargs.get("extra_body")
            # We yield a recognizable piece of content
            yield {"content": "Generated content chunk."}

        mock.patch(
            "augmentedquill.services.llm.llm.unified_chat_stream",
            side_effect=fake_chat_stream,
        ).start()
        mock.patch(
            "augmentedquill.services.llm.llm.resolve_openai_credentials",
            return_value=("http://fake", "key", "model", 30, "fake"),
        ).start()

    def _make_project(self, name="action_test"):
        StoryActionsTest.captured_messages = None
        StoryActionsTest.captured_extra_body = None
        select_project(name)
        pdir = self.projects_root / name
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("Existing chapter content.", encoding="utf-8")
        story_cfg = {
            "project_title": "Action Story",
            "story_summary": "A grand tale.",
            "tags": ["epic"],
            "chapters": [{"title": "Ch 1", "summary": "Initial summary"}],
            "metadata": {"version": 2},
        }
        (pdir / "story.json").write_text(json.dumps(story_cfg), encoding="utf-8")
        return pdir

    def test_action_stream_invalid_chap_id(self):
        self._make_project()
        r = self.client.post(
            "/api/v1/story/action/stream",
            json={"target": "chapter", "action": "extend", "chap_id": 1},
        )
        # Invalid chap_id 999
        r = self.client.post(
            "/api/v1/story/action/stream",
            json={"target": "chapter", "action": "extend", "chap_id": 999},
        )
        self.assertEqual(r.status_code, 404)

    def test_action_stream_extend_chapter(self):
        pdir = self._make_project()
        chap_f = pdir / "chapters" / "0001.txt"

        r = self.client.post(
            "/api/v1/story/action/stream",
            json={"target": "chapter", "action": "extend", "chap_id": 1},
        )
        self.assertEqual(r.status_code, 200)

        # Check SSE format
        found_content = False
        for line in r.iter_lines():
            if line and line.startswith("data: "):
                content = json.loads(line[6:])
                self.assertEqual(content["content"], "Generated content chunk.")
                found_content = True
        self.assertTrue(found_content)

        # Verify NO persistence (Frontend is master)
        new_content = chap_f.read_text(encoding="utf-8")
        self.assertEqual(new_content, "Existing chapter content.")

    def test_action_stream_rewrite_chapter(self):
        pdir = self._make_project()
        chap_f = pdir / "chapters" / "0001.txt"

        r = self.client.post(
            "/api/v1/story/action/stream",
            json={"target": "chapter", "action": "rewrite", "chap_id": 1},
        )
        self.assertEqual(r.status_code, 200)
        for line in r.iter_lines():
            pass

        self.assertIsNotNone(StoryActionsTest.captured_messages)
        self.assertGreaterEqual(len(StoryActionsTest.captured_messages), 1)
        self.assertEqual(StoryActionsTest.captured_messages[-1]["role"], "user")
        self.assertIn(
            "Task: Continue or rewrite the current draft",
            StoryActionsTest.captured_messages[-1]["content"],
        )
        self.assertIsNone(StoryActionsTest.captured_extra_body)

        # Verify NO persistence
        new_content = chap_f.read_text(encoding="utf-8")
        self.assertEqual(new_content, "Existing chapter content.")

    def test_action_stream_update_summary(self):
        pdir = self._make_project()
        story_f = pdir / "story.json"

        r = self.client.post(
            "/api/v1/story/action/stream",
            json={"target": "summary", "action": "update", "chap_id": 1},
        )
        self.assertEqual(r.status_code, 200)
        for line in r.iter_lines():
            pass

        # Verify NO persistence
        story_cfg = json.loads(story_f.read_text(encoding="utf-8"))
        self.assertEqual(story_cfg["chapters"][0]["summary"], "Initial summary")

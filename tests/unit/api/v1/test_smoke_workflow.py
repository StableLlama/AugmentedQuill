# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the smoke workflow unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
from tests.unit.api.v1.api_test_case import ApiTestCase


class SmokeWorkflowTest(ApiTestCase):
    def test_smoke_project_chapter_chat_checkpoint_workflow(self):
        # 1) Create and select a project.
        r_create = self.client.post(
            "/api/v1/projects/create", json={"name": "smoke", "type": "novel"}
        )
        self.assertEqual(r_create.status_code, 200, r_create.text)
        self.assertTrue(r_create.json().get("ok"), r_create.text)

        r_select = self.client.post("/api/v1/projects/select", json={"name": "smoke"})
        self.assertEqual(r_select.status_code, 200, r_select.text)
        self.assertTrue(r_select.json().get("ok"), r_select.text)

        # 2) Create a chapter and write content.
        r_create_ch = self.client.post(
            "/api/v1/chapters", json={"title": "Chapter One", "content": "Initial text"}
        )
        self.assertEqual(r_create_ch.status_code, 200, r_create_ch.text)
        self.assertTrue(r_create_ch.json().get("ok"), r_create_ch.text)

        r_update_ch = self.client.put(
            "/api/v1/chapters/1/content", json={"content": "Mutated text"}
        )
        self.assertEqual(r_update_ch.status_code, 200, r_update_ch.text)
        self.assertTrue(r_update_ch.json().get("ok"), r_update_ch.text)

        # 3) Save and load a chat session.
        chat_payload = {
            "name": "Smoke Chat",
            "messages": [{"role": "user", "content": "hello"}],
        }
        r_save_chat = self.client.post("/api/v1/chats/smoke-chat", json=chat_payload)
        self.assertEqual(r_save_chat.status_code, 200, r_save_chat.text)
        self.assertTrue(r_save_chat.json().get("ok"), r_save_chat.text)

        r_load_chat = self.client.get("/api/v1/chats/smoke-chat")
        self.assertEqual(r_load_chat.status_code, 200, r_load_chat.text)
        self.assertEqual(r_load_chat.json().get("name"), "Smoke Chat")

        # 4) Create checkpoint, mutate file, then restore checkpoint.
        r_checkpoint_create = self.client.post("/api/v1/checkpoints/create")
        self.assertEqual(r_checkpoint_create.status_code, 200, r_checkpoint_create.text)
        ts = r_checkpoint_create.json().get("timestamp")
        self.assertTrue(ts)

        project_dir = self.projects_root / "smoke"
        chapter_file = project_dir / "chapters" / "0001.txt"
        self.assertEqual(chapter_file.read_text(encoding="utf-8"), "Mutated text")

        chapter_file.write_text("Post-checkpoint mutation", encoding="utf-8")

        r_checkpoint_load = self.client.post(
            "/api/v1/checkpoints/load", json={"timestamp": ts}
        )
        self.assertEqual(r_checkpoint_load.status_code, 200, r_checkpoint_load.text)
        self.assertTrue(r_checkpoint_load.json().get("ok"), r_checkpoint_load.text)

        self.assertEqual(chapter_file.read_text(encoding="utf-8"), "Mutated text")

        # 5) Final sanity on chapters endpoint.
        r_chapters = self.client.get("/api/v1/chapters")
        self.assertEqual(r_chapters.status_code, 200, r_chapters.text)
        chapters = (r_chapters.json() or {}).get("chapters") or []
        self.assertEqual(len(chapters), 1)
        self.assertEqual(chapters[0]["title"], "Chapter One")

        # Keep a direct file-level assertion on story metadata shape.
        story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story.get("project_title"), "smoke")

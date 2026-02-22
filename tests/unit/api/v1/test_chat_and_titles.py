# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the test chat and titles unit so this responsibility stays isolated, testable, and easy to evolve.

import os
import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

import augmentedquill.main as main
import augmentedquill.api.v1.chat
from augmentedquill.services.projects.projects import select_project


class ChatAndTitlesTest(TestCase):
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

    def test_api_chat_coerces_invalid_selected_and_lists_models(self):
        # Patch load_machine_config to return models with an invalid selected name
        orig_lmc = augmentedquill.api.v1.chat.load_machine_config

        def fake_lmc(_path):  # type: ignore
            return {
                "openai": {
                    "models": [
                        {
                            "name": "m1",
                            "base_url": "http://x",
                            "api_key": "k",
                            "model": "id1",
                            "timeout_s": 10,
                        },
                        {
                            "name": "m2",
                            "base_url": "http://x",
                            "api_key": "k",
                            "model": "id2",
                            "timeout_s": 10,
                        },
                    ],
                    "selected": "does-not-exist",
                }
            }

        try:
            augmentedquill.api.v1.chat.load_machine_config = fake_lmc  # type: ignore
            r = self.client.get("/api/v1/chat")
            self.assertEqual(r.status_code, 200, r.text)
            data = r.json()
            self.assertEqual(data.get("models"), ["m1", "m2"])
            # Should coerce to first available model
            self.assertEqual(data.get("current_model"), "m1")
        finally:
            augmentedquill.api.v1.chat.load_machine_config = orig_lmc  # type: ignore

    def test_chapter_title_object_object_falls_back_to_filename(self):
        ok, msg = select_project("oob")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "oob"
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("C1", encoding="utf-8")
        (chdir / "0002.txt").write_text("C2", encoding="utf-8")
        # Write story.json with bogus titles that sometimes leak from UI
        (pdir / "story.json").write_text(
            '{"project_title":"Z","format":"markdown","chapters":[{"title":"[object Object]","summary":""},{"title":"[object Object]","summary":""}],"llm_prefs":{"temperature":0.7,"max_tokens":2048},"metadata":{"version":2}}',
            encoding="utf-8",
        )

        # List should fallback to filenames
        r = self.client.get("/api/v1/chapters")
        self.assertEqual(r.status_code, 200)
        chs = r.json().get("chapters")
        self.assertEqual([c["title"] for c in chs], ["0001", "0002"])

        # Fetch single should also fallback
        r1 = self.client.get("/api/v1/chapters/1")
        self.assertEqual(r1.status_code, 200)
        d1 = r1.json()
        self.assertEqual(d1.get("title"), "0001")

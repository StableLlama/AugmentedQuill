# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Shared test base for chat stream coverage tests."""

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from augmentedquill import main
from augmentedquill.services.projects.projects import select_project


class ChatStreamTestBase(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"

        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        self.client = TestClient(main.app)

        (self.projects_root / "testproj").mkdir()
        (self.projects_root / "testproj" / "story.json").write_text(
            '{"metadata": {"version": 2}, "project_title": "Test Project", "format": "markdown"}',
            encoding="utf-8",
        )
        select_project("testproj")

        self.patcher_config = patch("augmentedquill.api.v1.chat.load_machine_config")
        self.mock_config = self.patcher_config.start()
        self.mock_config.return_value = {
            "openai": {
                "models": [
                    {
                        "name": "test-model",
                        "base_url": "http://fake",
                        "api_key": "k",
                        "model": "gpt-fake",
                    }
                ],
                "selected": "test-model",
            }
        }
        self.addCleanup(self.patcher_config.stop)

    def _parse_sse_events(self, text):
        events = []
        for line in text.splitlines():
            if line.startswith("data: "):
                data = line[6:]
                if data == "[DONE]":
                    continue
                try:
                    events.append(json.loads(data))
                except Exception:
                    pass
        return events

# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the test streaming story unit so this responsibility stays isolated, testable, and easy to evolve.

import os
import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

import augmentedquill.main as main
import augmentedquill.services.llm.llm as llm
from augmentedquill.services.projects.projects import select_project


class StreamingStoryTest(TestCase):
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

    def _make_project(self, name: str = "novel") -> Path:
        ok, msg = select_project(name)
        self.assertTrue(ok, msg)
        pdir = self.projects_root / name
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("C1", encoding="utf-8")
        (chdir / "0002.txt").write_text("C2", encoding="utf-8")
        (pdir / "story.json").write_text(
            '{"project_title":"P","format":"markdown","chapters":[{"title":"T1","summary":"S1"},{"title":"T2","summary":"S2"}],"llm_prefs":{"temperature":0.7,"max_tokens":2048},"metadata":{"version":2}}',
            encoding="utf-8",
        )
        return pdir

    def _patch_stream(self):
        # Patch credential resolver to avoid needing config
        self._orig_resolve = llm.resolve_openai_credentials
        self._orig_unified = llm.unified_chat_stream

        def fake_resolve(payload, **kwargs):  # type: ignore
            return ("https://fake/v1", None, "fake-model", 5)

        async def fake_unified(**kwargs):  # type: ignore
            # Yield three chunks to simulate SSE deltas
            for part in ("A", "B", "C"):
                yield {"content": part}

        llm.resolve_openai_credentials = fake_resolve  # type: ignore
        llm.unified_chat_stream = fake_unified  # type: ignore

        def _undo():
            llm.resolve_openai_credentials = self._orig_resolve  # type: ignore
            llm.unified_chat_stream = self._orig_unified  # type: ignore

        self.addCleanup(_undo)

    def test_summary_stream_persists_on_complete(self):
        pdir = self._make_project()
        self._patch_stream()
        r = self.client.post(
            "/api/v1/story/summary/stream",
            json={"chap_id": 1, "mode": "update", "model_name": "fake"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.text, "ABC")
        # Persisted
        import json

        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story["chapters"][0]["summary"], "ABC")

    def test_write_stream_overwrites_file(self):
        pdir = self._make_project()
        self._patch_stream()
        r = self.client.post(
            "/api/v1/story/write/stream", json={"chap_id": 1, "model_name": "fake"}
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.text, "ABC")
        text = (pdir / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertEqual(text, "ABC")

    def test_continue_stream_appends(self):
        pdir = self._make_project()
        self._patch_stream()
        r = self.client.post(
            "/api/v1/story/continue/stream", json={"chap_id": 1, "model_name": "fake"}
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.text, "ABC")
        text = (pdir / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertIn("ABC", text)

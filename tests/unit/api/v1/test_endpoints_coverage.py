# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test endpoints coverage unit so this responsibility stays isolated, testable, and easy to evolve."""

import json

from augmentedquill.main import app
from augmentedquill.services.llm import llm
from augmentedquill.services.projects.projects import select_project
from tests.unit.api.v1.api_test_case import ApiTestCase


class EndpointsCoverageTest(ApiTestCase):
    def setUp(self):
        super().setUp()

        # create a simple project with two chapters to satisfy chapter endpoints
        ok, msg = select_project("coverage_proj")
        assert ok, msg
        pdir = self.projects_root / "coverage_proj"
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("Chapter one text", encoding="utf-8")
        (chdir / "0002.txt").write_text("Chapter two text", encoding="utf-8")
        (pdir / "story.json").write_text(
            json.dumps(
                {
                    "project_title": "Coverage",
                    "format": "markdown",
                    "chapters": [
                        {"title": "T1", "summary": "S1"},
                        {"title": "T2", "summary": "S2"},
                    ],
                    "llm_prefs": {"temperature": 0.7, "max_tokens": 2048},
                    "metadata": {"version": 2},
                }
            ),
            encoding="utf-8",
        )

        # Patch LLM module to deterministic fakes to avoid network calls
        self._orig_resolve = llm.resolve_openai_credentials
        self._orig_unified_complete = llm.unified_chat_complete
        self._orig_unified_stream = llm.unified_chat_stream
        self._orig_completions_stream = llm.openai_completions_stream

        llm.resolve_openai_credentials = lambda payload: (
            "https://fake",
            None,
            "fake",
            5,
        )  # type: ignore

        async def fake_complete(**kwargs):
            return {"content": "ok", "tool_calls": [], "thinking": ""}

        async def fake_stream(**kwargs):
            for c in ("o", "k"):
                yield {"content": c}

        async def fake_completions_stream(**kwargs):
            yield "suggestion chunk"

        llm.unified_chat_complete = fake_complete  # type: ignore
        llm.unified_chat_stream = fake_stream  # type: ignore
        llm.openai_completions_stream = fake_completions_stream  # type: ignore

        self.addCleanup(self._undo_patches)

    def _undo_patches(self):
        llm.resolve_openai_credentials = self._orig_resolve  # type: ignore
        llm.unified_chat_complete = self._orig_unified_complete  # type: ignore
        llm.unified_chat_stream = self._orig_unified_stream  # type: ignore
        llm.openai_completions_stream = self._orig_completions_stream  # type: ignore

    def test_all_registered_routes_have_methods(self):
        """Assert every registered FastAPI route has a path and allowed methods.

        This test validates route registration without issuing HTTP requests to
        avoid side effects; functional endpoint behavior is covered by other unit tests.
        """
        routes = [r for r in app.routes if getattr(r, "path", None)]
        self.assertGreater(len(routes), 0, "No routes registered on app")
        for r in routes:
            path = getattr(r, "path", None)
            methods = getattr(r, "methods", None) or set()
            # Exclude static and docs-presentation routes from strict checks
            if path.startswith(("/static", "/docs", "/openapi.json", "/redoc")):
                continue
            self.assertIsInstance(path, str)
            self.assertTrue(path.startswith("/"))
            self.assertTrue(methods, f"Route {path} exposes no HTTP methods")

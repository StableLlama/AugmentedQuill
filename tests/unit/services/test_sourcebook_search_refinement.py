# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Tests for sourcebook search refinement logic."""

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from augmentedquill.main import app
from augmentedquill.services.projects.projects import select_project
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    sourcebook_create_entry,
    sourcebook_update_entry,
)


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


class SourcebookSearchRefinementTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        self.client = TestClient(app)
        ok, msg = select_project("test_sb")
        self.assertTrue(ok, msg)

        # Create some entries
        sourcebook_create_entry(
            "Alaric", "A brave knight.", "Character", synonyms=["Knight of the Rose"]
        )
        sourcebook_update_entry("Alaric", keywords=["rose", "hero"])
        sourcebook_create_entry("Alaric's Sword", "A sharp blade.", "Item")
        sourcebook_create_entry("Rose Castle", "Where Alaric lives.", "Location")

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _call_search_in_project(self, query: str, scope: str = "sourcebook"):
        body = {
            "model_type": "CHAT",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "c1",
                            "type": "function",
                            "function": {
                                "name": "search_and_replace",
                                "arguments": json.dumps(
                                    {
                                        "action": "search",
                                        "query": query,
                                        "scope": scope,
                                    }
                                ),
                            },
                        }
                    ],
                }
            ],
        }
        response = self.client.post("/api/v1/chat/tools", json=body)
        self.assertEqual(response.status_code, 200)
        appended = _parse_tool_sse_result(response.text).get("appended_messages") or []
        self.assertEqual(len(appended), 1)
        return json.loads(appended[0]["content"])

    def test_search_sourcebook_direct_match_name(self):
        """Search the sourcebook by name through the general project search tool."""
        content = self._call_search_in_project("Alaric")

        self.assertIn("total_matches", content)
        self.assertGreater(content["total_matches"], 0)
        self.assertTrue(
            any(result["section"] == "Alaric" for result in content["results"])
        )

    def test_search_sourcebook_direct_match_synonym(self):
        """Search the sourcebook by synonym through the general project search tool."""
        content = self._call_search_in_project("Knight of the Rose")

        self.assertGreater(content["total_matches"], 0)
        self.assertTrue(
            any(result["section"] == "Alaric" for result in content["results"])
        )

    def test_search_sourcebook_partial_matches_only(self):
        """Search the sourcebook with a partial sourcebook term."""
        content = self._call_search_in_project("Rose")

        self.assertGreaterEqual(content["total_matches"], 1)
        section_titles = {result["section"] for result in content["results"]}
        self.assertIn("Alaric", section_titles)
        self.assertIn("Rose Castle", section_titles)

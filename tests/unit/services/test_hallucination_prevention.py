# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test hallucination prevention unit so this responsibility stays isolated, testable, and easy to evolve."""

import os
import tempfile
import json
from pathlib import Path
from unittest import TestCase
from fastapi.testclient import TestClient

from augmentedquill.main import app
from augmentedquill.services.projects.projects import select_project


class HallucinationPreventionTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)
        self.client = TestClient(app)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _setup_series_project(self):
        pname = "hallu_series"
        ok, msg = select_project(pname)
        self.assertTrue(ok, msg)
        pdir = self.projects_root / pname

        # Book 1
        b1_id = "b1-uuid"
        b1_dir = pdir / "books" / b1_id / "chapters"
        b1_dir.mkdir(parents=True, exist_ok=True)
        (b1_dir / "0001.txt").write_text("B1 C1", encoding="utf-8")
        (b1_dir / "0002.txt").write_text("B1 C2", encoding="utf-8")

        # story.json
        story = {
            "metadata": {"version": 2},
            "project_title": "Hallu Series",
            "project_type": "series",
            "books": [
                {
                    "id": b1_id,
                    "title": "Book 1",
                    "chapters": [
                        {"title": "Chapter 1", "filename": "0001.txt"},
                        {
                            "title": "Chapter 4",
                            "filename": "0002.txt",
                        },  # Title says 4, but it's 2nd
                    ],
                }
            ],
        }
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")
        return b1_id

    def test_chapter_id_not_found_descriptive_error(self):
        self._setup_series_project()
        # Trying to fetch ID 4 which doesn't exist (only 1, 2 exist globally)
        r = self.client.get("/api/v1/chapters/4")
        self.assertEqual(r.status_code, 404)
        detail = r.json().get("detail", "")
        self.assertIn("Chapter with ID 4 not found", detail)
        self.assertIn("Available chapter IDs: [1, 2]", detail)

    def test_reorder_chapters_strict_error(self):
        b1_id = self._setup_series_project()
        # LLM tries to reorder with hallucinated ID 4
        payload = {
            "book_id": b1_id,
            "chapter_ids": [2, 4],  # 1, 2 exist. 4 is hallucinated
        }
        r = self.client.post("/api/v1/chapters/reorder", json=payload)
        self.assertEqual(r.status_code, 400)
        detail = r.json().get("detail", "")
        self.assertIn("Chapter ID 4 not found in project", detail)
        self.assertIn("Available: [1, 2]", detail)

    def test_project_overview_includes_titles_for_series(self):
        self._setup_series_project()
        # Chat tools overview helper
        from augmentedquill.services.projects.project_helpers import _project_overview

        ov = _project_overview()

        books = ov.get("books", [])
        self.assertEqual(len(books), 1)
        b1 = books[0]
        self.assertEqual(b1["title"], "Book 1")
        chaps = b1.get("chapters", [])
        self.assertEqual(len(chaps), 2)

        # Verify that IDs are correctly associated with titles from story.json
        # ID 1 -> Chapter 1
        # ID 2 -> Chapter 4
        self.assertEqual(chaps[0]["id"], 1)
        self.assertEqual(chaps[0]["title"], "Chapter 1")
        self.assertEqual(chaps[1]["id"], 2)
        self.assertEqual(chaps[1]["title"], "Chapter 4")

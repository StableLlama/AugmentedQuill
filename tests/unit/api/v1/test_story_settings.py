# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test story settings unit so this responsibility stays isolated, testable, and easy to evolve."""

import os
import json
import tempfile
from pathlib import Path
from unittest import TestCase
from fastapi.testclient import TestClient

from augmentedquill.main import app
from augmentedquill.services.projects.projects import select_project


class StorySettingsTest(TestCase):
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

    def _make_project(self, name: str = "art_project") -> Path:
        ok, msg = select_project(name)
        self.assertTrue(ok, msg)
        pdir = self.projects_root / name
        pdir.mkdir(parents=True, exist_ok=True)
        (pdir / "story.json").write_text(
            '{"project_title":"Art Book","format":"markdown","chapters":[],"metadata":{"version":2}}',
            encoding="utf-8",
        )
        return pdir

    def test_post_story_settings_updates_image_style(self):
        self._make_project("my_art_project")

        # Initial: should be empty or missing
        pdir = self.projects_root / "my_art_project"
        with open(pdir / "story.json", "r") as f:
            data = json.load(f)
            self.assertIsNone(data.get("image_style"))

        # Update
        payload = {
            "image_style": "Cyberpunk Neon",
            "image_additional_info": "<lora:neon:0.8>",
        }
        response = self.client.post("/api/v1/story/settings", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

        # Verify persistence
        with open(pdir / "story.json", "r") as f:
            data = json.load(f)
            self.assertEqual(data["image_style"], "Cyberpunk Neon")
            self.assertEqual(data["image_additional_info"], "<lora:neon:0.8>")

    def test_post_story_settings_partial_update(self):
        self._make_project("partial_update")

        # Set initial state
        pdir = self.projects_root / "partial_update"
        with open(pdir / "story.json", "w") as f:
            json.dump(
                {
                    "project_title": "P",
                    "image_style": "Old Style",
                    "image_additional_info": "Old Info",
                },
                f,
            )

        # Update only one field
        payload = {"image_style": "New Style"}
        response = self.client.post("/api/v1/story/settings", json=payload)
        self.assertEqual(response.status_code, 200)

        # Verify
        with open(pdir / "story.json", "r") as f:
            data = json.load(f)
            self.assertEqual(data["image_style"], "New Style")
            # Should remain unchanged? Or does the endpoint not touch it?
            # Looking at code:
            # if "image_style" in payload: story["image_style"] = ...
            # if "image_additional_info" in payload: ...
            # So unmatched keys in payload are ignored, missing keys in payload don't overwrite existing with None.
            self.assertEqual(data["image_additional_info"], "Old Info")

    def test_post_story_settings_no_active_project(self):
        # No project selected
        response = self.client.post(
            "/api/v1/story/settings", json={"image_style": "test"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("No active project", response.json()["detail"])

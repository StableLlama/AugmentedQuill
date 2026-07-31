# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test checkpoints unit so this responsibility stays isolated, testable, and easy to evolve."""

from augmentedquill.services.projects.projects import (
    initialize_project_dir,
    select_project,
)

from .api_test_case import ApiTestCase


class CheckpointsTest(ApiTestCase):
    def setUp(self):
        super().setUp()

        # Setup an active project
        self.project_name = "test_project"
        self.project_path = self.projects_root / self.project_name
        initialize_project_dir(self.project_path, project_title="Test Project")
        select_project(self.project_name)

    def test_checkpoints_lifecycle(self):
        # 1. Start client
        client = self.client
        project_dir = self.project_path

        # Check empty list
        resp = client.get("/api/v1/checkpoints")
        assert resp.status_code == 200
        assert len(resp.json()["checkpoints"]) == 0

        # Write a test file
        test_file = project_dir / "test_file.txt"
        test_file.write_text("Hello World", encoding="utf-8")

        # Create checkpoint
        resp = client.post("/api/v1/checkpoints/create")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        timestamp = data["timestamp"]

        # Verify checkpoint exists as dict
        assert (project_dir / "checkpoints" / timestamp).is_dir()
        assert (project_dir / "checkpoints" / timestamp / "test_file.txt").exists()

        resp = client.get("/api/v1/checkpoints")
        assert resp.status_code == 200
        assert len(resp.json()["checkpoints"]) == 1
        assert resp.json()["checkpoints"][0]["timestamp"] == timestamp

        # Modify file
        test_file.write_text("Modified", encoding="utf-8")

        # Load checkpoint
        resp = client.post("/api/v1/checkpoints/load", json={"timestamp": timestamp})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify file is restored
        assert test_file.read_text(encoding="utf-8") == "Hello World"

        # Delete checkpoint
        resp = client.post("/api/v1/checkpoints/delete", json={"timestamp": timestamp})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify list is empty
        resp = client.get("/api/v1/checkpoints")
        assert resp.status_code == 200
        assert len(resp.json()["checkpoints"]) == 0
        assert not (project_dir / "checkpoints" / timestamp).exists()

    def test_checkpoints_endpoints_require_active_project(self):
        # Force no active project by clearing the registry current value.
        self.registry_path.write_text('{"current": "", "recent": []}', encoding="utf-8")

        resp_create = self.client.post("/api/v1/checkpoints/create")
        self.assertEqual(resp_create.status_code, 400)

        resp_load = self.client.post(
            "/api/v1/checkpoints/load", json={"timestamp": "2026-01-01T00-00-00"}
        )
        self.assertEqual(resp_load.status_code, 400)

        resp_delete = self.client.post(
            "/api/v1/checkpoints/delete", json={"timestamp": "2026-01-01T00-00-00"}
        )
        self.assertEqual(resp_delete.status_code, 400)

    def test_load_checkpoint_rejects_invalid_or_missing_timestamp(self):
        resp_invalid = self.client.post(
            "/api/v1/checkpoints/load", json={"timestamp": "../escape"}
        )
        self.assertEqual(resp_invalid.status_code, 404)

        resp_missing = self.client.post(
            "/api/v1/checkpoints/load", json={"timestamp": "missing-checkpoint"}
        )
        self.assertEqual(resp_missing.status_code, 404)

    def test_delete_checkpoint_invalid_name_returns_404(self):
        resp_invalid = self.client.post(
            "/api/v1/checkpoints/delete", json={"timestamp": "bad/name"}
        )
        self.assertEqual(resp_invalid.status_code, 404)

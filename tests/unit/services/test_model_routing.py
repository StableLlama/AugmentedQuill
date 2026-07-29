# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test model routing unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, AsyncMock, patch
from fastapi.testclient import TestClient


class ModelRoutingTest(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.td = tempfile.TemporaryDirectory()
        cls.user_data_dir = Path(cls.td.name)
        cls.projects_root = cls.user_data_dir / "projects"
        cls.projects_root.mkdir(parents=True, exist_ok=True)
        cls.registry_path = cls.user_data_dir / "projects.json"
        cls.config_dir = cls.user_data_dir / "config"
        cls.config_dir.mkdir(parents=True, exist_ok=True)
        cls.machine_config_path = cls.config_dir / "machine.json"

        cls._orig_projects_root = os.environ.get("AUGQ_PROJECTS_ROOT")
        cls._orig_projects_registry = os.environ.get("AUGQ_PROJECTS_REGISTRY")
        cls._orig_machine_config_path = os.environ.get("AUGQ_MACHINE_CONFIG_PATH")

        os.environ["AUGQ_PROJECTS_ROOT"] = str(cls.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(cls.registry_path)
        os.environ["AUGQ_MACHINE_CONFIG_PATH"] = str(cls.machine_config_path)

        machine_json = {
            "openai": {
                "models": [
                    {
                        "name": "Write Mode",
                        "base_url": "http://fake-url/v1",
                        "api_key": "fake",
                        "model": "model-same",
                        "extra_body": '{"mode": "write"}',
                        "timeout_s": 10,
                    },
                    {
                        "name": "Edit Mode",
                        "base_url": "http://fake-url/v1",
                        "api_key": "fake",
                        "model": "model-same",
                        "extra_body": '{"mode": "edit"}',
                        "timeout_s": 10,
                    },
                    {
                        "name": "Chat Mode",
                        "base_url": "http://fake-url/v1",
                        "api_key": "fake",
                        "model": "model-other",
                        "extra_body": '{"mode": "chat"}',
                        "timeout_s": 10,
                    },
                ],
                "selected_writing": "Write Mode",
                "selected_editing": "Edit Mode",
                "selected_chat": "Chat Mode",
                "selected": "Chat Mode",
            }
        }
        cls.machine_config_path.write_text(json.dumps(machine_json), encoding="utf-8")

        # Now import app safely
        from augmentedquill.main import app

        cls.app = app

    @classmethod
    def tearDownClass(cls):
        if cls._orig_projects_root is not None:
            os.environ["AUGQ_PROJECTS_ROOT"] = cls._orig_projects_root
        else:
            os.environ.pop("AUGQ_PROJECTS_ROOT", None)

        if cls._orig_projects_registry is not None:
            os.environ["AUGQ_PROJECTS_REGISTRY"] = cls._orig_projects_registry
        else:
            os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

        if cls._orig_machine_config_path is not None:
            os.environ["AUGQ_MACHINE_CONFIG_PATH"] = cls._orig_machine_config_path
        else:
            os.environ.pop("AUGQ_MACHINE_CONFIG_PATH", None)

        cls.td.cleanup()

    def setUp(self):
        self.client = TestClient(self.app)
        from augmentedquill.services.projects.projects import select_project

        self._make_project(select_project)

    def _make_project(self, select_project, name: str = "novel"):
        ok, msg = select_project(name)
        self.assertTrue(ok, msg)
        pdir = self.projects_root / name
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("C1", encoding="utf-8")
        (pdir / "story.json").write_text(
            '{"project_title":"P","format":"markdown","chapters":[{"title":"T1","summary":"S1"}],"llm_prefs":{"temperature":0.7,"max_tokens":2048},"metadata":{"version":2}}',
            encoding="utf-8",
        )
        return pdir

    def _set_writing_model_extra_body(self, extra_body_obj: dict) -> str:
        """Temporarily override WRITING model extra_body in machine config."""
        original = self.machine_config_path.read_text(encoding="utf-8")
        cfg = json.loads(original)
        for model in cfg.get("openai", {}).get("models", []):
            if model.get("name") == "Write Mode":
                model["extra_body"] = json.dumps(extra_body_obj)
        self.machine_config_path.write_text(json.dumps(cfg), encoding="utf-8")
        return original

    @patch("augmentedquill.services.llm.llm_http_ops.httpx.AsyncClient")
    def test_routing_writing_streaming(self, MockClientClass):
        mock_instance = MagicMock()
        MockClientClass.return_value = mock_instance
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"content-type": "text/event-stream"}
        mock_stream_ctx = MagicMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_stream_ctx.__aexit__ = AsyncMock()
        mock_instance.stream.return_value = mock_stream_ctx

        async def fake_aiter_lines():
            yield (
                "data: "
                + json.dumps({"choices": [{"delta": {"content": "Test\n"}}]})
                + "\n\n"
            )

        mock_resp.aiter_lines = fake_aiter_lines

        r = self.client.post("/api/v1/story/write/stream", json={"chap_id": 1})
        self.assertEqual(r.status_code, 200, r.text)

        call_kwargs = mock_instance.stream.call_args[1]
        payload = call_kwargs["json"]
        self.assertEqual(
            payload.get("mode"),
            "write",
            "Streaming WRITING mode did not route to correct model provider configurations",
        )

    @patch("augmentedquill.services.llm.llm_http_ops.httpx.AsyncClient")
    def test_writing_streaming_never_sends_enable_thinking_true(self, MockClientClass):
        original_cfg = self._set_writing_model_extra_body(
            {
                "mode": "write",
                "chat_template_kwargs": {
                    "enable_thinking": True,
                    "foo": "bar",
                },
            }
        )

        try:
            mock_instance = MagicMock()
            MockClientClass.return_value = mock_instance
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock()

            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.headers = {"content-type": "text/event-stream"}
            mock_stream_ctx = MagicMock()
            mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_resp)
            mock_stream_ctx.__aexit__ = AsyncMock()
            mock_instance.stream.return_value = mock_stream_ctx

            async def fake_aiter_lines():
                yield (
                    "data: "
                    + json.dumps({"choices": [{"delta": {"content": "Test\n"}}]})
                    + "\n\n"
                )

            mock_resp.aiter_lines = fake_aiter_lines

            r = self.client.post("/api/v1/story/write/stream", json={"chap_id": 1})
            self.assertEqual(r.status_code, 200, r.text)

            call_kwargs = mock_instance.stream.call_args[1]
            payload = call_kwargs["json"]
            template_kwargs = payload.get("chat_template_kwargs") or {}
            self.assertNotEqual(template_kwargs.get("enable_thinking"), True)
        finally:
            self.machine_config_path.write_text(original_cfg, encoding="utf-8")

    @patch("augmentedquill.services.llm.llm_http_ops.httpx.AsyncClient")
    def test_routing_writing_rest(self, MockClientClass):
        mock_instance = MagicMock()
        MockClientClass.return_value = mock_instance
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json = lambda: {"choices": [{"message": {"content": "Test"}}]}
        mock_resp.read = lambda: b"{}"
        mock_instance.request = AsyncMock(return_value=mock_resp)

        r = self.client.post("/api/v1/story/write", json={"chap_id": 1})
        self.assertEqual(r.status_code, 200, r.text)

        call_kwargs = mock_instance.request.call_args[1]
        payload = call_kwargs["json"]
        self.assertEqual(
            payload.get("mode"),
            "write",
            "REST WRITING mode did not route to correct model provider configurations",
        )

    @patch("augmentedquill.services.llm.llm_http_ops.httpx.AsyncClient")
    def test_writing_rest_never_sends_enable_thinking_true(self, MockClientClass):
        original_cfg = self._set_writing_model_extra_body(
            {
                "mode": "write",
                "chat_template_kwargs": {
                    "enable_thinking": True,
                    "foo": "bar",
                },
            }
        )

        try:
            mock_instance = MagicMock()
            MockClientClass.return_value = mock_instance
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock()

            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json = lambda: {"choices": [{"message": {"content": "Test"}}]}
            mock_resp.read = lambda: b"{}"
            mock_instance.request = AsyncMock(return_value=mock_resp)

            r = self.client.post("/api/v1/story/write", json={"chap_id": 1})
            self.assertEqual(r.status_code, 200, r.text)

            call_kwargs = mock_instance.request.call_args[1]
            payload = call_kwargs["json"]
            template_kwargs = payload.get("chat_template_kwargs") or {}
            self.assertNotEqual(template_kwargs.get("enable_thinking"), True)
        finally:
            self.machine_config_path.write_text(original_cfg, encoding="utf-8")

    @patch("augmentedquill.services.llm.llm_http_ops.httpx.AsyncClient")
    def test_routing_editing_streaming(self, MockClientClass):
        mock_instance = MagicMock()
        MockClientClass.return_value = mock_instance
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"content-type": "text/event-stream"}
        mock_stream_ctx = MagicMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_stream_ctx.__aexit__ = AsyncMock()
        mock_instance.stream.return_value = mock_stream_ctx

        async def fake_aiter_lines():
            yield (
                "data: "
                + json.dumps({"choices": [{"delta": {"content": "Test\n"}}]})
                + "\n\n"
            )

        mock_resp.aiter_lines = fake_aiter_lines

        r = self.client.post(
            "/api/v1/story/summary/stream", json={"chap_id": 1, "mode": "update"}
        )
        self.assertEqual(r.status_code, 200, r.text)

        call_kwargs = mock_instance.stream.call_args[1]
        payload = call_kwargs["json"]
        self.assertEqual(
            payload.get("mode"),
            "edit",
            "Streaming EDITING mode (summary) did not route to correct model provider configurations",
        )

    @patch("augmentedquill.services.llm.llm_http_ops.httpx.AsyncClient")
    def test_routing_editing_rest(self, MockClientClass):
        mock_instance = MagicMock()
        MockClientClass.return_value = mock_instance
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json = lambda: {"choices": [{"message": {"content": "Test"}}]}
        mock_resp.read = lambda: b"{}"
        mock_instance.request = AsyncMock(return_value=mock_resp)

        r = self.client.post(
            "/api/v1/story/summary", json={"chap_id": 1, "mode": "update"}
        )
        self.assertEqual(r.status_code, 200, r.text)

        call_kwargs = mock_instance.request.call_args[1]
        payload = call_kwargs["json"]
        self.assertEqual(
            payload.get("mode"),
            "edit",
            "REST EDITING mode (summary) did not route to correct model provider configurations",
        )

    @patch("augmentedquill.services.llm.llm_http_ops.httpx.AsyncClient")
    def test_routing_chat_streaming(self, MockClientClass):
        mock_instance = MagicMock()
        MockClientClass.return_value = mock_instance
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"content-type": "text/event-stream"}
        mock_stream_ctx = MagicMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_stream_ctx.__aexit__ = AsyncMock()
        mock_instance.stream.return_value = mock_stream_ctx

        async def fake_aiter_lines():
            yield (
                "data: "
                + json.dumps({"choices": [{"delta": {"content": "Test chat"}}]})
                + "\n\n"
            )

        mock_resp.aiter_lines = fake_aiter_lines

        r = self.client.post(
            "/api/v1/chat/stream",
            json={
                "session_id": "test_session",
                "messages": [{"role": "user", "content": "hello"}],
            },
        )
        self.assertEqual(r.status_code, 200, r.text)

        call_kwargs = mock_instance.stream.call_args[1]
        payload = call_kwargs["json"]
        self.assertEqual(
            payload.get("mode"),
            "chat",
            "Streaming CHAT mode did not route to correct model provider configurations",
        )

    @patch("augmentedquill.services.llm.llm_http_ops.httpx.AsyncClient")
    def test_sourcebook_relevance_does_not_call_llm(self, MockClientClass):
        mock_instance = MagicMock()
        MockClientClass.return_value = mock_instance
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock()

        pdir = self.projects_root / "novel"
        story_path = pdir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["sourcebook"] = {
            "Hero": {
                "description": "Hero profile.",
                "category": "Character",
                "synonyms": [],
            }
        }
        story["scenes"] = {
            "1": {
                "summary": "Arrival",
                "active_characters": ["Hero"],
                "passive_characters": [],
                "sourcebook_entry_ids": [],
                "location": None,
                "order_index": 1,
                "prose_link": {
                    "scope_type": "chapter",
                    "chapter_id": "1",
                    "start_offset": 0,
                    "end_offset": 4,
                },
            }
        }
        story_path.write_text(json.dumps(story), encoding="utf-8")

        r = self.client.post(
            "/api/v1/story/sourcebook/relevance",
            json={"chap_id": 1, "current_text": "text"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"relevant": ["Hero"]})
        mock_instance.request.assert_not_called()

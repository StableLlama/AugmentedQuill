# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, AsyncMock, patch
from fastapi.testclient import TestClient

import app.main as main
from app.projects import select_project


class TestChatStreamCoverage(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"

        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        self.client = TestClient(main.app)

        # Create a dummy project
        (self.projects_root / "testproj").mkdir()
        (self.projects_root / "testproj" / "story.json").write_text(
            "{}", encoding="utf-8"
        )
        select_project("testproj")

        # Mock config to point to a "test" model
        self.patcher_config = patch("app.api.chat.load_machine_config")
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

    @patch("app.api.chat.httpx.AsyncClient")
    def test_streaming_tool_call_hidden_text(self, MockClientClass):
        mock_client_instance = MagicMock()
        MockClientClass.return_value = mock_client_instance
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "text/event-stream"}

        mock_stream_ctx = MagicMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
        mock_stream_ctx.__aexit__ = AsyncMock()

        mock_client_instance.stream.return_value = mock_stream_ctx

        async def fake_aiter_lines():
            yield "data: " + json.dumps(
                {"choices": [{"delta": {"content": "Let me check."}}]}
            ) + "\n\n"
            yield "data: " + json.dumps(
                {"choices": [{"delta": {"content": " [TOOL_CALL]list_"}}]}
            ) + "\n\n"
            yield "data: " + json.dumps(
                {"choices": [{"delta": {"content": "images()[/TOOL_CALL] "}}]}
            ) + "\n\n"
            yield "data: " + json.dumps(
                {"choices": [{"delta": {"content": "Done."}}]}
            ) + "\n\n"
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [{"role": "user", "content": "Show images"}],
            "model_type": "CHAT",
        }

        response = self.client.post("/api/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)

        content_text = ""
        tool_calls = []

        for evt in events:
            if "content" in evt:
                content_text += evt["content"]
            if "tool_calls" in evt:
                tool_calls.extend(evt["tool_calls"])

        self.assertNotIn("list_images", content_text)
        self.assertNotIn("[TOOL_CALL]", content_text)
        self.assertIn("Let me check.", content_text)
        self.assertIn("Done.", content_text)

        self.assertTrue(len(tool_calls) > 0)
        found_tool = any(tc["function"]["name"] == "list_images" for tc in tool_calls)
        self.assertTrue(found_tool, "Did not find list_images tool call")

    @patch("app.api.chat.httpx.AsyncClient")
    def test_editing_model_tools(self, MockClientClass):
        mock_client_instance = MagicMock()
        MockClientClass.return_value = mock_client_instance
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "text/event-stream"}

        mock_stream_ctx = MagicMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
        mock_stream_ctx.__aexit__ = AsyncMock()
        mock_client_instance.stream.return_value = mock_stream_ctx

        async def fake_aiter_lines():
            yield "data: " + json.dumps(
                {"choices": [{"delta": {"content": "Edit start "}}]}
            ) + "\n\n"
            yield "data: " + json.dumps(
                {
                    "choices": [
                        {"delta": {"content": "[TOOL_CALL]list_images()[/TOOL_CALL]"}}
                    ]
                }
            ) + "\n\n"
            yield "data: " + json.dumps(
                {"choices": [{"delta": {"content": " Edit end"}}]}
            ) + "\n\n"
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [{"role": "user", "content": "Fix this"}],
            "model_type": "EDITING",
        }

        response = self.client.post("/api/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)
        content_text = ""
        tool_calls = []
        for evt in events:
            if "content" in evt:
                content_text += evt["content"]
            if "tool_calls" in evt:
                tool_calls.extend(evt["tool_calls"])

        self.assertNotIn("[TOOL_CALL]", content_text)
        self.assertTrue(
            any(tc["function"]["name"] == "list_images" for tc in tool_calls)
        )
        self.assertIn("Edit start", content_text)
        self.assertIn("Edit end", content_text)

    @patch("app.api.chat.httpx.AsyncClient")
    def test_non_streaming_json_response(self, MockClientClass):
        mock_client_instance = MagicMock()
        MockClientClass.return_value = mock_client_instance
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "application/json"}
        # This is strictly required for the non-SSE path in chat.py
        mock_response.json = AsyncMock(
            return_value={
                "choices": [
                    {
                        "message": {
                            "content": "I will run this. [TOOL_CALL]list_images()[/TOOL_CALL] Done."
                        }
                    }
                ]
            }
        )

        mock_stream_ctx = MagicMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
        mock_stream_ctx.__aexit__ = AsyncMock()

        mock_client_instance.stream.return_value = mock_stream_ctx

        payload = {
            "messages": [{"role": "user", "content": "Run tool"}],
            "model_type": "CHAT",
        }

        response = self.client.post("/api/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)
        content_text = ""
        tool_calls = []
        for evt in events:
            if "content" in evt:
                content_text += evt["content"]
            if "tool_calls" in evt:
                tool_calls.extend(evt["tool_calls"])

        self.assertNotIn("[TOOL_CALL]", content_text)
        self.assertIn("I will run this.", content_text)
        self.assertTrue(
            any(tc["function"]["name"] == "list_images" for tc in tool_calls),
            "Tool call not found in parsed non-streaming response",
        )

    @patch("app.api.chat.httpx.AsyncClient")
    def test_native_tool_calling_stream(self, MockClientClass):
        """Test modern models that return tool_calls in stream chunks natively."""
        mock_client_instance = MagicMock()
        MockClientClass.return_value = mock_client_instance
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "text/event-stream"}

        mock_stream_ctx = MagicMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
        mock_stream_ctx.__aexit__ = AsyncMock()
        mock_client_instance.stream.return_value = mock_stream_ctx

        # Simulate OpenAI streaming format for tool calls
        async def fake_aiter_lines():
            # Initial content
            yield "data: " + json.dumps(
                {"choices": [{"delta": {"content": "Thinking about it..."}}]}
            ) + "\n\n"

            # Start of tool call
            yield "data: " + json.dumps(
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_123",
                                        "type": "function",
                                        "function": {"name": "list_", "arguments": ""},
                                    }
                                ]
                            }
                        }
                    ]
                }
            ) + "\n\n"
            # Continuation of tool call
            yield "data: " + json.dumps(
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "function": {
                                            "name": "images",
                                            "arguments": "{}",
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
            ) + "\n\n"

            yield "data: " + json.dumps(
                {"choices": [{"delta": {"content": "Done."}}]}
            ) + "\n\n"
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [{"role": "user", "content": "Check files"}],
            "model_type": "CHAT",
        }

        response = self.client.post("/api/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)
        content_text = ""
        tool_calls = []
        for evt in events:
            if "content" in evt:
                content_text += evt["content"]
            if "tool_calls" in evt:
                tool_calls.extend(evt["tool_calls"])

        self.assertIn("Thinking about it...", content_text)
        self.assertIn("Done.", content_text)
        # Verify tool call was passed through
        self.assertTrue(len(tool_calls) > 0)
        # Note: The stream aggregator in chat.py or helpers might aggregate this differently or pass chunks
        # Checking if we received tool_calls events
        found_tool = False
        for tc in tool_calls:
            # We look for the aggregated or chunked parts. Ideally the backend aggregates them?
            # Or does it pass them raw? The "modern" support usually passes them raw in chunks.
            if "function" in tc and isinstance(tc["function"], dict):
                name = tc["function"].get("name", "")
                if "list_images" in name or ("list_" in name or "images" in name):
                    found_tool = True

        # The current implementation in chat.py loops over choices and looks for tool_calls in delta
        # If it finds them, it re-emits them.
        self.assertTrue(found_tool, f"Native tool calls not emitted. Events: {events}")

    @patch("app.api.chat.httpx.AsyncClient")
    def test_native_tool_calling_non_stream(self, MockClientClass):
        """Test modern models that return tool_calls in a single JSON response."""
        mock_client_instance = MagicMock()
        MockClientClass.return_value = mock_client_instance
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "application/json"}
        mock_response.json = AsyncMock(
            return_value={
                "choices": [
                    {
                        "message": {
                            "content": "Sure, here is it.",
                            "tool_calls": [
                                {
                                    "id": "call_abc",
                                    "type": "function",
                                    "function": {
                                        "name": "list_images",
                                        "arguments": "{}",
                                    },
                                }
                            ],
                        }
                    }
                ]
            }
        )

        mock_stream_ctx = MagicMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
        mock_stream_ctx.__aexit__ = AsyncMock()
        mock_client_instance.stream.return_value = mock_stream_ctx

        payload = {
            "messages": [{"role": "user", "content": "Run tool"}],
            "model_type": "CHAT",
        }

        response = self.client.post("/api/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)
        content_text = ""
        tool_calls = []
        for evt in events:
            if "content" in evt:
                content_text += evt["content"]
            if "tool_calls" in evt:
                tool_calls.extend(evt["tool_calls"])

        self.assertIn("Sure, here is it.", content_text)
        self.assertTrue(
            any(tc["function"]["name"] == "list_images" for tc in tool_calls)
        )

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

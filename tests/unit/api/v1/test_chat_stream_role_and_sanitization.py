# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines focused chat stream role/sanitization tests so failures stay easy to isolate."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

from augmentedquill.services.chat.chat_tool_decorator import get_registered_tool_schemas

from .chat_stream_test_base import ChatStreamTestBase


class TestChatStreamRoleAndSanitization(ChatStreamTestBase):
    @patch("augmentedquill.services.llm.llm.httpx.AsyncClient")
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
            yield (
                "data: "
                + json.dumps({"choices": [{"delta": {"content": "Let me check."}}]})
                + "\n\n"
            )
            yield (
                "data: "
                + json.dumps(
                    {"choices": [{"delta": {"content": " [TOOL_CALL]manage_"}}]}
                )
                + "\n\n"
            )
            yield (
                "data: "
                + json.dumps(
                    {
                        "choices": [
                            {"delta": {"content": 'images(action="list")[/TOOL_CALL] '}}
                        ]
                    }
                )
                + "\n\n"
            )
            yield (
                "data: "
                + json.dumps({"choices": [{"delta": {"content": "Done."}}]})
                + "\n\n"
            )
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [{"role": "user", "content": "Show images"}],
            "model_type": "CHAT",
        }

        response = self.client.post("/api/v1/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)

        content_text = ""
        tool_calls = []

        for evt in events:
            if "content" in evt:
                content_text += evt["content"]
            if "tool_calls" in evt:
                tool_calls.extend(evt["tool_calls"])

        self.assertNotIn("manage_images", content_text)
        self.assertNotIn("[TOOL_CALL]", content_text)
        self.assertIn("Let me check.", content_text)
        self.assertIn("Done.", content_text)

        self.assertTrue(len(tool_calls) > 0)
        found_tool = any(tc["function"]["name"] == "manage_images" for tc in tool_calls)
        self.assertTrue(found_tool, "Did not find manage_images tool call")

    def test_stream_advertises_role_filtered_tools(self):
        captured: dict = {}

        async def fake_stream(**kwargs):
            captured.update(kwargs)
            yield {"content": "ok"}

        with patch(
            "augmentedquill.api.v1.chat.llm.unified_chat_stream",
            side_effect=fake_stream,
        ):
            response = self.client.post(
                "/api/v1/chat/stream",
                json={
                    "messages": [{"role": "user", "content": "Review this chapter"}],
                    "model_type": "EDITING",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        tool_names = {
            tool["function"]["name"] for tool in (captured.get("tools") or [])
        }
        self.assertIn("replace_text_in_chapter", tool_names)
        self.assertIn("recommend_metadata_updates", tool_names)
        self.assertIn("manage_story_core", tool_names)
        self.assertNotIn("manage_scratchpad", tool_names)

    def test_writing_stream_has_no_tools(self):
        captured: dict = {}

        async def fake_stream(**kwargs):
            captured.update(kwargs)
            yield {"content": "ok"}

        with patch(
            "augmentedquill.api.v1.chat.llm.unified_chat_stream",
            side_effect=fake_stream,
        ):
            response = self.client.post(
                "/api/v1/chat/stream",
                json={
                    "messages": [{"role": "user", "content": "Write the scene"}],
                    "model_type": "WRITING",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(captured.get("supports_function_calling"))
        self.assertIsNone(captured.get("tools"))

    def test_chat_stream_narrows_tools_for_scene_reorder_intent(self):
        captured: dict = {}

        async def fake_stream(**kwargs):
            captured.update(kwargs)
            yield {"content": "ok"}

        with patch(
            "augmentedquill.api.v1.chat.llm.unified_chat_stream",
            side_effect=fake_stream,
        ):
            response = self.client.post(
                "/api/v1/chat/stream",
                json={
                    "messages": [
                        {
                            "role": "user",
                            "content": "Please move scene 5 before scene 2 and relink chapter scopes.",
                        }
                    ],
                    "model_type": "CHAT",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        tool_names = {
            tool["function"]["name"] for tool in (captured.get("tools") or [])
        }
        self.assertIn("manage_scenes", tool_names)
        self.assertIn("undo_last_tool_changes", tool_names)

    def test_chat_stream_keeps_full_tools_when_intent_is_ambiguous(self):
        captured: dict = {}

        async def fake_stream(**kwargs):
            captured.update(kwargs)
            yield {"content": "ok"}

        with patch(
            "augmentedquill.api.v1.chat.llm.unified_chat_stream",
            side_effect=fake_stream,
        ):
            response = self.client.post(
                "/api/v1/chat/stream",
                json={
                    "messages": [{"role": "user", "content": "Hello there"}],
                    "model_type": "CHAT",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        expected = {
            tool["function"]["name"]
            for tool in get_registered_tool_schemas(
                model_type="CHAT", project_type="novel"
            )
        }
        actual = {tool["function"]["name"] for tool in (captured.get("tools") or [])}
        self.assertSetEqual(expected, actual)

    @patch("augmentedquill.services.llm.llm.httpx.AsyncClient")
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
            yield (
                "data: "
                + json.dumps({"choices": [{"delta": {"content": "Edit start "}}]})
                + "\n\n"
            )
            yield (
                "data: "
                + json.dumps(
                    {
                        "choices": [
                            {
                                "delta": {
                                    "content": '[TOOL_CALL]manage_images(action="list")[/TOOL_CALL]'
                                }
                            }
                        ]
                    }
                )
                + "\n\n"
            )
            yield (
                "data: "
                + json.dumps({"choices": [{"delta": {"content": " Edit end"}}]})
                + "\n\n"
            )
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [{"role": "user", "content": "Fix this"}],
            "model_type": "EDITING",
        }

        response = self.client.post("/api/v1/chat/stream", json=payload)
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
            any(tc["function"]["name"] == "manage_images" for tc in tool_calls)
        )
        self.assertIn("Edit start", content_text)
        self.assertIn("Edit end", content_text)

    @patch("augmentedquill.api.v1.chat.httpx.AsyncClient")
    def test_stream_commentary_tool_call_suppresses_json(self, MockClientClass):
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
            yield (
                "data: "
                + json.dumps(
                    {
                        "choices": [
                            {
                                "delta": {
                                    "content": "<|channel|>analysis<|message|>We need to get metadata."
                                }
                            }
                        ]
                    }
                )
                + "\n\n"
            )
            yield (
                "data: "
                + json.dumps(
                    {
                        "choices": [
                            {
                                "delta": {
                                    "content": '<|end|><|start|>assistant<|channel|>commentary to=functions.get_chapter_metadata <|constrain|>json<|message|>{\\"chap_id\\": 2}'
                                }
                            }
                        ]
                    }
                )
                + "\n\n"
            )
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [{"role": "user", "content": "Chapter 2 conflicts?"}],
            "model_type": "CHAT",
        }

        response = self.client.post("/api/v1/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)
        content_text = ""
        tool_calls = []
        for evt in events:
            if "content" in evt:
                content_text += evt["content"]
            if "tool_calls" in evt:
                tool_calls.extend(evt["tool_calls"])

        self.assertNotIn("chap_id", content_text)
        self.assertNotIn("analysis", content_text)
        self.assertTrue(
            any(tc["function"]["name"] == "get_chapter_metadata" for tc in tool_calls)
        )

    @patch("augmentedquill.api.v1.chat.httpx.AsyncClient")
    def test_sanitizes_assistant_tool_content(self, MockClientClass):
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
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [
                {"role": "user", "content": "Conflicts?"},
                {
                    "role": "assistant",
                    "content": 'chap_id":2',
                    "tool_calls": [
                        {
                            "id": "call_get_chapter_metadata",
                            "type": "function",
                            "function": {
                                "name": "get_chapter_metadata",
                                "arguments": '{\\"chap_id\\":2}',
                            },
                        }
                    ],
                },
            ],
            "model_type": "CHAT",
        }

        response = self.client.post("/api/v1/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        _, call_kwargs = mock_client_instance.stream.call_args
        upstream_messages = call_kwargs["json"]["messages"]
        assistant_msgs = [m for m in upstream_messages if m.get("role") == "assistant"]
        self.assertTrue(assistant_msgs)
        for msg in assistant_msgs:
            if msg.get("tool_calls"):
                self.assertIsNone(msg.get("content"))

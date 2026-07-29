# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines focused chat stream native tool-call tests so provider-format issues are easy to diagnose."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

from .chat_stream_test_base import ChatStreamTestBase


class TestChatStreamNativeToolCalls(ChatStreamTestBase):
    @patch("augmentedquill.services.llm.llm.httpx.AsyncClient")
    def test_non_streaming_json_response(self, MockClientClass):
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
        self.assertIn("I will run this.", content_text)
        self.assertTrue(
            any(tc["function"]["name"] == "list_images" for tc in tool_calls),
            "Tool call not found in parsed non-streaming response",
        )

    @patch("augmentedquill.services.llm.llm.httpx.AsyncClient")
    def test_native_tool_calling_stream(self, MockClientClass):
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
                    {"choices": [{"delta": {"content": "Thinking about it..."}}]}
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
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "id": "call_123",
                                            "type": "function",
                                            "function": {
                                                "name": "list_",
                                                "arguments": "",
                                            },
                                        }
                                    ]
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
            "messages": [{"role": "user", "content": "Check files"}],
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

        self.assertIn("Thinking about it...", content_text)
        self.assertIn("Done.", content_text)
        self.assertTrue(len(tool_calls) > 0)

        found_tool = False
        for tc in tool_calls:
            if "function" in tc and isinstance(tc["function"], dict):
                name = tc["function"].get("name", "")
                if "list_images" in name or ("list_" in name or "images" in name):
                    found_tool = True

        self.assertTrue(found_tool, f"Native tool calls not emitted. Events: {events}")

    @patch("augmentedquill.services.llm.llm.httpx.AsyncClient")
    def test_native_tool_calling_non_stream(self, MockClientClass):
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

        self.assertIn("Sure, here is it.", content_text)
        self.assertTrue(
            any(tc["function"]["name"] == "list_images" for tc in tool_calls)
        )

    @patch("augmentedquill.services.llm.llm.httpx.AsyncClient")
    def test_reasoning_tool_calling_stream_uses_xml_parameter_syntax(
        self, MockClientClass
    ):
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
            for piece in [
                "<tool_call>",
                "\n<function=get_chapter_metadata>",
                "\n<parameter=chap_id>",
                "\n6\n",
                "</parameter>",
                "\n</function>",
                "\n</tool_call>",
            ]:
                yield (
                    "data: "
                    + json.dumps({"choices": [{"delta": {"reasoning_content": piece}}]})
                    + "\n\n"
                )
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [{"role": "user", "content": "Chapter 6 metadata?"}],
            "model_type": "CHAT",
        }

        response = self.client.post("/api/v1/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)
        tool_calls = []
        for evt in events:
            if "tool_calls" in evt:
                tool_calls.extend(evt["tool_calls"])

        self.assertTrue(tool_calls, f"Expected tool calls in events: {events}")
        target = next(
            tc for tc in tool_calls if tc["function"]["name"] == "get_chapter_metadata"
        )
        self.assertEqual(json.loads(target["function"]["arguments"])["chap_id"], 6)

    @patch("augmentedquill.services.llm.llm.httpx.AsyncClient")
    def test_native_tool_calling_disables_thinking_template(self, MockClientClass):
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
            "messages": [{"role": "user", "content": "Check chapter metadata"}],
            "model_type": "CHAT",
        }

        response = self.client.post("/api/v1/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        _, call_kwargs = mock_client_instance.stream.call_args
        upstream_body = call_kwargs["json"]
        self.assertIn("tools", upstream_body)
        self.assertNotIn("chat_template_kwargs", upstream_body)

    @patch("augmentedquill.api.v1.chat.load_machine_config")
    @patch("augmentedquill.api.v1.chat.httpx.AsyncClient")
    def test_editing_stream_preserves_provider_chat_template_kwargs(
        self, MockClientClass, mock_load_config
    ):
        mock_load_config.return_value = {
            "openai": {
                "models": [
                    {
                        "name": "edit-model",
                        "base_url": "http://fake",
                        "api_key": "k",
                        "model": "gpt-fake",
                        "extra_body": '{"chat_template_kwargs": {"enable_thinking": true, "foo": "bar"}}',
                    }
                ],
                "selected_editing": "edit-model",
            }
        }

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
            "messages": [{"role": "user", "content": "Edit something"}],
            "model_type": "EDITING",
        }

        response = self.client.post("/api/v1/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        _, call_kwargs = mock_client_instance.stream.call_args
        upstream_body = call_kwargs["json"]
        self.assertIn("chat_template_kwargs", upstream_body)
        self.assertTrue(upstream_body["chat_template_kwargs"]["enable_thinking"])
        self.assertEqual(upstream_body["chat_template_kwargs"]["foo"], "bar")

    @patch("augmentedquill.services.llm.llm.httpx.AsyncClient")
    def test_stream_filters_leaked_channel_marker_but_keeps_paragraph_breaks(
        self, MockClientClass
    ):
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
            for piece in [
                "<|channel>thought\n<channel|>",
                "\n\n",
                "Paragraph one.",
                "\n\n",
                "Paragraph two.",
            ]:
                yield (
                    "data: "
                    + json.dumps({"choices": [{"delta": {"content": piece}}]})
                    + "\n\n"
                )
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [{"role": "user", "content": "Continue draft"}],
            "model_type": "WRITING",
        }

        response = self.client.post("/api/v1/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)
        content_text = ""
        for evt in events:
            if "content" in evt:
                content_text += evt["content"]

        self.assertNotIn("<|channel>", content_text)
        self.assertNotIn("<channel|>", content_text)
        self.assertIn("Paragraph one.", content_text)
        self.assertIn("Paragraph two.", content_text)
        self.assertIn("\n\n", content_text)

    @patch("augmentedquill.services.llm.llm.httpx.AsyncClient")
    def test_stream_filters_split_leaked_channel_marker(self, MockClientClass):
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
            for piece in [
                "<|channel>tho",
                "ught\n<chan",
                "nel|>",
                "\n\n",
                "Paragraph one.",
                "\n\n",
                "Paragraph two.",
            ]:
                yield (
                    "data: "
                    + json.dumps({"choices": [{"delta": {"content": piece}}]})
                    + "\n\n"
                )
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [{"role": "user", "content": "Continue draft"}],
            "model_type": "WRITING",
        }

        response = self.client.post("/api/v1/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)
        content_text = ""
        for evt in events:
            if "content" in evt:
                content_text += evt["content"]

        self.assertNotIn("<|channel>", content_text)
        self.assertNotIn("<channel|>", content_text)
        self.assertIn("Paragraph one.", content_text)
        self.assertIn("Paragraph two.", content_text)

    @patch("augmentedquill.services.llm.llm.httpx.AsyncClient")
    def test_stream_final_content_is_incremental_after_thinking_channel(
        self, MockClientClass
    ):
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
            # Explicit thinking stream should remain separate.
            yield (
                "data: "
                + json.dumps(
                    {"choices": [{"delta": {"reasoning_content": "silent thinking"}}]}
                )
                + "\n\n"
            )

            # Model switches channels using malformed markers.
            yield (
                "data: "
                + json.dumps(
                    {
                        "choices": [
                            {"delta": {"content": "<|channel>thought\n<channel|>"}}
                        ]
                    }
                )
                + "\n\n"
            )
            yield (
                "data: "
                + json.dumps(
                    {"choices": [{"delta": {"content": "<|channel>final\n<channel|>"}}]}
                )
                + "\n\n"
            )

            # Final prose must stream chunk-by-chunk, not only at [DONE].
            yield (
                "data: "
                + json.dumps({"choices": [{"delta": {"content": "Hello "}}]})
                + "\n\n"
            )
            yield (
                "data: "
                + json.dumps({"choices": [{"delta": {"content": "world"}}]})
                + "\n\n"
            )
            yield "data: [DONE]\n\n"

        mock_response.aiter_lines.side_effect = fake_aiter_lines

        payload = {
            "messages": [{"role": "user", "content": "Say hello"}],
            "model_type": "CHAT",
        }

        response = self.client.post("/api/v1/chat/stream", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

        events = self._parse_sse_events(response.text)

        thinking_events = [evt for evt in events if "thinking" in evt]
        content_events = [evt for evt in events if "content" in evt]

        self.assertGreaterEqual(len(thinking_events), 1)
        self.assertGreaterEqual(len(content_events), 2)

        content_text = "".join(evt["content"] for evt in content_events)
        self.assertNotIn("<|channel>", content_text)
        self.assertNotIn("<channel|>", content_text)
        self.assertIn("Hello world", content_text)

        # Ensure final prose arrives in multiple content chunks, not one buffered flush.
        self.assertEqual(content_events[-2]["content"], "Hello ")
        self.assertEqual(content_events[-1]["content"], "world")

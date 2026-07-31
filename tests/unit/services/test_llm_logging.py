# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Tests for the LLM logging utilities."""

import os
import tempfile
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import httpx

from augmentedquill.services.llm import llm_http_ops, llm_logging


class LlmLoggingTest(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # clear the global list so each test starts fresh
        llm_logging.llm_logs.clear()

    async def test_create_log_entry_include_response_flag(self):
        entry = llm_logging.create_log_entry(
            "https://example.com", "GET", {}, None, streaming=False
        )
        self.assertIsInstance(entry.get("response"), dict)

        entry2 = llm_logging.create_log_entry(
            "https://example.com",
            "GET",
            {},
            None,
            streaming=False,
            include_response=False,
        )
        self.assertIsNone(entry2.get("response"))

    async def test_finalize_populates_missing_response(self):
        entry = llm_logging.create_log_entry(
            "url", "POST", {}, {"a": 1}, streaming=False, include_response=False
        )
        # at this point response is None
        self.assertIsNone(entry.get("response"))
        # finalize should create a default response container
        llm_http_ops._finalize_log_entry(
            entry, status_code=418, response_body={"ok": False}
        )
        self.assertIsInstance(entry.get("response"), dict)
        self.assertEqual(entry["response"]["status_code"], 418)
        self.assertEqual(entry["response"]["body"], {"ok": False})

    async def test_logged_request_initial_entry_has_null_response(self):
        # stub the httpx client so no real network call is made
        dummy = AsyncMock()

        class DummyResp:
            status_code = 200
            headers = {}
            text = ""

            def json(self):
                return {"data": []}

        dummy.return_value.request = AsyncMock(return_value=DummyResp())
        dummy.__aenter__.return_value = dummy.return_value

        seen = []

        def record(entry):
            # store a shallow copy to freeze the state at call time
            seen.append(entry.copy())

        with (
            patch(
                "augmentedquill.services.llm.llm_http_ops.httpx.AsyncClient",
                return_value=dummy,
            ),
            patch.object(llm_http_ops, "add_llm_log", new=record),
        ):
            # perform the request, ignore the result
            await llm_http_ops.logged_request(
                caller_id="tests.llm_logging.initial_entry",
                method="GET",
                url="http://example.invalid",
                headers={},
                timeout=httpx.Timeout(1.0),
            )

        # two add_llm_log calls are expected (start + finalize), but same ID
        # should be replaced by add_llm_log logic in llm_logging.
        self.assertGreaterEqual(len(seen), 2)
        self.assertEqual(seen[0]["id"], seen[1]["id"])
        self.assertIsNone(seen[0].get("response"))
        self.assertIsNotNone(seen[1].get("response"))

    async def test_logged_request_exception_includes_traceback(self):
        """When the HTTP client throws, we log the full traceback in error_detail."""

        class BrokenClient:
            def __init__(self, timeout):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def request(self, *args, **kwargs):
                raise RuntimeError("boom")

        seen = []

        def record(entry):
            seen.append(entry.copy())

        with (
            patch(
                "augmentedquill.services.llm.llm_http_ops.httpx.AsyncClient",
                return_value=BrokenClient(None),
            ),
            patch.object(llm_http_ops, "add_llm_log", new=record),
        ):
            with self.assertRaises(RuntimeError):
                await llm_http_ops.logged_request(
                    caller_id="tests.llm_logging.exception_entry",
                    method="GET",
                    url="http://example.invalid",
                    headers={},
                    timeout=httpx.Timeout(1.0),
                )

        # ensure we recorded at least one entry and its error_detail contains the
        # exception message and a stack trace.
        self.assertGreaterEqual(len(seen), 1)
        err = seen[-1]["response"]["error_detail"]
        self.assertIsInstance(err, str)
        self.assertIn("RuntimeError", err)
        self.assertIn("boom", err)

    async def test_add_llm_log_adds_caller_origin_and_raw_log(self):
        entry = {
            "id": "fixed-id",
            "caller_id": "api.chat.stream",
            "timestamp_start": "2026-01-01T00:00:00",
            "timestamp_end": "2026-01-01T00:00:01",
            "request": {
                "url": "https://example.com",
                "method": "GET",
                "headers": {},
                "body": None,
            },
            "response": {"status_code": 200, "body": None},
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "llm_raw.log")
            with patch.dict(
                os.environ,
                {"AUGQ_LLM_DUMP": "1", "AUGQ_LLM_DUMP_PATH": log_path},
                clear=False,
            ):
                llm_logging.add_llm_log(entry)

            self.assertEqual(len(llm_logging.llm_logs), 1)
            self.assertEqual(llm_logging.llm_logs[0]["caller_origin"], "User request")

            with open(log_path, "r", encoding="utf-8") as f:
                blob = f.read()
            self.assertIn('"caller_origin": "User request"', blob)

    async def test_add_llm_log_compact_streaming_entry_is_lean(self):
        entry = {
            "id": "stream-id",
            "caller_id": "chat_tools.call_writing_llm",
            "timestamp_start": "2026-01-01T00:00:00",
            "timestamp_end": "2026-01-01T00:00:01",
            "request": {
                "url": "https://example.com",
                "method": "POST",
                "headers": {"Authorization": "token"},
                "body": {"messages": ["a"], "tools": []},
            },
            "response": {
                "status_code": 200,
                "streaming": True,
                "chunks": ["hello", "world"],
                "full_content": "hello world",
                "body": "raw",
                "error_detail": "trace",
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "llm_raw.log")
            with patch.dict(
                os.environ,
                {
                    "AUGQ_LLM_DUMP": "1",
                    "AUGQ_LLM_DUMP_PATH": log_path,
                    "AUGQ_LLM_DUMP_LEVEL": "compact",
                },
                clear=False,
            ):
                llm_logging.add_llm_log(entry)

            with open(log_path, "r", encoding="utf-8") as f:
                blob = f.read()

            self.assertIn('"chunk_count": 2', blob)
            self.assertNotIn('"chunks"', blob)
            self.assertIn('"full_content": "hello world"', blob)
            self.assertNotIn('"full_content_summary"', blob)
            self.assertIn(
                '"messages"', blob
            )  # request body (communication content) preserved
            self.assertNotIn(
                '"body": "raw"', blob
            )  # response HTTP body stripped in compact mode

    async def test_add_llm_log_normal_streaming_entry_includes_chunk_preview(self):
        entry = {
            "id": "stream-id-3",
            "caller_id": "chat_tools.call_writing_llm",
            "timestamp_start": "2026-01-01T00:00:00",
            "timestamp_end": "2026-01-01T00:00:01",
            "request": {
                "url": "https://example.com",
                "method": "POST",
                "headers": {"Authorization": "token"},
                "body": {"messages": ["a"], "tools": []},
            },
            "response": {
                "status_code": 200,
                "streaming": True,
                "chunks": [
                    {
                        "id": "1",
                        "object": "chat.completion.chunk",
                        "delta": {"content": "hello"},
                    },
                    {
                        "id": "2",
                        "object": "chat.completion.chunk",
                        "delta": {"content": " world"},
                    },
                    {
                        "id": "3",
                        "object": "chat.completion.chunk",
                        "delta": {"content": " foo"},
                    },
                ],
                "full_content": "hello world foo",
                "body": "raw",
                "error_detail": "trace",
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "llm_raw.log")
            with patch.dict(
                os.environ,
                {
                    "AUGQ_LLM_DUMP": "1",
                    "AUGQ_LLM_DUMP_PATH": log_path,
                    "AUGQ_LLM_DUMP_LEVEL": "normal",
                },
                clear=False,
            ):
                llm_logging.add_llm_log(entry)

            with open(log_path, "r", encoding="utf-8") as f:
                blob = f.read()

            self.assertNotIn('"chunks"', blob)
            self.assertIn('"chunk_count": 3', blob)
            self.assertIn('"chunk_text_preview"', blob)
            self.assertNotIn('"full_content"', blob)
            self.assertIn('"hello"', blob)
            self.assertIn('" world"', blob)  # leading space preserved (no strip)
            self.assertIn('" foo"', blob)  # leading space preserved (no strip)
            self.assertIn('"body"', blob)

    async def test_add_llm_log_normal_streaming_entry_fallbacks_to_full_content_chunks(
        self,
    ):
        entry = {
            "id": "stream-id-4",
            "caller_id": "api.chat.stream",
            "timestamp_start": "2026-01-01T00:00:00",
            "timestamp_end": "2026-01-01T00:00:01",
            "request": {
                "url": "https://example.com",
                "method": "POST",
                "headers": {"Authorization": "token"},
                "body": {"messages": ["a"], "tools": []},
            },
            "response": {
                "status_code": 200,
                "streaming": True,
                "chunks": [],
                "full_content": "Tell me a joke. Sure! Why did the chicken cross the road?",
                "body": None,
                "error_detail": None,
                "chunk_count": 104,
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "llm_raw.log")
            with patch.dict(
                os.environ,
                {
                    "AUGQ_LLM_DUMP": "1",
                    "AUGQ_LLM_DUMP_PATH": log_path,
                    "AUGQ_LLM_DUMP_LEVEL": "normal",
                },
                clear=False,
            ):
                llm_logging.add_llm_log(entry)

            with open(log_path, "r", encoding="utf-8") as f:
                blob = f.read()

            self.assertNotIn('"chunks"', blob)
            self.assertIn('"chunk_count": 104', blob)
            self.assertIn('"chunk_text_preview"', blob)
            self.assertNotIn('"full_content"', blob)
            self.assertIn(
                "Tell me a joke", blob
            )  # content present (full_content as single line entry)

    async def test_add_llm_log_debug_streaming_entry_keeps_chunks(self):
        entry = {
            "id": "stream-id-2",
            "caller_id": "chat_tools.call_writing_llm",
            "timestamp_start": "2026-01-01T00:00:00",
            "timestamp_end": "2026-01-01T00:00:01",
            "request": {
                "url": "https://example.com",
                "method": "POST",
                "headers": {"Authorization": "token"},
                "body": {"messages": ["a"], "tools": []},
            },
            "response": {
                "status_code": 200,
                "streaming": True,
                "chunks": ["hello", "world"],
                "full_content": "hello world",
                "body": "raw",
                "error_detail": "trace",
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, "llm_raw.log")
            with patch.dict(
                os.environ,
                {
                    "AUGQ_LLM_DUMP": "1",
                    "AUGQ_LLM_DUMP_PATH": log_path,
                    "AUGQ_LLM_DUMP_LEVEL": "debug",
                },
                clear=False,
            ):
                llm_logging.add_llm_log(entry)

            with open(log_path, "r", encoding="utf-8") as f:
                blob = f.read()

            self.assertIn('"chunks"', blob)
            self.assertNotIn('"chunk_text_preview"', blob)
            self.assertIn('"full_content": "hello world"', blob)
            self.assertIn('"body": "raw"', blob)

# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test llm retry unit so this responsibility stays isolated, testable, and easy to evolve.

Purpose: Verify that logged_request retries transient failures with
exponential backoff and does NOT retry non-transient errors.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from augmentedquill.services.llm.llm_http_ops import (
    _is_retryable,
    logged_request,
)


class TestIsRetryable:
    def test_connect_error_is_retryable(self) -> None:
        assert _is_retryable(httpx.ConnectError("refused"))

    def test_read_timeout_is_retryable(self) -> None:
        assert _is_retryable(httpx.ReadTimeout("timed out", request=MagicMock()))

    def test_remote_protocol_error_is_retryable(self) -> None:
        assert _is_retryable(
            httpx.RemoteProtocolError("bad proto", request=MagicMock())
        )

    def test_value_error_not_retryable(self) -> None:
        assert not _is_retryable(ValueError("oops"))

    def test_http_status_error_not_retryable(self) -> None:
        assert not _is_retryable(
            httpx.HTTPStatusError("404", request=MagicMock(), response=MagicMock())
        )


class TestLoggedRequestRetry:
    """Integration-style tests for the retry loop in logged_request."""

    def _make_response(self, status_code: int) -> httpx.Response:
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = status_code
        resp.headers = {"content-type": "application/json"}
        resp.json.return_value = {}
        resp.text = ""
        resp.raise_for_status = MagicMock()
        return resp

    def _timeout(self) -> httpx.Timeout:
        return httpx.Timeout(10.0)

    def test_succeeds_on_first_try(self) -> None:
        ok_resp = self._make_response(200)

        async def _run() -> httpx.Response:
            with patch("httpx.AsyncClient") as mock_client_cls:
                mock_client = AsyncMock()
                mock_client_cls.return_value.__aenter__.return_value = mock_client
                mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
                mock_client.request = AsyncMock(return_value=ok_resp)
                with (
                    patch("augmentedquill.services.llm.llm_http_ops.add_llm_log"),
                    patch(
                        "augmentedquill.services.llm.llm_http_ops.create_log_entry",
                        return_value={},
                    ),
                ):
                    return await logged_request(
                        caller_id="test",
                        method="POST",
                        url="https://api.example.com/v1/chat",
                        headers={},
                        timeout=self._timeout(),
                        body={},
                    )

        resp = asyncio.run(_run())
        assert resp.status_code == 200

    def test_retries_on_503_then_succeeds(self) -> None:
        """A 503 on first attempt should be retried; succeed on second."""
        err_resp = self._make_response(503)
        ok_resp = self._make_response(200)
        call_count = 0

        async def _run() -> httpx.Response:
            nonlocal call_count

            async def fake_request(*args, **kwargs):
                nonlocal call_count
                call_count += 1
                return err_resp if call_count == 1 else ok_resp

            with patch("httpx.AsyncClient") as mock_client_cls:
                mock_client = AsyncMock()
                mock_client_cls.return_value.__aenter__.return_value = mock_client
                mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
                mock_client.request = fake_request
                with (
                    patch("augmentedquill.services.llm.llm_http_ops.add_llm_log"),
                    patch(
                        "augmentedquill.services.llm.llm_http_ops.create_log_entry",
                        return_value={"response": {}},
                    ),
                    patch("asyncio.sleep", new_callable=AsyncMock),
                ):
                    return await logged_request(
                        caller_id="test",
                        method="POST",
                        url="https://api.example.com/v1/chat",
                        headers={},
                        timeout=self._timeout(),
                        body={},
                    )

        resp = asyncio.run(_run())
        assert resp.status_code == 200
        assert call_count == 2

    def test_retries_on_read_timeout_then_returns_success(self) -> None:
        """A transient transport error on the first attempt must not poison the
        result of a later successful retry.

        Regression: after a ReadTimeout the loop retried, and the second attempt
        succeeded, but the stale ``last_exc`` was re-raised anyway, so the app
        discarded the successful response and reported the old timeout.
        """
        ok_resp = self._make_response(200)
        call_count = 0

        async def _run() -> httpx.Response:
            nonlocal call_count

            async def fake_request(*args, **kwargs):
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    raise httpx.ReadTimeout("timed out", request=MagicMock())
                return ok_resp

            with patch("httpx.AsyncClient") as mock_client_cls:
                mock_client = AsyncMock()
                mock_client_cls.return_value.__aenter__.return_value = mock_client
                mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
                mock_client.request = fake_request
                with (
                    patch("augmentedquill.services.llm.llm_http_ops.add_llm_log"),
                    patch(
                        "augmentedquill.services.llm.llm_http_ops.create_log_entry",
                        return_value={"response": {}},
                    ),
                    patch("asyncio.sleep", new_callable=AsyncMock),
                ):
                    return await logged_request(
                        caller_id="test",
                        method="POST",
                        url="https://api.example.com/v1/chat",
                        headers={},
                        timeout=self._timeout(),
                        body={},
                    )

        resp = asyncio.run(_run())
        assert resp.status_code == 200
        assert call_count == 2

    def test_does_not_retry_400(self) -> None:
        """A 400 response should NOT trigger a retry."""
        bad_resp = self._make_response(400)
        call_count = 0

        async def _run() -> httpx.Response:
            nonlocal call_count

            async def fake_request(*args, **kwargs):
                nonlocal call_count
                call_count += 1
                return bad_resp

            with patch("httpx.AsyncClient") as mock_client_cls:
                mock_client = AsyncMock()
                mock_client_cls.return_value.__aenter__.return_value = mock_client
                mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
                mock_client.request = fake_request
                with (
                    patch("augmentedquill.services.llm.llm_http_ops.add_llm_log"),
                    patch(
                        "augmentedquill.services.llm.llm_http_ops.create_log_entry",
                        return_value={"response": {}},
                    ),
                ):
                    return await logged_request(
                        caller_id="test",
                        method="POST",
                        url="https://api.example.com/v1/chat",
                        headers={},
                        timeout=self._timeout(),
                        body={},
                    )

        resp = asyncio.run(_run())
        assert resp.status_code == 400
        assert call_count == 1

    def test_raises_after_max_retries_on_transport_error(self) -> None:
        """ConnectError should be raised after _MAX_RETRIES exhausted."""

        async def _run() -> None:
            async def fake_request(*args, **kwargs):
                raise httpx.ConnectError("refused")

            with patch("httpx.AsyncClient") as mock_client_cls:
                mock_client = AsyncMock()
                mock_client_cls.return_value.__aenter__.return_value = mock_client
                mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
                mock_client.request = fake_request
                with (
                    patch("augmentedquill.services.llm.llm_http_ops.add_llm_log"),
                    patch(
                        "augmentedquill.services.llm.llm_http_ops.create_log_entry",
                        return_value={},
                    ),
                    patch("asyncio.sleep", new_callable=AsyncMock),
                ):
                    await logged_request(
                        caller_id="test",
                        method="POST",
                        url="https://api.example.com/v1/chat",
                        headers={},
                        timeout=self._timeout(),
                        body={},
                    )

        with pytest.raises(httpx.ConnectError):
            asyncio.run(_run())

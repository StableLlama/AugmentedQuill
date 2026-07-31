# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test chat api proxy ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import httpx

from augmentedquill.services.chat.chat_api_proxy_ops import proxy_openai_models
from augmentedquill.services.exceptions import BadRequestError, UpstreamError


class _DummyResponse:
    def __init__(self, status_code: int, headers: dict, body, text: str = ""):
        self.status_code = status_code
        self.headers = headers
        self._body = body
        self.text = text

    def json(self):
        return self._body


class ChatApiProxyOpsTest(IsolatedAsyncioTestCase):
    async def test_requires_base_url(self):
        with self.assertRaises(BadRequestError):
            await proxy_openai_models({})

    async def test_success_json_passthrough(self):
        response = _DummyResponse(
            status_code=200,
            headers={"content-type": "application/json"},
            body={"data": [{"id": "m1"}]},
        )
        with patch(
            "augmentedquill.services.chat.chat_api_proxy_ops.logged_request",
            new=AsyncMock(return_value=response),
        ):
            out = await proxy_openai_models(
                {"base_url": "https://example.invalid/v1", "api_key": "k"}
            )

        self.assertEqual(out.status_code, 200)
        self.assertIn(b'"data"', out.body)

    async def test_upstream_error_status_is_forwarded(self):
        response = _DummyResponse(
            status_code=503,
            headers={"content-type": "application/json"},
            body={"detail": "down"},
        )
        with patch(
            "augmentedquill.services.chat.chat_api_proxy_ops.logged_request",
            new=AsyncMock(return_value=response),
        ):
            out = await proxy_openai_models({"base_url": "https://example.invalid/v1"})

        self.assertEqual(out.status_code, 503)
        self.assertIn(b'"error":"Upstream error"', out.body)

    async def test_non_json_upstream_response_uses_raw_text(self):
        response = _DummyResponse(
            status_code=200,
            headers={"content-type": "text/plain"},
            body={},
            text="plain",
        )
        with patch(
            "augmentedquill.services.chat.chat_api_proxy_ops.logged_request",
            new=AsyncMock(return_value=response),
        ):
            out = await proxy_openai_models({"base_url": "https://example.invalid/v1"})

        self.assertEqual(out.status_code, 200)
        self.assertIn(b'"raw":"plain"', out.body)

    async def test_http_transport_failure_maps_to_upstream_error(self):
        with (
            patch(
                "augmentedquill.services.chat.chat_api_proxy_ops.logged_request",
                new=AsyncMock(side_effect=httpx.ReadTimeout("timeout")),
            ),
            self.assertRaises(UpstreamError),
        ):
            await proxy_openai_models({"base_url": "https://example.invalid/v1"})

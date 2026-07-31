# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chat api proxy ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import httpx
from fastapi.responses import JSONResponse

from augmentedquill.services.exceptions import BadRequestError, UpstreamError
from augmentedquill.services.llm.llm_completion_ops import _validate_base_url
from augmentedquill.services.llm.llm_http_ops import logged_request


async def proxy_openai_models(payload: dict) -> JSONResponse:
    """Proxy Openai Models."""
    base_url = (payload or {}).get("base_url") or ""
    api_key = (payload or {}).get("api_key") or ""
    timeout_s = (payload or {}).get("timeout_s") or 60

    if not isinstance(base_url, str) or not base_url:
        raise BadRequestError("base_url is required")

    url = base_url.rstrip("/") + "/models"
    # We skip validation here because this is used by the frontend settings
    # to test a user-provided URL, which implies trust.
    _validate_base_url(base_url, skip_validation=True)
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        response = await logged_request(
            caller_id="chat_api_proxy.proxy_openai_models",
            method="GET",
            url=url,
            headers=headers,
            timeout=httpx.Timeout(float(timeout_s)),
            body=None,
            raise_for_status=False,
        )
        content = (
            response.json()
            if response.headers.get("content-type", "").startswith("application/json")
            else {"raw": response.text}
        )
        if response.status_code >= 400:
            return JSONResponse(
                status_code=response.status_code,
                content={
                    "error": "Upstream error",
                    "status": response.status_code,
                    "data": content,
                },
            )
        return JSONResponse(status_code=200, content=content)
    except httpx.HTTPError as exc:
        raise UpstreamError(f"Upstream request failed: {exc}") from exc

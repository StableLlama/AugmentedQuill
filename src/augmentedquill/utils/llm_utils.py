# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the llm utils unit so this responsibility stays isolated, testable, and easy to evolve.

Common LLM-related utility functions, including capability verification and URL normalization.
"""

import asyncio
import time
from typing import Any

import httpx

from augmentedquill.services.llm.llm_http_ops import logged_request

# 1x1 transparent pixel
PIXEL_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

_CAPABILITY_CACHE_TTL_S = 3600
_capability_cache: dict[tuple[str, str, str], tuple[float, dict]] = {}
_capability_inflight: dict[tuple[str, str, str], asyncio.Task] = {}
_capability_lock = asyncio.Lock()


def _cache_key(
    base_url: str, api_key: str | None, model_id: str
) -> tuple[str, str, str]:
    """Build stable cache key for provider/model/account scope."""
    normalized_base_url = str(base_url or "").strip().rstrip("/").lower()
    normalized_model_id = str(model_id or "").strip()
    # Keep key material in-memory only; avoid custom hashing of secrets.
    api_scope = str(api_key or "")
    return normalized_base_url, normalized_model_id, api_scope


async def _probe_model_capabilities(
    base_url: str, api_key: str | None, model_id: str, timeout_s: int
) -> dict:
    """Execute remote capability probes against chat-completions endpoint."""
    url = str(base_url or "").strip().rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    headers["Content-Type"] = "application/json"

    async def check_vision() -> Any:
        """Check Vision."""
        try:
            payload = {
                "model": model_id,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "."},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{PIXEL_B64}"
                                },
                            },
                        ],
                    }
                ],
                "max_tokens": 1,
            }
            response = await logged_request(
                caller_id="llm_utils.probe_model_capabilities.check_vision",
                method="POST",
                url=url,
                headers=headers,
                timeout=httpx.Timeout(float(timeout_s or 10)),
                body=payload,
                raise_for_status=False,
            )
            return response.status_code == 200
        except Exception:
            return False

    async def check_function_calling() -> Any:
        """Check Function Calling."""
        try:
            payload = {
                "model": model_id,
                "messages": [{"role": "user", "content": "func"}],
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "test_func",
                            "description": "test function",
                            "parameters": {"type": "object", "properties": {}},
                        },
                    }
                ],
                "tool_choice": "auto",
                "max_tokens": 1,
            }
            response = await logged_request(
                caller_id="llm_utils.probe_model_capabilities.check_function_calling",
                method="POST",
                url=url,
                headers=headers,
                timeout=httpx.Timeout(float(timeout_s or 10)),
                body=payload,
                raise_for_status=False,
            )
            return response.status_code == 200
        except Exception:
            return False

    try:
        results = await asyncio.gather(
            check_vision(),
            check_function_calling(),
            return_exceptions=True,
        )
    except Exception:
        results = [False, False]

    is_multimodal = results[0] if isinstance(results[0], bool) else False
    supports_function_calling = results[1] if isinstance(results[1], bool) else False

    return {
        "is_multimodal": is_multimodal,
        "supports_function_calling": supports_function_calling,
    }


def _clear_model_capabilities_cache_for_tests() -> None:
    """Reset in-memory capability cache/inflight registry (test-only helper)."""
    _capability_cache.clear()
    _capability_inflight.clear()


async def verify_model_capabilities(
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int = 10,
    cache_ttl_s: int = _CAPABILITY_CACHE_TTL_S,
) -> dict:
    """
    Dynamically tests the model for Vision and Function Calling capabilities by sending minimal requests.
    """
    key = _cache_key(base_url=base_url, api_key=api_key, model_id=model_id)
    now = time.monotonic()

    async with _capability_lock:
        cache_entry = _capability_cache.get(key)
        if cache_entry and cache_entry[0] > now:
            return cache_entry[1]

        inflight_task = _capability_inflight.get(key)
        if inflight_task is None:
            inflight_task = asyncio.create_task(
                _probe_model_capabilities(
                    base_url=base_url,
                    api_key=api_key,
                    model_id=model_id,
                    timeout_s=timeout_s,
                )
            )
            _capability_inflight[key] = inflight_task

    try:
        capabilities = await inflight_task
        if cache_ttl_s > 0:
            expires_at = time.monotonic() + cache_ttl_s
            async with _capability_lock:
                _capability_cache[key] = (expires_at, capabilities)
        return capabilities
    finally:
        async with _capability_lock:
            current_task = _capability_inflight.get(key)
            if current_task is inflight_task:
                _capability_inflight.pop(key, None)

# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the llm utils unit so this responsibility stays isolated, testable, and easy to evolve.

"""
Common LLM-related utility functions, including capability verification and URL normalization.
"""

import httpx
import asyncio

# 1x1 transparent pixel
PIXEL_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


def _normalize_base_url(base_url: str) -> str:
    return str(base_url or "").strip().rstrip("/")


async def verify_model_capabilities(
    base_url: str, api_key: str | None, model_id: str, timeout_s: int = 10
) -> dict:
    """
    Dynamically tests the model for Vision and Function Calling capabilities by sending minimal requests.
    """
    url = _normalize_base_url(base_url) + "/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    headers["Content-Type"] = "application/json"

    async def check_vision(client):
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
            response = await client.post(url, json=payload, headers=headers)
            # If 200 OK, vision is supported.
            return response.status_code == 200
        except Exception:
            return False

    async def check_function_calling(client):
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
            response = await client.post(url, json=payload, headers=headers)

            # If 200 OK, we assume the API handled the 'tools' parameter gracefully (supported)
            # If 400, it usually means 'tools' was not recognized.
            return response.status_code == 200
        except Exception:
            return False

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        # Run tests in parallel
        results = await asyncio.gather(
            check_vision(client), check_function_calling(client), return_exceptions=True
        )

    is_multimodal = results[0] if isinstance(results[0], bool) else False
    supports_function_calling = results[1] if isinstance(results[1], bool) else False

    return {
        "is_multimodal": is_multimodal,
        "supports_function_calling": supports_function_calling,
    }

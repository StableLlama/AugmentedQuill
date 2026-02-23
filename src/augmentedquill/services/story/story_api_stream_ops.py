# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the story api stream ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable

from augmentedquill.services.llm import llm


async def stream_unified_chat_content(
    *, messages: list, base_url: str, api_key: str | None, model_id: str, timeout_s: int
) -> AsyncIterator[str]:
    """Stream Unified Chat Content."""
    async for chunk_dict in llm.unified_chat_stream(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    ):
        chunk = chunk_dict.get("content", "")
        if chunk:
            yield chunk


async def stream_collect_and_persist(
    stream_factory: Callable[[], AsyncIterator[str]],
    persist_on_complete: Callable[[str], None],
) -> AsyncIterator[str]:
    """Stream Collect And Persist."""
    buf: list[str] = []
    try:
        async for chunk in stream_factory():
            if chunk:
                buf.append(chunk)
                yield chunk
    except asyncio.CancelledError:
        return

    try:
        persist_on_complete("".join(buf))
    except Exception:
        pass

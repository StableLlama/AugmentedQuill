from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable

from app import llm


async def stream_unified_chat_content(
    *, messages: list, base_url: str, api_key: str | None, model_id: str, timeout_s: int
) -> AsyncIterator[str]:
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

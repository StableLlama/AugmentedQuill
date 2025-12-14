from typing import Any, Dict, AsyncIterator
from app import llm as _llm


def _resolve_openai_credentials(payload: Dict[str, Any]) -> tuple[str, str | None, str, int]:
    """Delegate to app.llm.resolve_openai_credentials."""
    return _llm.resolve_openai_credentials(payload)


async def _openai_chat_complete(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    extra_body: dict | None = None,
) -> dict:
    """Delegate to app.llm.openai_chat_complete."""
    return await _llm.openai_chat_complete(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        extra_body=extra_body,
    )


async def _openai_completions(
    *,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    n: int = 1,
    extra_body: dict | None = None,
) -> dict:
    """Delegate to app.llm.openai_completions."""
    return await _llm.openai_completions(
        prompt=prompt,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        n=n,
        extra_body=extra_body,
    )


async def _openai_completions_stream(
    *,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    extra_body: dict | None = None,
) -> AsyncIterator[str]:
    """Delegate to app.llm.openai_completions_stream."""
    async for chunk in _llm.openai_completions_stream(
        prompt=prompt,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        extra_body=extra_body,
    ):
        yield chunk


async def _openai_chat_complete_stream(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
):
    """Delegate to app.llm.openai_chat_complete_stream (async generator)."""
    async for chunk in _llm.openai_chat_complete_stream(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    ):
        yield chunk
# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the llm unit so this responsibility stays isolated, testable, and easy to evolve.


Public API is kept stable while implementations are split into:
- llm_stream_ops: streaming + tool parsing stream pipeline
- llm_completion_ops: non-streaming and completions helpers
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from typing import Any

import httpx

from augmentedquill.core.config import load_machine_config
from augmentedquill.services.chat.chat_tool_decorator import MODEL_ROLES
from augmentedquill.services.llm import llm_completion_ops as _llm_completion_ops
from augmentedquill.services.llm import llm_logging as _llm_logging
from augmentedquill.services.llm import llm_stream_ops as _llm_stream_ops
from augmentedquill.services.llm.llm_request_helpers import find_model_in_list
from augmentedquill.utils import llm_parsing as _llm_parsing

# Backward-compatible export used by debug endpoint and tests.
llm_logs = _llm_logging.llm_logs
add_llm_log = _llm_logging.add_llm_log
create_log_entry = _llm_logging.create_log_entry
parse_tool_calls_from_content = _llm_parsing.parse_tool_calls_from_content
strip_thinking_tags = _llm_parsing.strip_thinking_tags


def _normalize_model_type(model_type: str | None) -> str | None:
    """Normalize model_type values to supported uppercase roles."""
    if model_type is None:
        return None
    value = str(model_type).strip().upper()
    return value if value in MODEL_ROLES else None


_PROVIDERS = ("openai", "anthropic", "google")


def _find_selected_model_name(
    payload: dict[str, Any], machine: dict[str, Any], model_type: str | None = None
) -> str | None:
    """Resolve the selected model name from payload or provider-specific selections."""
    selected_name = payload.get("model_name")
    if selected_name:
        return selected_name

    normalized_type = _normalize_model_type(model_type)
    if normalized_type:
        for provider in _PROVIDERS:
            provider_cfg = machine.get(provider) or {}
            if not isinstance(provider_cfg, dict):
                continue
            selected_name = provider_cfg.get(f"selected_{normalized_type.lower()}")
            if selected_name:
                return selected_name

    for provider in _PROVIDERS:
        provider_cfg = machine.get(provider) or {}
        if not isinstance(provider_cfg, dict):
            continue
        selected_name = provider_cfg.get("selected")
        if selected_name:
            return selected_name

    return None


def get_selected_model_name(
    payload: dict[str, Any], model_type: str | None = None
) -> str | None:
    """Get the selected model name based on payload and model_type."""
    machine = load_machine_config() or {}
    return _find_selected_model_name(payload, machine, model_type)


def resolve_openai_credentials(
    payload: dict[str, Any],
    model_type: str | None = None,
) -> tuple[str, str | None, str, int, str | None]:
    """Resolve (base_url, api_key, model_id, timeout_s) from machine config and overrides.

    Precedence:
    1. Environment variables OPENAI_BASE_URL / OPENAI_API_KEY
    2. Payload overrides: base_url, api_key, model, timeout_s or model_name (by name)
    3. machine.json -> openai.models[] (selected by name based on model_type)
    """
    machine = load_machine_config() or {}

    selected_name = get_selected_model_name(payload, model_type)

    base_url = payload.get("base_url")
    api_key = payload.get("api_key")
    model_id = payload.get("model")
    timeout_s = payload.get("timeout_s")

    chosen: dict | None = None
    default_model: dict | None = None
    for provider in _PROVIDERS:
        provider_cfg = machine.get(provider) or {}
        models = provider_cfg.get("models") if isinstance(provider_cfg, dict) else None
        if not (isinstance(models, list) and models):
            continue

        if default_model is None:
            default_model = models[0]

        if selected_name:
            found = find_model_in_list(models, selected_name)
            if found:
                chosen = found
                break

    if chosen is None:
        chosen = default_model

    if not isinstance(chosen, dict):
        from augmentedquill.services.exceptions import ConfigurationError

        raise ConfigurationError(
            "No OpenAI-compatible models configured. Configure openai.models[] in machine.json.",
        )

    base_url = payload.get("base_url") or chosen.get("base_url") or base_url
    api_key = payload.get("api_key") or chosen.get("api_key") or api_key
    model_id = payload.get("model") or chosen.get("model") or model_id
    timeout_s = (
        timeout_s
        if timeout_s not in (None, "")
        else chosen.get("timeout_s", 60) or timeout_s
    )

    env_base = os.getenv("OPENAI_BASE_URL")
    env_key = os.getenv("OPENAI_API_KEY")
    if env_base:
        base_url = env_base
    if env_key:
        api_key = env_key

    if not base_url or not model_id:
        from augmentedquill.services.exceptions import ConfigurationError

        raise ConfigurationError("Missing base_url or model in configuration")

    try:
        ts = int(timeout_s or 60)
    except Exception:
        ts = 60
    return (
        str(base_url),
        (str(api_key) if api_key else None),
        str(model_id),
        ts,
        selected_name,
    )


async def unified_chat_stream(
    *,
    caller_id: str,
    model_type: str | None = None,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None = None,
    supports_function_calling: bool = True,
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    extra_body: dict | None = None,
    skip_validation: bool = False,
) -> AsyncIterator[dict]:
    # Keep tests monkeypatching augmentedquill.services.llm.llm.httpx effective.
    """Unified Chat Stream."""
    if model_type == "WRITING":
        tools = None
        tool_choice = None
        supports_function_calling = False
    _llm_stream_ops.httpx = httpx
    async for chunk in _llm_stream_ops.unified_chat_stream(
        caller_id=caller_id,
        model_type=model_type,
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        model_name=model_name,
        supports_function_calling=supports_function_calling,
        tools=tools,
        tool_choice=tool_choice,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra_body,
        skip_validation=skip_validation,
    ):
        yield chunk


async def unified_chat_complete(
    *,
    caller_id: str,
    model_type: str | None = None,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None = None,
    supports_function_calling: bool = True,
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    extra_body: dict | None = None,
    skip_validation: bool = False,
) -> dict:
    """Unified Chat Complete."""
    if model_type == "WRITING":
        tools = None
        tool_choice = None
        supports_function_calling = False
    _llm_completion_ops.httpx = httpx
    return await _llm_completion_ops.unified_chat_complete(
        caller_id=caller_id,
        model_type=model_type,
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        model_name=model_name,
        supports_function_calling=supports_function_calling,
        tools=tools,
        tool_choice=tool_choice,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra_body,
        skip_validation=skip_validation,
    )


async def openai_chat_complete(
    *,
    caller_id: str,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    extra_body: dict | None = None,
    skip_validation: bool = False,
) -> dict:
    """Openai Chat Complete."""
    _llm_completion_ops.httpx = httpx
    return await _llm_completion_ops.openai_chat_complete(
        caller_id=caller_id,
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        model_name=model_name,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra_body,
        skip_validation=skip_validation,
    )


async def openai_completions(
    *,
    caller_id: str,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None = None,
    n: int = 1,
    temperature: float | None = None,
    max_tokens: int | None = None,
    extra_body: dict | None = None,
    skip_validation: bool = False,
) -> dict:
    """Openai Completions."""
    _llm_completion_ops.httpx = httpx
    return await _llm_completion_ops.openai_completions(
        caller_id=caller_id,
        prompt=prompt,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        model_name=model_name,
        n=n,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra_body,
        skip_validation=skip_validation,
    )


async def openai_chat_complete_stream(
    *,
    caller_id: str,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    extra_body: dict | None = None,
    skip_validation: bool = False,
) -> AsyncIterator[str]:
    """Openai Chat Complete Stream."""
    _llm_completion_ops.httpx = httpx
    async for chunk in _llm_completion_ops.openai_chat_complete_stream(
        caller_id=caller_id,
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        model_name=model_name,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra_body,
        skip_validation=skip_validation,
    ):
        yield chunk


async def openai_completions_stream(
    *,
    caller_id: str,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    extra_body: dict | None = None,
    skip_validation: bool = False,
) -> AsyncIterator[str]:
    """Openai Completions Stream."""
    _llm_completion_ops.httpx = httpx
    async for chunk in _llm_completion_ops.openai_completions_stream(
        caller_id=caller_id,
        prompt=prompt,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        model_name=model_name,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra_body,
        skip_validation=skip_validation,
    ):
        yield chunk

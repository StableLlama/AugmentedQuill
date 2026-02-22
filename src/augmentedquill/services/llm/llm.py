# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the llm unit so this responsibility stays isolated, testable, and easy to evolve.

"""LLM adapter facade.

Public API is kept stable while implementations are split into:
- llm_stream_ops: streaming + tool parsing stream pipeline
- llm_completion_ops: non-streaming and completions helpers
"""

from __future__ import annotations

from typing import Any, Dict, AsyncIterator, Tuple
import os

import httpx

from augmentedquill.core.config import load_machine_config, CONFIG_DIR
from augmentedquill.services.llm import llm_logging as _llm_logging
from augmentedquill.services.llm import llm_stream_ops as _llm_stream_ops
from augmentedquill.services.llm import llm_completion_ops as _llm_completion_ops
from augmentedquill.services.llm.llm_request_helpers import find_model_in_list
from augmentedquill.utils import llm_parsing as _llm_parsing

# Backward-compatible export used by debug endpoint and tests.
llm_logs = _llm_logging.llm_logs
add_llm_log = _llm_logging.add_llm_log
create_log_entry = _llm_logging.create_log_entry
parse_tool_calls_from_content = _llm_parsing.parse_tool_calls_from_content
strip_thinking_tags = _llm_parsing.strip_thinking_tags


def get_selected_model_name(
    payload: Dict[str, Any], model_type: str | None = None
) -> str | None:
    """Get the selected model name based on payload and model_type."""
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}

    selected_name = payload.get("model_name")
    if not selected_name and model_type:
        if model_type == "WRITING":
            selected_name = openai_cfg.get("selected_writing")
        elif model_type == "CHAT":
            selected_name = openai_cfg.get("selected_chat")
        elif model_type == "EDITING":
            selected_name = openai_cfg.get("selected_editing")

    if not selected_name:
        selected_name = openai_cfg.get("selected")
    return selected_name


def resolve_openai_credentials(
    payload: Dict[str, Any],
    model_type: str | None = None,
) -> Tuple[str, str | None, str, int]:
    """Resolve (base_url, api_key, model_id, timeout_s) from machine config and overrides.

    Precedence:
    1. Environment variables OPENAI_BASE_URL / OPENAI_API_KEY
    2. Payload overrides: base_url, api_key, model, timeout_s or model_name (by name)
    3. machine.json -> openai.models[] (selected by name based on model_type)
    """
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}

    selected_name = get_selected_model_name(payload, model_type)

    base_url = payload.get("base_url")
    api_key = payload.get("api_key")
    model_id = payload.get("model")
    timeout_s = payload.get("timeout_s")

    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    if not (isinstance(models, list) and models):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail="No OpenAI models configured. Configure openai.models[] in machine.json.",
        )

    chosen = find_model_in_list(models, selected_name) or models[0]

    base_url = chosen.get("base_url") or base_url
    api_key = chosen.get("api_key") or api_key
    model_id = chosen.get("model") or model_id
    timeout_s = chosen.get("timeout_s", 60) or timeout_s

    env_base = os.getenv("OPENAI_BASE_URL")
    env_key = os.getenv("OPENAI_API_KEY")
    if env_base:
        base_url = env_base
    if env_key:
        api_key = env_key

    if not base_url or not model_id:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400, detail="Missing base_url or model in configuration"
        )

    try:
        ts = int(timeout_s or 60)
    except Exception:
        ts = 60
    return str(base_url), (str(api_key) if api_key else None), str(model_id), ts


async def unified_chat_stream(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    supports_function_calling: bool = True,
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
    log_entry: dict | None = None,
) -> AsyncIterator[dict]:
    # Keep tests monkeypatching augmentedquill.services.llm.llm.httpx effective.
    _llm_stream_ops.httpx = httpx
    async for chunk in _llm_stream_ops.unified_chat_stream(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        supports_function_calling=supports_function_calling,
        tools=tools,
        tool_choice=tool_choice,
        temperature=temperature,
        max_tokens=max_tokens,
        log_entry=log_entry,
    ):
        yield chunk


async def unified_chat_complete(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    supports_function_calling: bool = True,
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
) -> dict:
    _llm_completion_ops.httpx = httpx
    return await _llm_completion_ops.unified_chat_complete(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        supports_function_calling=supports_function_calling,
        tools=tools,
        tool_choice=tool_choice,
        temperature=temperature,
        max_tokens=max_tokens,
    )


async def openai_chat_complete(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    extra_body: dict | None = None,
) -> dict:
    _llm_completion_ops.httpx = httpx
    return await _llm_completion_ops.openai_chat_complete(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        extra_body=extra_body,
    )


async def openai_completions(
    *,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    n: int = 1,
    extra_body: dict | None = None,
) -> dict:
    _llm_completion_ops.httpx = httpx
    return await _llm_completion_ops.openai_completions(
        prompt=prompt,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        n=n,
        extra_body=extra_body,
    )


async def openai_chat_complete_stream(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
) -> AsyncIterator[str]:
    _llm_completion_ops.httpx = httpx
    async for chunk in _llm_completion_ops.openai_chat_complete_stream(
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
    ):
        yield chunk


async def openai_completions_stream(
    *,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    extra_body: dict | None = None,
) -> AsyncIterator[str]:
    _llm_completion_ops.httpx = httpx
    async for chunk in _llm_completion_ops.openai_completions_stream(
        prompt=prompt,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        extra_body=extra_body,
    ):
        yield chunk

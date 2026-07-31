# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the llm completion ops unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from typing import Any

from augmentedquill.core.config import (
    DEFAULT_STORY_CONFIG_PATH,
    load_machine_config,
    load_story_config,
)
from augmentedquill.services.llm.llm_http_ops import (
    logged_request,
    logged_stream_request,
)
from augmentedquill.services.llm.llm_request_helpers import (
    apply_native_tool_calling_mode,
    build_headers,
    build_timeout,
    get_story_llm_preferences,
)
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.utils.llm_parsing import (
    parse_complete_assistant_output,
)


def _enforce_writing_no_thinking(
    extra_body: dict[str, Any], model_type: str | None
) -> dict[str, Any]:
    """Ensure WRITING requests never enable provider thinking templates."""
    if model_type != "WRITING":
        return extra_body

    merged = dict(extra_body or {})
    chat_template_kwargs = merged.get("chat_template_kwargs")
    if isinstance(chat_template_kwargs, dict):
        next_kwargs = dict(chat_template_kwargs)
        if next_kwargs.get("enable_thinking") is True:
            next_kwargs["enable_thinking"] = False
        merged["chat_template_kwargs"] = next_kwargs

    if merged.get("enable_thinking") is True:
        merged["enable_thinking"] = False

    return merged


def _llm_debug_enabled() -> bool:
    """Return whether verbose LLM request/response logging is enabled."""
    return os.getenv("AUGQ_LLM_DEBUG", "0") in ("1", "true", "TRUE", "yes", "on")


def _validate_base_url(base_url: str, skip_validation: bool = False) -> None:
    """Validate base_url against configured models or environment overrides to prevent SSRF."""
    if not base_url or skip_validation:
        return

    # Check for suspicious schemes or non-HTTP/HTTPS URLs
    if not (base_url.startswith("http://") or base_url.startswith("https://")):
        raise ValueError(f"Invalid base_url scheme: {base_url}")

    # Check for forbidden characters in URL (basic SSRF protection)
    # This prevents using @ for credentials or [ ] for IPv6 scope which can be used to bypass filters
    if any(c in base_url for c in "@[]"):
        raise ValueError(f"Potentially dangerous base_url: {base_url}")

    # 1. Check environment overrides (trusted)
    overrides = {
        os.getenv("OPENAI_BASE_URL"),
        os.getenv("ANTHROPIC_BASE_URL"),
        os.getenv("GOOGLE_BASE_URL"),
    }
    if base_url in overrides:
        return

    # 2. Check machine.json models
    machine_config = load_machine_config()
    if not machine_config:
        from augmentedquill.services.exceptions import ConfigurationError

        raise ConfigurationError(
            "No OpenAI models configured. Configure openai.models[] in machine.json.",
        )

    for provider in ["openai", "anthropic", "google"]:
        all_models = machine_config.get(provider, {}).get("models", [])
        for model in all_models:
            model_url = model.get("base_url")
            if model_url and base_url == model_url:
                return

    # 3. Allow explicitly trusted local inference servers (e.g. Ollama, LM Studio)
    # Note: Using a strict whitelist of local addresses.
    trusted_locals = {
        "http://localhost",
        "http://127.0.0.1",
        "http://0.0.0.0",
        "https://localhost",
        "https://127.0.0.1",
        "http://fake",  # Trusted for unit tests
    }

    # Check if base_url starts with any of the trusted locals (with optional port)
    for trusted in trusted_locals:
        if base_url == trusted or base_url.startswith(trusted + ":"):
            # Ensure the port part is numeric if present
            suffix = base_url[len(trusted) :]
            if not suffix or (
                suffix.startswith(":") and suffix[1:].split("/")[0].isdigit()
            ):
                return

    raise ValueError(f"Untrusted or unconfirmed base_url: {base_url}")


def _prepare_llm_request(
    base_url: Any,
    api_key: Any,
    model_id: Any,
    messages: Any,
    temperature: Any,
    max_tokens: Any,
    extra_body: Any = None,
) -> Any:
    """Prepare llm request."""
    url = str(base_url).rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    if extra_body:
        body.update(extra_body)
    return url, headers, body


def _resolve_temperature_max_tokens(
    temperature: float | None,
    max_tokens: int | None,
    model_cfg: dict | None = None,
) -> tuple[float, int | None]:
    """Resolve runtime temperature/max_tokens with story defaults fallback."""
    if temperature is not None and max_tokens is not None:
        return float(temperature), int(max_tokens)

    model_temperature = None
    model_max_tokens = None
    if isinstance(model_cfg, dict):
        try:
            if model_cfg.get("temperature") not in (None, ""):
                model_temperature = float(model_cfg.get("temperature"))
        except Exception:
            model_temperature = None
        try:
            if model_cfg.get("max_tokens") not in (None, ""):
                model_max_tokens = int(model_cfg.get("max_tokens"))
        except Exception:
            model_max_tokens = None

    if temperature is None:
        temperature = model_temperature
    if max_tokens is None:
        max_tokens = model_max_tokens

    if temperature is not None and max_tokens is not None:
        return float(temperature), int(max_tokens)

    story_temperature, story_max_tokens = get_story_llm_preferences(
        config_dir=DEFAULT_STORY_CONFIG_PATH.parent,
        get_active_project_dir=get_active_project_dir,
        load_story_config=load_story_config,
    )
    return (
        float(temperature) if temperature is not None else story_temperature,
        int(max_tokens) if max_tokens is not None else story_max_tokens,
    )


def _resolve_machine_model_cfg(
    base_url: str, model_id: str, model_name: str | None = None
) -> dict:
    """Resolve machine model entry matching name or base_url + model_id."""
    machine_config = load_machine_config() or {}
    openai_cfg = (
        machine_config.get("openai") if isinstance(machine_config, dict) else {}
    )
    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else []
    if not isinstance(models, list):
        return {}
    for model in models:
        if not isinstance(model, dict):
            continue
        if model_name:
            if model.get("name") == model_name:
                return model
        else:
            if str(model.get("base_url") or "") != str(base_url or ""):
                continue
            if str(model.get("model") or "") != str(model_id or ""):
                continue
            return model
    return {}


def _build_model_extra_body(model_cfg: dict) -> dict:
    """Build extra_body payload from machine model parameters."""
    if not isinstance(model_cfg, dict):
        return {}

    extra: dict = {}
    for key in (
        "top_p",
        "presence_penalty",
        "frequency_penalty",
        "seed",
        "top_k",
        "min_p",
    ):
        value = model_cfg.get(key)
        if value is not None:
            extra[key] = value

    stop = model_cfg.get("stop")
    if isinstance(stop, list) and stop:
        extra["stop"] = [str(entry) for entry in stop]

    raw_extra_body = model_cfg.get("extra_body")
    if isinstance(raw_extra_body, str) and raw_extra_body.strip():
        try:
            parsed = json.loads(raw_extra_body)
            if isinstance(parsed, dict):
                extra.update(parsed)
        except Exception:
            pass

    return extra


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
    """Execute a non-streaming chat completion and normalize tool/thinking output."""
    merged_extra_body = apply_native_tool_calling_mode(
        extra_body,
        supports_function_calling=supports_function_calling,
        tools=tools,
        tool_choice=tool_choice,
    )
    if supports_function_calling and tools and tool_choice != "none":
        merged_extra_body["tools"] = tools
        if tool_choice:
            merged_extra_body["tool_choice"] = tool_choice

    resp_json = await openai_chat_complete(
        caller_id=caller_id,
        model_type=model_type,
        messages=messages,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        model_name=model_name,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=merged_extra_body,
        skip_validation=skip_validation,
    )

    choices = resp_json.get("choices", [])
    content = ""
    tool_calls = []
    thinking = ""

    if choices:
        message = choices[0].get("message", {})
        parsed = parse_complete_assistant_output(
            message.get("content") or "",
            structured_tool_calls=message.get("tool_calls") or [],
            extra_tool_call_content=(
                message.get("reasoning_content") or message.get("reasoning") or ""
            ),
        )
        content = parsed["content"]
        tool_calls = parsed["tool_calls"]
        thinking = parsed["thinking"]

    return {
        "content": content,
        "tool_calls": tool_calls,
        "thinking": thinking,
        "raw": resp_json,
    }


async def _execute_llm_request(
    caller_id: Any,
    url: Any,
    headers: Any,
    body: Any,
    timeout_s: Any,
    model_type: Any = None,
) -> Any:
    """Send a request to the configured LLM backend and return the decoded response."""
    timeout_obj = build_timeout(timeout_s)
    response = await logged_request(
        caller_id=caller_id,
        model_type=model_type,
        method="POST",
        url=url,
        headers=headers,
        body=body,
        timeout=timeout_obj,
        raise_for_status=True,
    )
    return response.json()


async def openai_chat_complete(
    *,
    caller_id: str,
    model_type: str | None = None,
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
    """Call the OpenAI-compatible chat completions endpoint and return JSON."""
    _validate_base_url(base_url, skip_validation=skip_validation)
    model_cfg = _resolve_machine_model_cfg(base_url, model_id, model_name)
    temperature, max_tokens = _resolve_temperature_max_tokens(
        temperature, max_tokens, model_cfg
    )

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers = build_headers(api_key)

    body: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens

    model_extra = _build_model_extra_body(model_cfg)
    merged_extra: dict[str, Any] = dict(model_extra)
    request_extra = dict(extra_body or {})
    for key, value in request_extra.items():
        if (
            key == "chat_template_kwargs"
            and isinstance(merged_extra.get(key), dict)
            and isinstance(value, dict)
        ):
            merged_extra[key] = {**merged_extra[key], **value}
        else:
            merged_extra[key] = value

    merged_extra = _enforce_writing_no_thinking(merged_extra, model_type)
    if merged_extra:
        body.update(merged_extra)

    return await _execute_llm_request(
        caller_id, url, headers, body, timeout_s, model_type=model_type
    )


async def openai_completions(
    *,
    caller_id: str,
    model_type: str | None = None,
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
    """Call the OpenAI-compatible text completions endpoint and return JSON."""
    _validate_base_url(base_url, skip_validation=skip_validation)
    model_cfg = _resolve_machine_model_cfg(base_url, model_id, model_name)
    temperature, max_tokens = _resolve_temperature_max_tokens(
        temperature, max_tokens, model_cfg
    )

    url = str(base_url).rstrip("/") + "/completions"
    headers = build_headers(api_key)

    body: dict[str, Any] = {
        "model": model_id,
        "prompt": prompt,
        "temperature": temperature,
        "n": n,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    model_extra = _build_model_extra_body(model_cfg)
    if model_extra:
        body.update(model_extra)
    if extra_body:
        body.update(extra_body)

    return await _execute_llm_request(
        caller_id, url, headers, body, timeout_s, model_type=model_type
    )


async def openai_chat_complete_stream(
    *,
    caller_id: str,
    model_type: str | None = None,
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
    """Stream content chunks from the chat completions endpoint."""
    _validate_base_url(base_url, skip_validation=skip_validation)
    url = str(base_url).rstrip("/") + "/chat/completions"
    model_cfg = _resolve_machine_model_cfg(base_url, model_id, model_name)
    temperature, max_tokens = _resolve_temperature_max_tokens(
        temperature, max_tokens, model_cfg
    )

    headers = build_headers(api_key)

    body: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    model_extra = _build_model_extra_body(model_cfg)
    if model_extra:
        body.update(model_extra)
    if extra_body:
        body.update(extra_body)

    timeout_obj = build_timeout(timeout_s)

    async with logged_stream_request(
        caller_id=caller_id,
        model_type=model_type,
        method="POST",
        url=url,
        headers=headers,
        body=body,
        timeout=timeout_obj,
    ) as (resp, log_entry):
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            if not line:
                continue
            if line.startswith("data: "):
                data = line[len("data: ") :].strip()
                if data == "[DONE]":
                    break

                import json as _json

                try:
                    obj = _json.loads(data)
                    log_entry["response"]["chunks"].append(obj)
                except Exception:
                    obj = None
                if not isinstance(obj, dict):
                    continue
                try:
                    content = obj["choices"][0]["delta"].get("content")
                except Exception:
                    content = None
                if content:
                    log_entry["response"]["full_content"] += content
                    yield content


async def openai_completions_stream(
    *,
    caller_id: str,
    model_type: str | None = None,
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
    """Stream content chunks from the text completions endpoint."""
    _validate_base_url(base_url, skip_validation=skip_validation)
    url = str(base_url).rstrip("/") + "/completions"
    model_cfg = _resolve_machine_model_cfg(base_url, model_id, model_name)
    temperature, max_tokens = _resolve_temperature_max_tokens(
        temperature, max_tokens, model_cfg
    )

    headers = build_headers(api_key)

    body: dict[str, Any] = {
        "model": model_id,
        "prompt": prompt,
        "temperature": temperature,
        "stream": True,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    model_extra = _build_model_extra_body(model_cfg)
    if model_extra:
        body.update(model_extra)
    if extra_body:
        body.update(extra_body)

    timeout_obj = build_timeout(timeout_s)

    async with logged_stream_request(
        caller_id=caller_id,
        model_type=model_type,
        method="POST",
        url=url,
        headers=headers,
        body=body,
        timeout=timeout_obj,
    ) as (resp, log_entry):
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            if not line:
                continue
            if line.startswith("data: "):
                data = line[len("data: ") :].strip()
                if data == "[DONE]":
                    break

                import json as _json

                try:
                    obj = _json.loads(data)
                    log_entry["response"]["chunks"].append(obj)
                except Exception:
                    obj = None
                if not isinstance(obj, dict):
                    continue
                try:
                    content = obj["choices"][0]["text"]
                except Exception:
                    content = None
                if content:
                    log_entry["response"]["full_content"] += content
                    yield content
